// Email heads-up for the private "Message Monica" inbox (inbox.html).
// A student's message emails Monica; Monica's reply emails the student.
// Routed through api/chat.js ({mode:'inbox', messageId}) because of the
// Vercel function limit. The message itself is saved by the browser under
// RLS; this only sends the email.
const { requireUser } = require('./_course-auth');

const SUPA = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const ADMIN_EMAILS = ['ggkidsspa@gmail.com', 'hello@bearhug.events'];
const BATCH_MS = 10 * 60 * 1000; // one email per burst of messages
const env = n => String(process.env[n] || '').trim();
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function svc() {
  const k = env('SUPABASE_SERVICE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };
}

function emailHtml(title, body, cta, href) {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:20px auto;color:#2F1E3B;line-height:1.6">
<h2 style="margin:0 0 10px;font-size:18px">${title}</h2>
<div style="background:#F5F0FF;border-radius:10px;padding:14px 16px;white-space:pre-wrap">${esc(body)}</div>
<p style="margin:18px 0"><a href="${href}" style="background:#6D28D9;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">${cta}</a></p></div>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const check = await requireUser(req);
  if (check.error) return res.status(check.status).json({ error: check.error });
  if (!(env('SUPABASE_SERVICE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'))) return res.status(500).json({ error: 'Not set up' });

  const messageId = String((req.body || {}).messageId || '');
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return res.status(400).json({ error: 'Bad message' });

  const mr = await fetch(`${SUPA}/rest/v1/coach_messages?id=eq.${messageId}&select=id,student_id,sender_id,body,created_at`, { headers: svc() });
  const msg = mr.ok ? (await mr.json())[0] : null;
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  // Only the sender, only fresh messages.
  if (msg.sender_id !== check.user.id) return res.status(403).json({ error: 'Not your message' });
  if (Date.now() - new Date(msg.created_at).getTime() > 15 * 60 * 1000) return res.json({ ok: true, skipped: 'old' });
  if (!env('RESEND_API_KEY')) return res.json({ ok: true, skipped: 'email' });

  const fromCoach = ADMIN_EMAILS.includes(String(check.user.email || '').toLowerCase());

  // Several messages in a row send one email, not one each.
  const since = new Date(new Date(msg.created_at).getTime() - BATCH_MS).toISOString();
  const pr = await fetch(`${SUPA}/rest/v1/coach_messages?student_id=eq.${msg.student_id}&sender_id=eq.${msg.sender_id}&id=neq.${messageId}&created_at=gte.${encodeURIComponent(since)}&created_at=lte.${encodeURIComponent(msg.created_at)}&select=id&limit=1`, { headers: svc() });
  if (pr.ok && (await pr.json()).length) return res.json({ ok: true, skipped: 'batched' });

  const sr = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${msg.student_id}&select=full_name,email,profile_data`, { headers: svc() });
  const prof = sr.ok ? ((await sr.json())[0] || {}) : {};
  const pd = prof.profile_data || {};
  const first = String(prof.full_name || pd.ownerName || '').trim().split(/\s+/)[0] || '';

  let to, subject, html;
  if (fromCoach) {
    const studentEmail = String(prof.email || '').trim();
    if (!studentEmail) return res.json({ ok: true, skipped: 'no-email' });
    to = [studentEmail];
    subject = '💌 Monica replied to your message';
    html = emailHtml(`Hi${first ? ' ' + esc(first) : ''}! Monica replied to your message`, msg.body, 'Open my messages →', 'https://app.partybizhub.com/inbox.html');
  } else {
    to = (env('PBH_ALERT_EMAIL') || 'support@partybizhub.com,queenofsidehustles@gmail.com').split(',').map(x => x.trim()).filter(Boolean);
    const who = first || prof.email || check.user.email || 'A student';
    subject = `💌 Private message from ${who}`;
    html = emailHtml(`💌 Private message from ${esc(who)}${pd.businessName ? ' (' + esc(pd.businessName) + ')' : ''}`, msg.body, 'Reply in your inbox →', `https://app.partybizhub.com/inbox.html?student=${msg.student_id}`);
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json', 'Idempotency-Key': 'coach-inbox/' + messageId },
      body: JSON.stringify({ from: env('RESEND_FROM_EMAIL') || 'Party Biz Hub <support@partybizhub.com>', to, subject, html }),
    });
    return res.json({ ok: true, emailed: r.ok });
  } catch (_) {
    return res.json({ ok: true, emailed: false });
  }
};
