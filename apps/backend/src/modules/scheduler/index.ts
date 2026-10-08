// Scheduler entry: configuration (validated at startup), the job list and the lifecycle used by src/index.ts.
import pool from '../../config/db';
import { schedulerConfigFromEnv, SchedulerConfig } from './config';
import { Job, Scheduler } from './scheduler';
import { stuckShipmentsJob } from './jobs/stuckShipments';
import { overdueInvoicesJob } from './jobs/overdueInvoices';
import { registrationDigestJob } from './jobs/registrationDigest';
import { cleanupJob } from './jobs/cleanup';

export const JOBS: Job[] = [stuckShipmentsJob, overdueInvoicesJob, registrationDigestJob, cleanupJob];

let config: SchedulerConfig | null = null;
let scheduler: Scheduler | null = null;

/** Validates scheduler settings; src/index.ts calls it before listening (throws SchedulerConfigError). */
export function initScheduler(env: NodeJS.ProcessEnv = process.env): SchedulerConfig {
  config = schedulerConfigFromEnv(env);
  return config;
}

export function startScheduler(): Scheduler | null {
  const cfg = config ?? initScheduler();
  if (!cfg.enabled) {
    console.log('[scheduler] disabled (SCHEDULER_ENABLED=false)');
    return null;
  }
  scheduler = new Scheduler({ pool, jobs: JOBS, config: cfg });
  scheduler.start();
  console.log(`[scheduler] started (${JOBS.map((j) => j.name).join(', ')}; time zone ${cfg.timezone})`);
  return scheduler;
}

export async function stopScheduler(): Promise<void> {
  const s = scheduler;
  scheduler = null;
  await s?.stop();
}

export { SchedulerConfigError } from './config';
