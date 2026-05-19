module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { zernioKey, caption, hashtags, mediaUrl, scheduledAt } = req.body || {};

  if (!zernioKey) {
    return res.status(400).json({ error: 'No social media API key. Add your Zernio key in Business Profile → Social Media Connections.' });
  }

  const BASE = 'https://getlate.dev/api/v1';
  const authHeaders = {
    'Authorization': 'Bearer ' + zernioKey,
    'Content-Type': 'application/json'
  };

  // Fetch user's connected social accounts
  let accounts;
  try {
    const timeout = new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 12000));
    const accFetch = fetch(BASE + '/accounts', { headers: authHeaders });
    const accRes = await Promise.race([accFetch, timeout]);
    const accText = await accRes.text();
    if (!accRes.ok) {
      return res.status(502).json({
        error: 'Could not verify your API key (' + accRes.status + '). Check it in Business Profile and try again.'
      });
    }
    const accData = JSON.parse(accText);
    accounts = Array.isArray(accData) ? accData : (accData.accounts || []);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach social media service: ' + e.message });
  }

  if (!accounts.length) {
    return res.status(400).json({
      error: 'No social accounts connected. Visit getlate.dev, connect your Instagram/Facebook/TikTok/YouTube, then try again.'
    });
  }

  const platformEntries = accounts
    .filter(a => a.platform && (a._id || a.id))
    .map(a => ({ platform: a.platform, accountId: a._id || a.id }));

  if (!platformEntries.length) {
    return res.status(400).json({ error: 'No valid connected accounts found. Please reconnect at getlate.dev.' });
  }

  const content = [caption, hashtags].filter(Boolean).join('\n\n');

  const payload = {
    content,
    platforms: platformEntries,
  };

  if (scheduledAt) {
    payload.scheduledFor = scheduledAt.replace('Z', '').slice(0, 19);
    payload.timezone = 'America/New_York';
  } else {
    payload.publishNow = true;
  }

  if (mediaUrl && !mediaUrl.includes('placehold')) {
    const type = /\.(mp4|mov|avi|webm)$/i.test(mediaUrl) ? 'video' : 'image';
    payload.mediaItems = [{ url: mediaUrl, type }];
  }

  try {
    const timeout = new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 90000));
    const postFetch = fetch(BASE + '/posts', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload)
    });
    const postRes = await Promise.race([postFetch, timeout]);
    const postText = await postRes.text();
    if (!postRes.ok) {
      return res.status(502).json({ error: 'Posting failed: ' + postText.slice(0, 300) });
    }
    let data = {};
    try { data = JSON.parse(postText); } catch (_) {}
    const postId = data?.post?._id || data?.id || data?.post_id || 'published';
    return res.json({
      success: true,
      post_id: postId,
      platforms: platformEntries.map(p => p.platform),
      scheduled: !!scheduledAt
    });
  } catch (e) {
    return res.status(502).json({ error: 'Publishing failed: ' + e.message });
  }
};
