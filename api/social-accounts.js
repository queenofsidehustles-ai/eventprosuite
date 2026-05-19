module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zernioKey } = req.body || {};
  if (!zernioKey) return res.status(400).json({ error: 'No API key provided' });

  try {
    const timeout = new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 12000));
    const apiFetch = fetch('https://getlate.dev/api/v1/accounts', {
      headers: {
        'Authorization': 'Bearer ' + zernioKey,
        'Content-Type': 'application/json'
      }
    });
    const upstream = await Promise.race([apiFetch, timeout]);
    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(401).json({
        error: 'Invalid API key or connection error (' + upstream.status + '). Make sure you copied the full key from getlate.dev.'
      });
    }
    const data = JSON.parse(text);
    const accounts = Array.isArray(data) ? data : (data.accounts || []);
    return res.json({ accounts });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach getlate.dev: ' + e.message });
  }
};
