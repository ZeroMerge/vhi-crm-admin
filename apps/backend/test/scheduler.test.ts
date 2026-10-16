import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import pool from '../src/config/db';
import { Job, Scheduler, firstDueAt, nextDueAt } from '../src/modules/scheduler/scheduler';
import { schedulerConfigFromEnv, SchedulerConfigError } from '../src/modules/scheduler/config';
import { initScheduler, startScheduler, stopScheduler, JOBS } from '../src/modules/scheduler';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const LAGOS = 'Africa/Lagos';
const CONFIG = schedulerConfigFromEnv({});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('scheduler: schedules and configuration', () => {
  test('daily jobs: next local time in APP_TIMEZONE, across midnight', () => {
    // 23:30 UTC on 6 Oct is 00:30 WAT on 7 Oct: the next 08:00 WAT is 07:00 UTC on 7 Oct (not 6 Oct, not 8 Oct).
    assert.equal(iso(firstDueAt({ dailyAt: '08:00' }, new Date('2026-10-06T23:30:00Z'), LAGOS)), '2026-10-07T07:00:00.000Z');
    // 22:59 UTC on 6 Oct is 23:59 WAT: the next 03:30 WAT is 02:30 UTC on 7 Oct.
    assert.equal(iso(firstDueAt({ dailyAt: '03:30' }, new Date('2026-10-06T22:59:00Z'), LAGOS)), '2026-10-07T02:30:00.000Z');
    // Exactly at the run time: strictly after now, so tomorrow.
    assert.equal(iso(nextDueAt({ dailyAt: '08:00' }, new Date('2026-10-07T07:00:00Z'), LAGOS)), '2026-10-08T07:00:00.000Z');
    // UTC deployment for comparison.
    assert.equal(iso(nextDueAt({ dailyAt: '08:00' }, new Date('2026-10-07T07:30:00Z'), 'UTC')), '2026-10-07T08:00:00.000Z');
  });

  test('interval jobs start NULL (next tick) and then run every N minutes from the finish time', () => {
    assert.equal(firstDueAt({ everyMinutes: 60 }, new Date('2026-10-07T10:00:00Z'), LAGOS), null);
    assert.equal(iso(nextDueAt({ everyMinutes: 60 }, new Date('2026-10-07T10:00:05Z'), LAGOS)), '2026-10-07T11:00:05.000Z');
  });

  test('config: defaults, SCHEDULER_ENABLED, invalid values are startup errors listing every problem', () => {
    assert.deepEqual(
      { enabled: CONFIG.enabled, timezone: CONFIG.timezone, stuck: CONFIG.stuckHours, max: [CONFIG.stuckMaxReminders, CONFIG.overdueMaxReminders] },
      { enabled: true, timezone: LAGOS, stuck: { pending: 48, processing: 72, in_transit: 336, clearance: 168 }, max: [4, 8] }
    );
    assert.equal(schedulerConfigFromEnv({ SCHEDULER_ENABLED: 'false' }).enabled, false);
    assert.equal(schedulerConfigFromEnv({ SCHEDULER_ENABLED: 'TRUE' }).enabled, true);
    assert.throws(
      () => schedulerConfigFromEnv({ SCHEDULER_ENABLED: 'no', STUCK_PENDING_HOURS: '0', OVERDUE_MAX_REMINDERS: '2.5', APP_TIMEZONE: 'Mars/Olympus' }),
      (err: unknown) =>
        err instanceof SchedulerConfigError &&
        err.problems.length === 4 &&
        err.message.includes('SCHEDULER_ENABLED') &&
        err.message.includes('STUCK_PENDING_HOURS') &&
        err.message.includes('OVERDUE_MAX_REMINDERS') &&
        err.message.includes('Mars/Olympus')
    );
  });

  test('the job list: unique names and the planned schedules', () => {
    assert.deepEqual(
      JOBS.map((j) => [j.name, j.schedule]),
      [
        ['stuck-shipments', { everyMinutes: 60 }],
        ['overdue-invoices', { dailyAt: '07:00' }],
        ['registration-digest', { dailyAt: '08:00' }],
        ['cleanup', { dailyAt: '03:30' }],
      ]
    );
    assert.throws(() => new Scheduler({ pool, config: CONFIG, jobs: [JOBS[0], JOBS[0]] }), /duplicate/);
    assert.throws(() => new Scheduler({ pool, config: CONFIG, jobs: [{ name: 'x', schedule: { dailyAt: '8:00' }, run: async () => {} }] }), /HH:MM/);
  });
});

describe('scheduler: runs against the database', dbTest, () => {
  before(async () => {
    await resetDatabase();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  after(async () => {
    await stopScheduler();
    await pool.end();
  });

  let clock = new Date('2026-10-07T06:30:00Z');
  const scheduler = (jobs: Job[]) => new Scheduler({ pool, jobs, config: CONFIG, log: quiet, now: () => clock });
  const state = async (job: string) => (await pool.query('SELECT * FROM scheduled_job_runs WHERE job = $1', [job])).rows[0];
  const counting = (name: string, schedule: Job['schedule'], extra: Partial<Job> = {}) => {
    const job = { name, schedule, runs: 0, async run() { job.runs++; }, ...extra };
    return job;
  };

  test('deploying at 07:30 WAT does not run an 08:00 job early; it runs at 08:00 and is then due tomorrow', async () => {
    const job = counting('digest-test', { dailyAt: '08:00' });
    const s = scheduler([job]);
    clock = new Date('2026-10-07T06:30:00Z'); // 07:30 WAT
    assert.equal(await s.runJob(job), 'not_due');
    assert.equal(job.runs, 0);
    let row = await state('digest-test');
    assert.equal(iso(row.next_due_at), '2026-10-07T07:00:00.000Z', 'first insert: the next 08:00 WAT, never NULL');
    assert.equal(Number(row.run_count), 0);
    await s.tick();
    assert.equal(job.runs, 0, 'a tick before 08:00 does nothing either');

    clock = new Date('2026-10-07T07:00:20Z'); // 08:00:20 WAT
    await s.tick();
    assert.equal(job.runs, 1);
    row = await state('digest-test');
    assert.deepEqual([row.last_status, Number(row.run_count), iso(row.next_due_at)], ['succeeded', 1, '2026-10-08T07:00:00.000Z']);
    await s.tick();
    assert.equal(job.runs, 1, 'not again the same day');
  });

  test('interval jobs: first tick runs straight away, then every N minutes', async () => {
    const job = counting('hourly-test', { everyMinutes: 60 });
    const s = scheduler([job]);
    clock = new Date('2026-10-07T10:00:00Z');
    await s.tick();
    assert.equal(job.runs, 1);
    assert.equal(iso((await state('hourly-test')).next_due_at), '2026-10-07T11:00:00.000Z');
    clock = new Date('2026-10-07T10:59:00Z');
    await s.tick();
    assert.equal(job.runs, 1);
    clock = new Date('2026-10-07T11:00:00Z');
    await s.tick();
    assert.equal(job.runs, 2);
  });

  test('two instances: a due run happens exactly once', async () => {
    let runs = 0;
    const slow: Job = { name: 'slow-test', schedule: { everyMinutes: 60 }, run: async () => { runs++; await sleep(300); } };
    clock = new Date('2026-10-07T10:00:00Z');
    const a = scheduler([slow]);
    const b = scheduler([slow]);
    const outcomes = await Promise.all([a.runJob(slow), b.runJob(slow), sleep(50).then(() => a.runJob(slow)), sleep(100).then(() => b.runJob(slow))]);
    assert.equal(runs, 1);
    assert.equal(outcomes.filter((o) => o === 'succeeded').length, 1);
    assert.ok(outcomes.every((o) => ['succeeded', 'locked', 'not_due'].includes(o)), outcomes.join(','));
    assert.equal(Number((await state('slow-test')).run_count), 1);
    // After it finished, a late instance sees it is not due.
    assert.equal(await b.runJob(slow), 'not_due');
  });

  test('catch-up after downtime: one run, then back to the normal schedule (missed runs are not replayed)', async () => {
    const job = counting('daily-catchup', { dailyAt: '07:00' });
    await pool.query(`INSERT INTO scheduled_job_runs (job, next_due_at) VALUES ('daily-catchup', '2026-10-03T06:00:00Z')`);
    clock = new Date('2026-10-07T12:00:00Z'); // four 07:00 runs missed
    const s = scheduler([job]);
    await s.tick();
    await s.tick();
    assert.equal(job.runs, 1);
    assert.equal(iso((await state('daily-catchup')).next_due_at), '2026-10-08T06:00:00.000Z');
  });

  test('a failing job is recorded as failed, its writes roll back, and the other jobs still run', async () => {
    clock = new Date('2026-10-07T10:00:00Z');
    const failing: Job = {
      name: 'failing-test',
      schedule: { everyMinutes: 60 },
      run: async ({ client }) => {
        await client.query(`INSERT INTO processed_webhooks (id, provider) VALUES ('written-then-failed', 'test')`);
        throw new Error('boom: job exploded');
      },
    };
    const writing: Job = {
      name: 'writing-test',
      schedule: { everyMinutes: 60 },
      run: async ({ client }) => {
        await client.query(`INSERT INTO processed_webhooks (id, provider) VALUES ('committed', 'test')`);
      },
    };
    await scheduler([failing, writing]).tick();
    const failed = await state('failing-test');
    assert.equal(failed.last_status, 'failed');
    assert.match(failed.last_error, /boom: job exploded/);
    assert.ok(failed.last_error.length <= 1000);
    assert.equal(iso(failed.next_due_at), '2026-10-07T11:00:00.000Z', 'retried at its next normal time');
    assert.equal((await state('writing-test')).last_status, 'succeeded');
    const ids = (await pool.query('SELECT id FROM processed_webhooks ORDER BY id')).rows.map((r) => r.id);
    assert.deepEqual(ids, ['committed']);
  });

  test('shutdown waits for the running job and starts no other', async () => {
    clock = new Date('2026-10-07T10:00:00Z');
    let finished = false;
    const slow: Job = { name: 'stop-slow', schedule: { everyMinutes: 60 }, run: async () => { await sleep(300); finished = true; } };
    const next = counting('stop-next', { everyMinutes: 60 });
    const s = scheduler([slow, next]);
    s.start();
    await sleep(80);
    await s.stop();
    assert.equal(finished, true, 'stop() resolved only after the running job finished');
    assert.equal((await state('stop-slow')).last_status, 'succeeded');
    assert.equal(next.runs, 0, 'no job starts after stop()');
    await s.tick();
    assert.equal(next.runs, 0, 'a stopped scheduler never ticks again');
  });

  test('SCHEDULER_ENABLED=false starts nothing', async () => {
    initScheduler({ SCHEDULER_ENABLED: 'false' });
    const original = console.log;
    console.log = () => {};
    try {
      assert.equal(startScheduler(), null);
    } finally {
      console.log = original;
    }
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM scheduled_job_runs')).rows[0].n, 0);
  });
});
