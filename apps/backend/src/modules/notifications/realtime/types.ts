import type { PoolClient } from 'pg';

export type RecipientType = 'admin' | 'customer';

// Ids only: subscribers re-read rows from the database, so nothing sensitive travels over NOTIFY.
export interface RealtimeEvent {
  kind: 'created' | 'read' | 'read_all' | 'replaced';
  recipientType: RecipientType;
  recipientId: string;
  notificationIds: string[];
  // kind 'replaced': ids removed by message grouping (the new row arrives as notificationIds / a 'created' event).
  replacedIds?: string[];
}

export type RealtimeHandler = (events: RealtimeEvent[]) => void;

export interface RealtimeBus {
  // Runs on the CALLER'S transaction client: delivery happens only if that transaction commits.
  publish(events: RealtimeEvent[], client: PoolClient): Promise<void>;
  subscribe(handler: RealtimeHandler): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  isListening(): boolean;
}
