const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtcXdvZGR3enBmbm1wanR3aWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mzk2ODksImV4cCI6MjA5MjExNTY4OX0.pHh7BI25YYlMDqN2FmBsKCrHpvgi7zb3IUizMDUr2K4';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  // 8-second timeout on the Supabase call
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,profile_data&limit=1`,
      {
        signal: controller.signal,
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }
      }
    );
    clearTimeout(timer);

    const rows = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: `Database error ${response.status}`, detail: rows });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No profile found for this booking link. The business owner needs to save their Business Profile.' });
    }

    return res.json(rows[0]);
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Database timed out. Please refresh and try again.' });
    }
    return res.status(502).json({ error: 'Could not reach database: ' + e.message });
  }
};
