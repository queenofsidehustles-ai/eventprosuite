// Party Coach (AI) replies in the student Community, plus a heads-up email to
// Monica for every question. Routed through api/chat.js ({mode:'community'})
// because of the Vercel function limit.
const { requireStudent } = require('./_course-auth');
const { SYSTEM } = require('./_coach');

const SUPA = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const env = n => String(process.env[n] || '').trim();
const COACH_ID = '06137daa-c6d7-414b-ba53-54ff2612ec4c'; // Monica's admin account; replies are marked [[ai]]
const AI_MARK = '[[ai]]';
const DAYS = ['Start Here: Hobby or Business?', 'Pick Your One Party', 'Know Who Pays You', 'Name It + Your Promise',
  'Build Your First Package', 'Price It With Math', 'Protect Your Time', 'Get Paid', 'Publish Your Website',
  'Test Your Booking Flow', 'Practice Party', 'Founding Families Offer', 'Your Circle', 'Local Outreach', 'Follow Up + Celebrate'];

const STYLE = {
  questions: 'She asked a question in the Questions space. Answer it directly and practically in under 120 words. If a day of the 14-Day Launch covers it, point her to that day by number and name. If it truly needs Monica (her personal situation, refunds, account or billing problems), say Monica will follow up.',
  introductions: 'She just introduced herself. Welcome her warmly by first name in 2-3 short sentences, reflect one detail she shared, and give one next step (usually: finish Day 0 of the 14-Day Launch). Under 60 words.',
  wins: 'She shared a win. Celebrate her specifically in 2-3 short sentences, and suggest one small next step that builds on it. Under 60 words.',
  checkins: 'She posted a launch check-in. Cheer her on in 2-3 short sentences and point to her next day if a day number is given. Under 60 words.',
};

function svc() {
  const k = env('SUPABASE_SERVICE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };
}
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const check = await requireStudent(req);
  if (check.error) return res.status(check.status).json({ error: check.error });
  if (!(env('SUPABASE_SERVICE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY')) || !env('OPENROUTER_API_KEY')) return res.status(500).json({ error: 'Not set up' });

  const postId = String((req.body || {}).postId || '');
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return res.status(400).json({ error: 'Bad post' });

  const pr = await fetch(`${SUPA}/rest/v1/community_posts?id=eq.${postId}&select=id,author_id,space,body,launch_day,created_at`, { headers: svc() });
  const post = pr.ok ? (await pr.json())[0] : null;
  if (!post) return res.status(404).json({ error: 'Post not found' });
  // Only the author, only fresh posts, never announcements or the coach's own posts.
  if (post.author_id !== check.user.id || post.author_id === COACH_ID) return res.status(403).json({ error: 'Not your post' });
  if (!STYLE[post.space]) return res.json({ ok: true, skipped: 'space' });
  if (Date.now() - new Date(post.created_at).getTime() > 15 * 60 * 1000) return res.json({ ok: true, skipped: 'old' });

  // One AI reply per post, however many times this is called.
  const ex = await fetch(`${SUPA}/rest/v1/community_comments?post_id=eq.${postId}&author_id=eq.${COACH_ID}&body=like.${encodeURIComponent('[[ai]]*')}&select=id&limit=1`, { headers: svc() });
  if (ex.ok && (await ex.json()).length) return res.json({ ok: true, skipped: 'done' });

  const ar = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${post.author_id}&select=full_name,email,profile_data`, { headers: svc() });
  const prof = ar.ok ? ((await ar.json())[0] || {}) : {};
  const pd = prof.profile_data || {};
  const first = String(prof.full_name || pd.ownerName || '').trim().split(/\s+/)[0] || '';

  const context = `You are replying publicly in the Kids Party Profit System student Community, as Monica's AI Party Coach. ${STYLE[post.space]}
The 14-Day Launch days: ${DAYS.map((t, i) => `Day ${i}: ${t}`).join('; ')}.
Her first name: ${first || 'unknown (do not guess a name)'}. Her business: ${pd.businessName || 'not set yet'}.${post.launch_day != null ? ` She just finished Day ${post.launch_day}.` : ''}
Plain text only. Do not sign the message. Never pretend to be Monica.`;

  let reply = '';
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env('OPENROUTER_API_KEY'), 'Content-Type': 'application/json', 'HTTP-Referer': 'https://partybizhub.com', 'X-Title': 'Party Biz Hub Community' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5', max_tokens: 400, temperature: 0.6,
        messages: [{ role: 'system', content: SYSTEM + '\n\n' + context }, { role: 'user', content: String(post.body).slice(0, 4000) }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    reply = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
  } catch (_) { /* fall through */ }

  let commented = false;
  if (reply) {
    const ins = await fetch(`${SUPA}/rest/v1/community_comments`, {
      method: 'POST', headers: { ...svc(), Prefer: 'return=minimal' },
      body: JSON.stringify({ post_id: postId, author_id: COACH_ID, body: AI_MARK + ' ' + reply.slice(0, 2900) }),
    });
    commented = ins.ok;
  }

  // Questions go to Monica too, so she can follow up personally.
  if (post.space === 'questions' && env('RESEND_API_KEY')) {
    const to = (env('PBH_ALERT_EMAIL') || 'support@partybizhub.com,queenofsidehustles@gmail.com').split(',').map(x => x.trim()).filter(Boolean);
    const who = first || prof.email || 'A student';
    const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:20px auto;color:#2F1E3B;line-height:1.6">
<h2 style="margin:0 0 10px;font-size:18px">❓ New question from ${esc(who)}${pd.businessName ? ' (' + esc(pd.businessName) + ')' : ''}</h2>
<div style="background:#F5F0FF;border-radius:10px;padding:14px 16px;white-space:pre-wrap">${esc(post.body)}</div>
${reply ? `<p style="margin:16px 0 6px;font-weight:700">The Party Coach replied:</p><div style="background:#FBF7FF;border:1px solid #EADCFB;border-radius:10px;padding:14px 16px;white-space:pre-wrap">${esc(reply)}</div>` : '<p>The Party Coach could not reply this time, so she is waiting on you.</p>'}
<p style="margin:18px 0"><a href="https://app.partybizhub.com/community.html?space=questions" style="background:#6D28D9;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open the Community →</a></p></div>`;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json', 'Idempotency-Key': 'community-q/' + postId },
        body: JSON.stringify({ from: env('RESEND_FROM_EMAIL') || 'Party Biz Hub <support@partybizhub.com>', to, subject: `❓ Community question from ${who}`, html }),
      });
    } catch (_) {}
  }
  return res.json({ ok: true, commented });
};
