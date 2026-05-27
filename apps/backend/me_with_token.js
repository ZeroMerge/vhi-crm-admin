(async ()=>{
  try {
    const port = process.env.PORT || 5001;
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNjNzdiNjQwLTI2MjgtNGEzNy1hYjZkLTA5MTNmZWI5MGJkMiIsImFkbWluSWQiOiJjYzc3YjY0MC0yNjI4LTRhMzctYWI2ZC0wOTEzZmViOTBiZDIiLCJlbWFpbCI6ImFkbWluQHZhbHVlaGFuZGxlcnMuY29tIiwiYWN0aXZlUm9sZSI6InN1cGVyX2FkbWluIiwiYXNzaWduZWRSb2xlcyI6WyJzdXBlcl9hZG1pbiIsIm1hbmFnZXIiLCJsb2dpc3RpY3Nfb2ZmaWNlciIsImZpbmFuY2Vfb2ZmaWNlciIsImNybV9vZmZpY2VyIiwic3VwcG9ydF9zdGFmZiJdLCJpYXQiOjE3Nzk3MjYxMTcsImV4cCI6MTc4MDMzMDkxN30.sntBFYEC0wM_7mmr7eieqM4kxvPk4HsTZmEZT5F8CIg';
    const res = await fetch(`http://localhost:${port}/api/auth/admin/me`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());
  } catch (err) {
    console.error('Error:', err);
  }
})();
