// Scheduler and job settings, read once at startup (src/index.ts). Invalid values stop the server with a clear message.
import { DEFAULT_TIMEZONE, assertTimezone } from '../../utils/appTime';

export interface SchedulerConfig {
  enabled: boolean;
  /** APP_TIMEZONE: daily jobs run at their local time here; "today" for overdue invoices and digests is taken here. */
  timezone: string;
  /** Hours a shipment may stay in each open status before it counts as stuck. */
  stuckHours: { pending: number; processing: number; in_transit: number; clearance: number };
  stuckReminderDays: number;
  /** Reminders after the first stuck alert, per stuck period; then nothing more until the status changes. */
  stuckMaxReminders: number;
  overdueReminderDays: number;
  /** Reminders after the first overdue alert; then nothing more for that invoice. */
  overdueMaxReminders: number;
  retention: { notificationsReadDays: number; notificationsUnreadDays: number; emailDeliveriesDays: number; webhooksDays: number };
}

export class SchedulerConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Scheduler configuration is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'SchedulerConfigError';
  }
}

const blank = (v: string | undefined) => v === undefined || v.trim() === '';

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = env[name];
  if (blank(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

export function schedulerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SchedulerConfig {
  const problems: string[] = [];

  const rawEnabled = env.SCHEDULER_ENABLED?.trim().toLowerCase();
  let enabled = true;
  if (rawEnabled) {
    if (rawEnabled === 'true') enabled = true;
    else if (rawEnabled === 'false') enabled = false;
    else problems.push('SCHEDULER_ENABLED must be "true" or "false"');
  }

  let timezone = env.APP_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  try {
    assertTimezone(timezone);
  } catch {
    problems.push(`APP_TIMEZONE "${timezone}" is not a valid IANA time zone (e.g. Africa/Lagos)`);
    timezone = DEFAULT_TIMEZONE;
  }

  const YEAR_HOURS = 24 * 366;
  const config: SchedulerConfig = {
    enabled,
    timezone,
    stuckHours: {
      pending: intEnv(env, 'STUCK_PENDING_HOURS', 48, 1, YEAR_HOURS, problems),
      processing: intEnv(env, 'STUCK_PROCESSING_HOURS', 72, 1, YEAR_HOURS, problems),
      in_transit: intEnv(env, 'STUCK_IN_TRANSIT_HOURS', 336, 1, YEAR_HOURS, problems),
      clearance: intEnv(env, 'STUCK_CLEARANCE_HOURS', 168, 1, YEAR_HOURS, problems),
    },
    stuckReminderDays: intEnv(env, 'STUCK_REMINDER_DAYS', 7, 1, 365, problems),
    stuckMaxReminders: intEnv(env, 'STUCK_MAX_REMINDERS', 4, 0, 100, problems),
    overdueReminderDays: intEnv(env, 'OVERDUE_REMINDER_DAYS', 7, 1, 365, problems),
    overdueMaxReminders: intEnv(env, 'OVERDUE_MAX_REMINDERS', 8, 0, 100, problems),
    retention: {
      notificationsReadDays: intEnv(env, 'RETENTION_NOTIFICATIONS_READ_DAYS', 90, 1, 3650, problems),
      notificationsUnreadDays: intEnv(env, 'RETENTION_NOTIFICATIONS_UNREAD_DAYS', 180, 1, 3650, problems),
      emailDeliveriesDays: intEnv(env, 'RETENTION_EMAIL_DELIVERIES_DAYS', 90, 1, 3650, problems),
      webhooksDays: intEnv(env, 'RETENTION_WEBHOOKS_DAYS', 30, 1, 3650, problems),
    },
  };

  if (problems.length) throw new SchedulerConfigError(problems);
  return config;
}
