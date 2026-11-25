import { describe, before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, TestApp } from './helpers/app';
import { customerToken, insertCustomer } from './helpers/fixtures';
import pool from '../src/config/db';
import clientShipmentsRoutes from '../src/modules/client/client.shipments.routes';
import clientCargoRoutes from '../src/modules/client/client.cargo.routes';

// [FB1-1] Every request type the customer app offers must be creatable with the payload its form really sends.
// The bodies below mirror the FormData each form builds in client/src/pages/dashboard/create-shipment/*Form.tsx
// (multipart, `items` as a JSON string, no documents so Cloudinary is never called). If a form changes its payload,
// change it here too: that is the point of this test, a type whose form and server schema drift apart fails here.

const packages = (category: string, weightUnit: string) => ({
  items: JSON.stringify([
    { description: 'Laptops', category, quantity: 1, weight: 12.5, dimensionL: 40, dimensionW: 30, dimensionH: 20, dimensionUnit: 'cm' },
    { description: 'Laptops', category, quantity: 1, weight: 7, dimensionL: 10, dimensionW: 10, dimensionH: 10, dimensionUnit: 'inches' },
  ]),
  weight: '19.5',
  weightUnit,
});

const common = { natureOfItem: 'Laptops', deliveryMode: 'door_to_door', invoiceValue: '1500', invoiceCurrency: 'USD' };

interface Case { name: string; path: string; mode: string | null; fields: Record<string, string> }

// AirFreightForm, SeaFreightForm, GroupageForm and ExportForm send an origin address typed by the customer.
const typed = { originAddress: '12 Market Road, Guangzhou', destinationAddress: '5 Marina, Lagos' };

export const SHIPMENT_CASES: Case[] = [
  { name: 'air freight', path: '/api/client/shipments', mode: 'air_freight',
    fields: { shippingMode: 'air_freight', ...common, ...typed, ...packages('Air Freight', 'kg') } },
  { name: 'sea freight', path: '/api/client/shipments', mode: 'sea_freight',
    fields: { shippingMode: 'sea_freight', ...common, deliveryMode: 'port_to_port', ...typed, ...packages('Sea Freight', 'cbm') } },
  { name: 'air freight consolidation', path: '/api/client/shipments', mode: 'consolidation',
    // AirFreightConsolidationForm has no address field: it sends the chosen country as countryOfOrigin and, since FB1-1, as originAddress.
    fields: { shippingMode: 'consolidation', ...common, countryOfOrigin: 'UK', originAddress: 'UK', exWorkType: 'Pick-up from my Supplier',
      destinationAddress: '5 Marina, Lagos', ...packages('Air Freight Consolidation', 'kg') } },
  { name: 'specialized groupage from China', path: '/api/client/shipments', mode: 'china_groupage',
    fields: { shippingMode: 'china_groupage', ...common, countryOfOrigin: 'China', exWorkType: 'Assign me a Shipping Address',
      originAddress: 'Yiwu warehouse', destinationAddress: '5 Marina, Lagos', ...packages('Groupage', 'cbm') } },
  { name: 'specialized groupage from the UK', path: '/api/client/shipments', mode: 'china_groupage',
    fields: { shippingMode: 'china_groupage', ...common, countryOfOrigin: 'UK', exWorkType: 'Pick-up from my Supplier',
      originAddress: 'London depot', destinationAddress: '5 Marina, Lagos', ...packages('Groupage', 'cbm') } },
  { name: 'direct groupage', path: '/api/client/shipments', mode: 'groupage',
    fields: { shippingMode: 'groupage', ...common, ...typed, ...packages('Groupage', 'cbm') } },
  { name: 'export', path: '/api/client/shipments', mode: 'export',
    fields: { shippingMode: 'export', ...common, countryOfOrigin: 'Canada', ...typed, ...packages('Export', 'kg') } },
  { name: 'cargo clearing (air)', path: '/api/client/cargo-clearings', mode: null,
    // CargoClearingForm
    fields: { clearingType: 'air_clearing', description: 'Spare parts', awbNumber: '157-12345678', invoiceCurrency: 'USD', invoiceValue: '900',
      commodityHsCode: '8708.99', deliveryMode: 'door_to_door', deliveryAddress: '5 Marina, Lagos', weightUnit: 'kg', weight: '40' } },
  { name: 'cargo clearing (sea)', path: '/api/client/cargo-clearings', mode: null,
    fields: { clearingType: 'sea_clearing', description: 'Tiles', awbNumber: 'MSCU1234567', invoiceCurrency: 'NGN', invoiceValue: '250000',
      commodityHsCode: '6907.21', deliveryMode: 'port_to_door', deliveryAddress: '5 Marina, Lagos', weightUnit: '20ft container', weight: '1' } },
];

describe('client create requests: every type the customer app offers', dbTest, () => {
  let app: TestApp;

  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/client/shipments', clientShipmentsRoutes],
      ['/api/client/cargo-clearings', clientCargoRoutes],
    ]);
  });
  beforeEach(async () => { await truncateAll(); });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const post = async (c: any, path: string, fields: Record<string, string>) => {
    const form = new FormData(); // multipart, exactly like the client (axios + FormData)
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${app.url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${customerToken(c)}` }, body: form });
    return { status: res.status, body: await res.json() as any };
  };

  for (const c of SHIPMENT_CASES) {
    test(`${c.name}: a valid payload is accepted and saved`, async () => {
      const customer = await insertCustomer();
      const res = await post(customer, c.path, c.fields);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      if (c.mode) {
        const row = (await pool.query('SELECT shipping_mode, status, country_of_origin, origin_address FROM shipments WHERE customer_id = $1', [customer.id])).rows;
        assert.equal(row.length, 1);
        assert.equal(row[0].shipping_mode, c.mode);
        assert.equal(row[0].status, 'pending');
        if (c.fields.countryOfOrigin) assert.equal(row[0].country_of_origin, c.fields.countryOfOrigin);
        assert.ok(row[0].origin_address, 'an origin is stored');
      } else {
        assert.equal((await pool.query('SELECT 1 FROM cargo_clearings WHERE customer_id = $1', [customer.id])).rowCount, 1);
      }
    });
  }

  test('a missing required field answers 400 with the field named in `errors` (what the forms show next to the field)', async () => {
    const customer = await insertCustomer();
    const { originAddress: _omit, ...withoutOrigin } = SHIPMENT_CASES[0].fields;
    const res = await post(customer, '/api/client/shipments', withoutOrigin);
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(Array.isArray(res.body.errors.originAddress) && res.body.errors.originAddress.length > 0, JSON.stringify(res.body));
    assert.equal((await pool.query('SELECT 1 FROM shipments')).rowCount, 0, 'nothing is saved');
  });
});
