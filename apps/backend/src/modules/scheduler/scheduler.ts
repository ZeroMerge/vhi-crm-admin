// In-process job scheduler. Every instance ticks; a Postgres advisory lock plus a due re-check under a row lock make each due run
// happen exactly once across instances. State lives in scheduled_job_runs (migration 024).
import type { Pool, PoolClient } from 'pg';
import type { SchedulerConfig } from './config';
import { nextDailyAt } from '../../utils/appTime';

export type Schedule = { everyMinutes: number } | { dailyAt: string };

export interface JobContext {
  /**
   * The run's transaction (transactional jobs). Everything the job writes on it (notifications, queued emails) commits together
   * with the run record, or rolls back as a whole when the job throws.
   */
  client: PoolClient;
  /** For jobs that commit in batches (cleanup): each batch takes its own connection. */
  pool: Pool;
  /** The run's start time. Jobs use it instead of the database clock, so "today" is the same for the whole run. */
  now: Date;
  config: SchedulerConfig;
  log: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface Job {
  name: string;
  schedule: Schedule;
  /** Returns a short summary for the log. */
  run(ctx: JobContext): Promise<string | void>;
}

export type RunOutcome = 'succeeded' | 'failed' | 'not_due' | 'locked';

export const TICK_MS = 60_000;

const truncate = (s: string, max = 1000) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Interval jobs start NULL (run on the next tick); daily jobs start at their next local time, never earlier. */
export function firstDueAt(schedule: Schedule, now: Date, timezone: string): Date | null {
  return 'dailyAt' in schedule ? nextDailyAt(now, schedule.dailyAt, timezone) : null;
}

/**
 * Next run, computed from when this run finished, never by adding missed intervals: after downtime a job runs once and then
 * returns to its normal schedule.
 */
export function nextDueAt(schedule: Schedule, finishedAt: Date, timezone: string): Date {
  return 'dailyAt' in schedule
    ? nextDailyAt(finishedAt, schedule.dailyAt, timezone)
    : new Date(finishedAt.getTime() + schedule.everyMinutes * 60_000);
}

export interface SchedulerDeps {
  pool: Pool;
  jobs: Job[];
  config: SchedulerConfig;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  tickMs?: number;
  /** Clock (tests). */
  now?: () => Date;
}

export class Scheduler {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true; // not started, or stopped: no timer
  private stopRequested = false; // set by stop(): the running tick finishes its current job and starts no other
  private ticking: Promise<void> | null = null;

  constructor(private readonly deps: SchedulerDeps) {
    this.log = deps.log ?? console;
    this.now = deps.now ?? (() => new Date());
    const names = new Set<string>();
    for (const job of deps.jobs) {
      if (names.has(job.name)) throw new Error(`duplicate scheduler job ${job.name}`);
      names.add(job.name);
      if ('dailyAt' in job.schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(job.schedule.dailyAt)) {
        throw new Error(`job ${job.name}: dailyAt must be "HH:MM"`);
      }
    }
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopRequested = false;
    this.timer = setInterval(() => void this.tick(), this.deps.tickMs ?? TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  /** Stops ticking and waits for the job in progress to finish. No new job starts after this is called. */
  async stop() {
    this.stopped = true;
    this.stopRequested = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking;
  }

  /** Runs every due job once, one after another. A tick that is still running makes the next one a no-op. */
  tick(): Promise<void> {
    if (this.stopRequested) return Promise.resolve();
    if (this.ticking) return this.ticking;
    this.ticking = this.runDue()
      .catch((err) => this.log.error('[scheduler] tick failed', err))
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }

  private async runDue() {
    const { rows } = await this.deps.pool.query('SELECT job, next_due_at FROM scheduled_job_runs');
    const dueAt = new Map<string, Date | null>(rows.map((r) => [r.job, r.next_due_at]));
    for (const job of this.deps.jobs) {
      if (this.stopRequested) return;
      const due = dueAt.get(job.name);
      // Cheap pre-check; the authoritative check happens under the locks in runJob.
      if (due && due.getTime() > this.now().getTime()) continue;
      await this.runJob(job);
    }
  }

  /** One attempt at one job (also used by tests). Each job has its own error handling, so one failure never stops the others. */
  async runJob(job: Job): Promise<RunOutcome> {
    const { pool, config } = this.deps;
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (err) {
      this.log.error(`[scheduler] ${job.name}: no database connection`, err);
      return 'failed';
    }
    try {
      await client.query('BEGIN');
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok', [`scheduler:${job.name}`]);
      if (!lock.rows[0].ok) {
        await client.query('ROLLBACK');
        return 'locked'; // another instance is running it
      }
      const startedAt = this.now();
      await client.query('INSERT INTO scheduled_job_runs (job, next_due_at) VALUES ($1, $2) ON CONFLICT (job) DO NOTHING', [
        job.name,
        firstDueAt(job.schedule, startedAt, config.timezone),
      ]);
      const state = await client.query('SELECT next_due_at FROM scheduled_job_runs WHERE job = $1 FOR UPDATE', [job.name]);
      const due: Date | null = state.rows[0].next_due_at;
      if (due && due.getTime() > startedAt.getTime()) {
        // Not due (any more): another instance ran it, or it was just scheduled. COMMIT, not ROLLBACK: a first insert must persist,
        // or every tick would recompute "the next 08:00" from the current time and a daily job deployed early would never run.
        await client.query('COMMIT');
        return 'not_due';
      }

      let status: 'succeeded' | 'failed';
      let error: string | null = null;
      let summary: string | void = undefined;
      await client.query('SAVEPOINT job_run');
      try {
        summary = await job.run({ client, pool, now: startedAt, config, log: this.log });
        await client.query('RELEASE SAVEPOINT job_run');
        status = 'succeeded';
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT job_run');
        status = 'failed';
        error = truncate((err as Error)?.stack ?? String(err));
      }

      const finishedAt = this.now();
      await client.query(
        `UPDATE scheduled_job_runs
            SET last_started_at = $2, last_finished_at = $3, last_status = $4, last_error = $5, run_count = run_count + 1, next_due_at = $6
          WHERE job = $1`,
        [job.name, startedAt, finishedAt, status, error, nextDueAt(job.schedule, finishedAt, config.timezone)]
      );
      await client.query('COMMIT');
      const ms = finishedAt.getTime() - startedAt.getTime();
      if (status === 'succeeded') this.log.info(`[scheduler] ${job.name} succeeded in ${ms}ms${summary ? `: ${summary}` : ''}`);
      else this.log.error(`[scheduler] ${job.name} failed in ${ms}ms: ${error}`);
      return status;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.log.error(`[scheduler] ${job.name}: run could not be recorded`, err);
      return 'failed';
    } finally {
      client.release();
    }
  }
}
