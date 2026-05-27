(async ()=>{
  try {
    const port = process.env.PORT || 5001;
    const res = await fetch(`http://localhost:${port}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@valuehandlers.com', password: 'Admin@123' }),
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
})();
