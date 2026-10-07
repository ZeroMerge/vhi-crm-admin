import type { PoolClient } from 'pg';

export type RecipientType = 'admin' | 'customer';

// Ids only: subscribers re-read rows from the database, so nothing sensitive travels over NOTIFY.
export interface NotificationRealtimeEvent {
  kind: 'created' | 'read' | 'read_all' | 'replaced';
  recipientType: RecipientType;
  recipientId: string;
  notificationIds: string[];
  // kind 'replaced': ids removed by message grouping (the new row arrives as notificationIds / a 'created' event).
  replacedIds?: string[];
}

/**
 * Who receives a thread event: one customer, or every connected admin whose CURRENT access includes the module
 * (decided by the hub at delivery time, so no admin lookup at publish time and a role removed a moment ago stops receiving).
 */
export type Audience = { recipientType: 'customer'; recipientId: string } | { module: 'communications' };

/** Communications (Phase 5). Ids only: the push never carries message text; clients fetch by id over REST. */
export type ThreadRealtimeEvent =
  | { kind: 'message_created'; audience: Audience; customerId: string; messageId: string; senderType: 'admin' | 'customer' }
  | { kind: 'thread_read'; audience: Audience; customerId: string; side: 'admin' | 'customer' };

export type RealtimeEvent = NotificationRealtimeEvent | ThreadRealtimeEvent;

export const isThreadEvent = (e: RealtimeEvent): e is ThreadRealtimeEvent => e.kind === 'message_created' || e.kind === 'thread_read';

export type RealtimeHandler = (events: RealtimeEvent[]) => void;

export interface RealtimeBus {
  // Runs on the CALLER'S transaction client: delivery happens only if that transaction commits.
  publish(events: RealtimeEvent[], client: PoolClient): Promise<void>;
  subscribe(handler: RealtimeHandler): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  isListening(): boolean;
}
