import pool from '../config/db';

async function deleteCustomer(email: string) {
  const { rows } = await pool.query(
    'SELECT id, firstname, lastname, email FROM customers WHERE email = $1',
    [email]
  );

  if (rows.length === 0) {
    console.log(`No customer found with email: ${email}`);
    await pool.end();
    return;
  }

  const customer = rows[0];
  console.log(`Found customer: ${customer.firstname} ${customer.lastname} (${customer.email})`);
  console.log(`Deleting...`);

  const result = await pool.query(
    'DELETE FROM customers WHERE email = $1 RETURNING id, email',
    [email]
  );

  console.log(`Deleted customer ${result.rows[0].email} (id: ${result.rows[0].id})`);
  await pool.end();
}

const email = process.argv[2];

if (!email) {
  console.error('Usage: npx tsx src/db/delete-customer.ts <email>');
  process.exit(1);
}

deleteCustomer(email).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
