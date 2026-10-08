import type { PoolClient } from 'pg';

/**
 * The only way a shipment's status is written after creation (state-machine transitions, incl. corrections and reopens).
 * Also stamps status_changed_at, which the stuck-shipments job measures from. Note-only tracking updates never call this.
 */
export async function setShipmentStatus(client: PoolClient, shipmentId: string, to: string): Promise<void> {
  await client.query('UPDATE shipments SET status = $1, status_changed_at = NOW(), updated_at = NOW() WHERE id = $2', [to, shipmentId]);
}
