const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const SUPA_KEY = 'sb_publishable_DFQoTRoat37YdIzPHzbZsQ_rAcubQH8';
const { mergePublishedWebsiteIntoProfile } = require('./_profile-compat');

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
    const requestOptions = {
        signal: controller.signal,
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }
      };
    const [profileResponse, websiteResponse] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,profile_data&limit=1`, requestOptions),
      // Only published website data may feed a public booking page. This also
      // gives existing students a seamless fallback when their website has
      // packages but Business Profile booking services are still empty.
      fetch(`${SUPA_URL}/rest/v1/website_builds?user_id=eq.${encodeURIComponent(uid)}&last_published_at=not.is.null&select=brand_data,packages_data,booking_data,last_published_at&order=updated_at.desc&limit=1`, requestOptions)
    ]);
    clearTimeout(timer);

    const rows = await profileResponse.json();
    const websiteRows = websiteResponse.ok ? await websiteResponse.json() : [];

    if (!profileResponse.ok) {
      return res.status(500).json({ error: `Database error ${profileResponse.status}`, detail: rows });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No profile found for this booking link. The business owner needs to save their Business Profile.' });
    }

    return res.json(mergePublishedWebsiteIntoProfile(rows[0], websiteRows && websiteRows[0]));
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Database timed out. Please refresh and try again.' });
    }
    return res.status(502).json({ error: 'Could not reach database: ' + e.message });
  }
};
