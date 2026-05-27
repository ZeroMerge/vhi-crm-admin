import bcrypt from 'bcryptjs';
import pool from '../config/db';

async function seed() {
  console.log('Seeding database...');

  // Create admin
  const adminHash = await bcrypt.hash('Admin@123', 10);
  const adminResult = await pool.query(
    `INSERT INTO admins (name, email, password_hash, role, assigned_roles, notification_prefs, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       assigned_roles = EXCLUDED.assigned_roles,
       notification_prefs = EXCLUDED.notification_prefs,
       is_active = true
     RETURNING *`,
    ['VHI Admin', 'admin@valuehandlers.com', adminHash, 'super_admin', ['super_admin'], '{}']
  );
  console.log('Admin created:', adminResult.rows[0]?.email || 'already exists');

  // Create customers
  const customerData = [
    { user_id: 'USR001', firstname: 'Jane', lastname: 'Smith', email: 'jane@vhi.com', phone: '+2348012345678', industry: 'oil_gas', star_rating: 4, status: 'loyal', password_hash: await bcrypt.hash('password123', 10) },
    { user_id: 'USR002', firstname: 'John', lastname: 'Doe', email: 'john@vhi.com', phone: '+2348023456789', industry: 'medical', star_rating: 3, status: 'prospect', password_hash: await bcrypt.hash('password123', 10) },
    { user_id: 'USR003', firstname: 'Sarah', lastname: 'Lee', email: 'sarah@vhi.com', phone: '+2348034567890', industry: 'pharma', star_rating: 5, status: 'loyal', password_hash: await bcrypt.hash('password123', 10) },
    { user_id: 'USR004', firstname: 'Mike', lastname: 'Brown', email: 'mike@vhi.com', phone: '+2348045678901', industry: 'manufacturing', star_rating: 2, status: 'lead', password_hash: await bcrypt.hash('password123', 10) },
    { user_id: 'USR005', firstname: 'Lisa', lastname: 'Wang', email: 'lisa@vhi.com', phone: '+2348056789012', industry: 'mining', star_rating: 4, status: 'returning', password_hash: await bcrypt.hash('password123', 10) },
  ];

  const customers: any[] = [];
  for (const c of customerData) {
    const result = await pool.query(
      `INSERT INTO customers (user_id, firstname, lastname, email, phone, industry, password_hash, star_rating, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [c.user_id, c.firstname, c.lastname, c.email, c.phone, c.industry, c.password_hash, c.star_rating, c.status]
    );
    if (result.rows[0]) customers.push(result.rows[0]);
  }
  console.log(`Created ${customers.length} customers`);

  if (customers.length === 0) {
    const existing = await pool.query('SELECT * FROM customers');
    customers.push(...existing.rows);
  }

  // Create shipments
  const shipmentData = [
    { order_id: '#1895-67-fw', customer_id: customers[0]?.id, shipping_mode: 'air_freight', delivery_mode: 'door_to_door', nature_of_item: 'Building material', invoice_value: 34000000, invoice_currency: 'NGN', weight: 365000, origin_address: '45 Oxford Street, London, UK', destination_address: '12 Vaclavske namesti, Prague, Czech Republic', awb_number: '157-12345670', status: 'delivered', is_draft: false },
    { order_id: '#2695-77-gw', customer_id: customers[1]?.id, shipping_mode: 'groupage', delivery_mode: 'port_to_port', nature_of_item: 'Electronics', invoice_value: 12500000, invoice_currency: 'NGN', weight: 50000, origin_address: 'Berlin, Germany', destination_address: 'Lagos, Nigeria', bol_number: 'BOL-2024-002', status: 'in_transit', is_draft: false },
    { order_id: '#3456-66-fw', customer_id: customers[2]?.id, shipping_mode: 'consolidation', delivery_mode: 'door_to_door', nature_of_item: 'Medical Supplies', invoice_value: 8900000, invoice_currency: 'NGN', weight: 12000, origin_address: 'Paris, France', destination_address: 'Cairo, Egypt', status: 'pending', is_draft: false },
    { order_id: '#4521-89-ac', customer_id: customers[3]?.id, shipping_mode: 'cargo_clearing', delivery_mode: 'clearance_only', nature_of_item: 'Agricultural Equipment', invoice_value: 45600000, invoice_currency: 'NGN', weight: 200000, origin_address: 'New York, USA', destination_address: 'Accra, Ghana', status: 'processing', is_draft: false },
    { order_id: '#7823-12-bd', customer_id: customers[4]?.id, shipping_mode: 'export', delivery_mode: 'port_to_port', nature_of_item: 'Mining Equipment', invoice_value: 6700000, invoice_currency: 'NGN', weight: 80000, origin_address: 'Beijing, China', destination_address: 'Johannesburg, South Africa', status: 'delivered', is_draft: false },
    { order_id: '#6234-45-ce', customer_id: customers[0]?.id, shipping_mode: 'air_freight', delivery_mode: 'airport_pickup', nature_of_item: 'Pharmaceuticals', invoice_value: 15000000, invoice_currency: 'NGN', weight: 5000, origin_address: 'Mumbai, India', destination_address: 'Nairobi, Kenya', awb_number: '157-98765432', status: 'delivered', is_draft: false },
    { order_id: '#9012-78-df', customer_id: customers[1]?.id, shipping_mode: 'china_groupage', delivery_mode: 'door_to_door', nature_of_item: 'Textiles', invoice_value: 8200000, invoice_currency: 'NGN', weight: 45000, origin_address: 'Guangzhou, China', destination_address: 'Lagos, Nigeria', unique_id: 'VHI-CN-001', status: 'in_transit', is_draft: false },
    { order_id: '#3451-90-eg', customer_id: customers[2]?.id, shipping_mode: 'groupage', delivery_mode: 'office_pickup', nature_of_item: 'Auto Parts', invoice_value: 23000000, invoice_currency: 'NGN', weight: 95000, origin_address: 'Tokyo, Japan', destination_address: 'Cairo, Egypt', status: 'clearance', is_draft: false },
    { order_id: '#1289-34-fh', customer_id: customers[3]?.id, shipping_mode: 'air_freight', delivery_mode: 'door_to_door', nature_of_item: 'Chemicals', invoice_value: 18900000, invoice_currency: 'NGN', weight: 18000, origin_address: 'Houston, USA', destination_address: 'Lagos, Nigeria', awb_number: '157-45678901', status: 'pending', is_draft: false },
    { order_id: '#5678-23-gi', customer_id: customers[4]?.id, shipping_mode: 'consolidation', delivery_mode: 'port_to_door', nature_of_item: 'Machinery', invoice_value: 34200000, invoice_currency: 'NGN', weight: 150000, origin_address: 'Seoul, South Korea', destination_address: 'Accra, Ghana', status: 'delivered', is_draft: false },
  ];

  const shipments: any[] = [];
  for (const s of shipmentData) {
    const result = await pool.query(
      `INSERT INTO shipments (order_id, customer_id, shipping_mode, delivery_mode, nature_of_item, invoice_value, invoice_currency, weight, origin_address, destination_address, awb_number, bol_number, unique_id, status, is_draft)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (order_id) DO NOTHING RETURNING *`,
      [s.order_id, s.customer_id, s.shipping_mode, s.delivery_mode, s.nature_of_item, s.invoice_value, s.invoice_currency, s.weight, s.origin_address, s.destination_address, s.awb_number, s.bol_number, s.unique_id, s.status, s.is_draft]
    );
    if (result.rows[0]) shipments.push(result.rows[0]);
  }
  console.log(`Created ${shipments.length} shipments`);

  if (shipments.length === 0) {
    const existing = await pool.query('SELECT * FROM shipments');
    shipments.push(...existing.rows);
  }

  // Create invoices
  const invoiceData = [
    { invoice_number: 'INV-2024-001', shipment_id: shipments[0]?.id, customer_id: customers[0]?.id, amount: 34000000, currency: 'NGN', status: 'paid', due_date: '2024-03-30' },
    { invoice_number: 'INV-2024-002', shipment_id: shipments[1]?.id, customer_id: customers[1]?.id, amount: 12500000, currency: 'NGN', status: 'pending', due_date: '2024-04-20' },
    { invoice_number: 'INV-2024-003', shipment_id: shipments[2]?.id, customer_id: customers[2]?.id, amount: 8900000, currency: 'NGN', status: 'awaiting_vendor', due_date: '2024-05-15' },
  ];

  for (const inv of invoiceData) {
    await pool.query(
      `INSERT INTO invoices (invoice_number, shipment_id, customer_id, amount, currency, status, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (invoice_number) DO NOTHING`,
      [inv.invoice_number, inv.shipment_id, inv.customer_id, inv.amount, inv.currency, inv.status, inv.due_date]
    );
  }
  console.log('Created 3 invoices');

  console.log('Seed complete!');
  await pool.end();
}

seed().catch(console.error);
