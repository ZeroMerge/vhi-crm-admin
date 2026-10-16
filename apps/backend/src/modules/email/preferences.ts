// Email preferences. In-app notifications are always on; these only switch emails off.
// Stored JSON is never trusted: anything that is not a plain object of booleans falls back to the defaults below.
import { z } from 'zod';

// ---- customers.notification_prefs
export const CUSTOMER_PREF_DEFAULTS = { shipment_updates: true } as const;
export type CustomerPrefKey = keyof typeof CUSTOMER_PREF_DEFAULTS;
export type CustomerPrefs = Record<CustomerPrefKey, boolean>;

// ---- admins.notification_prefs (written by the admin Settings page since before Phase 3)
// The 7 keys the Settings page has always written, with the values it has always shown when nothing is saved.
export const ADMIN_PREF_DEFAULTS = {
  registration: true,
  shipment_created: true,
  status_updated: true,
  invoice_created: true,
  payment_received: true,
  overdue_alert: true,
  newsletter_sent: false,
} as const;
export type AdminPrefKey = keyof typeof ADMIN_PREF_DEFAULTS;
export type AdminPrefs = Record<AdminPrefKey, boolean>;
/** Admin keys that currently gate an email. The others are stored for later phases and do nothing yet. */
export const ADMIN_EMAIL_PREF_KEYS: AdminPrefKey[] = ['shipment_created', 'overdue_alert', 'registration'];
export const isAdminEmailPref = (key: string | null): key is AdminPrefKey => ADMIN_EMAIL_PREF_KEYS.includes(key as AdminPrefKey);

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function normalise<K extends string>(defaults: Record<K, boolean>, raw: unknown): Record<K, boolean> {
  const out = { ...defaults };
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(defaults) as K[]) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  return out;
}

export const normaliseCustomerPrefs = (raw: unknown): CustomerPrefs => normalise(CUSTOMER_PREF_DEFAULTS, raw);
export const normaliseAdminPrefs = (raw: unknown): AdminPrefs => normalise(ADMIN_PREF_DEFAULTS, raw);

// Update bodies: known keys only, booleans only, at least one key. Unknown keys → 400.
export const customerPrefsUpdateSchema = z
  .object({ shipment_updates: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one preference' });

export const adminPrefsUpdateSchema = z
  .object(Object.fromEntries(Object.keys(ADMIN_PREF_DEFAULTS).map((k) => [k, z.boolean()])) as Record<AdminPrefKey, z.ZodBoolean>)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one preference' });
