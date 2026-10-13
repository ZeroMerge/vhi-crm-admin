import crypto from 'crypto';
import pool from '../../src/config/db';

// Seeded data with known answers. Time zone is Africa/Lagos (UTC+1, no DST): "23:30Z on 31 Oct" is 00:30 on 1 Nov in Lagos.
// Every figure asserted below was worked out by hand from this table, not from the code under test.
//
// Customers      A Ada Obi (oil_gas)   B Bayo Ade (mining)   C Chi Zhang (no industry)
// Shipments (created_at UTC | status | status_changed_at UTC)
//   s1  A air     2026-10-31T23:30 pending     -               -> NOVEMBER in Lagos
//   s2  A air     2026-10-31T22:59 in_transit  -               -> 31 Oct 23:59 Lagos, October
//   s3  B sea     2026-10-05T10:00 delivered   2026-10-20T12:00
//   s4  B group   2026-09-15T10:00 delivered   2026-10-02T09:00 -> created in September, completed in October
//   s5  C export  2026-10-10T10:00 cancelled   2026-10-12T10:00
//   s6  A air     2026-10-12       draft                         -> never counted
//   s7  A air     2026-10-18T12:00 processing
//   s8  B group   2026-10-19T12:00 clearance
//   s9  (none)    2026-10-20T12:00 pending                       -> "Unassigned"
//   s10 A air     2026-10-11T22:59 pending                       -> Sunday 23:59 Lagos (ISO week of 5 Oct)
//   s11 A air     2026-10-11T23:01 pending                       -> Monday 00:01 Lagos (ISO week of 12 Oct)
export const OCT = 'range=custom&from=2026-10-01&to=2026-10-31';

/** Inserts the dataset above and returns the row ids by key (A, B, C, s1..s11, i1..i9). Call after truncateAll(). */
export async function seedReportData(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const customer = async (key: string, first: string, last: string, industry: string | null, phone: string | null = null) => {
    const { rows } = await pool.query(
      `INSERT INTO customers (user_id, firstname, lastname, email, phone, industry, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 'x', true) RETURNING id`,
      [`VHI-${crypto.randomBytes(4).toString('hex')}`, first, last, `${key}@test.local`, phone, industry],
    );
    ids[key] = rows[0].id;
  };
  const shipment = async (key: string, cust: string | null, mode: string, status: string, created: string, changed: string | null) => {
    const { rows } = await pool.query(
      `INSERT INTO shipments (order_id, customer_id, shipping_mode, status, is_draft, created_at, status_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, COALESCE($7::timestamptz, $6::timestamptz)) RETURNING id`,
      [`T-${key}`, cust ? ids[cust] : null, mode, status, status === 'draft', created, changed],
    );
    ids[key] = rows[0].id;
  };
  const invoice = async (key: string, cust: string, amount: string, currency: string, status: string, issued: string | null, shipmentKey: string | null = null) => {
    const { rows } = await pool.query(
      `INSERT INTO invoices (invoice_number, customer_id, shipment_id, amount, currency, status, issued_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, COALESCE($7::timestamptz, '2026-09-01T00:00:00Z'::timestamptz)) RETURNING id`,
      [`INV-${key}`, ids[cust], shipmentKey ? ids[shipmentKey] : null, amount, currency, status, issued],
    );
    ids[key] = rows[0].id;
  };
  const payment = async (inv: string, cust: string, amount: string, currency: string, status: string, paidAt: string | null, createdAt?: string) => {
    await pool.query(
      `INSERT INTO payments (invoice_id, customer_id, amount, currency, payment_method, payment_status, paid_at, created_at)
       VALUES ($1, $2, $3, $4, 'manual', $5, $6::timestamptz, COALESCE($7::timestamptz, $6::timestamptz, NOW()))`,
      [ids[inv], ids[cust], amount, currency, status, paidAt, createdAt ?? null],
    );
  };

  await customer('A', 'Ada', 'Obi', 'oil_gas', '0801');
  await customer('B', 'Bayo', 'Ade', 'mining');
  await customer('C', 'Chi', 'Zhang', null);

  await shipment('s1', 'A', 'air_freight', 'pending', '2026-10-31T23:30:00Z', null);
  await shipment('s2', 'A', 'air_freight', 'in_transit', '2026-10-31T22:59:00Z', null);
  await shipment('s3', 'B', 'sea_freight', 'delivered', '2026-10-05T10:00:00Z', '2026-10-20T12:00:00Z');
  await shipment('s4', 'B', 'groupage', 'delivered', '2026-09-15T10:00:00Z', '2026-10-02T09:00:00Z');
  await shipment('s5', 'C', 'export', 'cancelled', '2026-10-10T10:00:00Z', '2026-10-12T10:00:00Z');
  await shipment('s6', 'A', 'air_freight', 'draft', '2026-10-12T10:00:00Z', null);
  await shipment('s7', 'A', 'air_freight', 'processing', '2026-10-18T12:00:00Z', null);
  await shipment('s8', 'B', 'groupage', 'clearance', '2026-10-19T12:00:00Z', null);
  await shipment('s9', null, 'air_freight', 'pending', '2026-10-20T12:00:00Z', null);
  await shipment('s10', 'A', 'air_freight', 'pending', '2026-10-11T22:59:00Z', null);
  await shipment('s11', 'A', 'air_freight', 'pending', '2026-10-11T23:01:00Z', null);

  // Invoices (NGN unless noted)
  await invoice('i1', 'A', '1000.00', 'NGN', 'sent', '2026-10-31T23:30:00Z'); // November in Lagos
  await invoice('i2', 'A', '2000.00', 'NGN', 'part_paid', '2026-10-10T10:00:00Z', 's2');
  await invoice('i3', 'A', '100.00', 'USD', 'paid', '2026-10-12T10:00:00Z');
  await invoice('i4', 'A', '700.00', 'NGN', 'draft', null); // draft: never counted
  await invoice('i6', 'B', '5000.00', 'NGN', 'paid', '2026-10-03T10:00:00Z', 's3');
  await invoice('i7', 'B', '250.50', 'USD', 'sent', '2026-10-20T10:00:00Z');
  await invoice('i8', 'B', '100.00', 'ngn ', 'sent', '2026-10-21T10:00:00Z'); // 'ngn ' is NGN
  await invoice('i9', 'C', '300.00', 'NGN', 'awaiting_vendor', '2026-09-30T22:30:00Z'); // 23:30 on 30 Sep in Lagos

  // Payments
  await payment('i1', 'A', '400.00', 'NGN', 'success', '2026-10-31T23:30:00Z'); // November in Lagos
  await payment('i2', 'A', '500.00', 'NGN', 'success', '2026-10-15T10:00:00Z');
  await payment('i2', 'A', '300.00', 'NGN', 'failed', '2026-10-15T11:00:00Z'); // ignored
  await payment('i2', 'A', '200.00', 'NGN', 'pending', null, '2026-10-16T11:00:00Z'); // ignored
  await payment('i3', 'A', '100.00', 'USD', 'success', '2026-10-13T10:00:00Z');
  await payment('i6', 'B', '5000.00', 'NGN', 'success', null, '2026-10-04T10:00:00Z'); // no paid_at: dated by created_at
  return ids;
}
