(async ()=>{
  try {
    const port = process.env.PORT || 5001;
    const payload = { email: 'admin@valuehandlers.com', password: 'Admin@123', selectedRole: 'super_admin' };
    const res = await fetch(`http://localhost:${port}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('Status:', res.status);
    const body = await res.text();
    console.log('Body:', body);
  } catch (err) {
    console.error('Error:', err);
  }
})();
