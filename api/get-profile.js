const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtcXdvZGR3enBmbm1wanR3aWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mzk2ODksImV4cCI6MjA5MjExNTY4OX0.pHh7BI25YYlMDqN2FmBsKCrHpvgi7zb3IUizMDUr2K4';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    const response = await fetch(
      `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,profile_data&limit=1`,
      {
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const rows = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'Database error', detail: rows });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found. The business owner needs to save their Business Profile first.' });
    }

    return res.json(rows[0]);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach database: ' + e.message });
  }
};
