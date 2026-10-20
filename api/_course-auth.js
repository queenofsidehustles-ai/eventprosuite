// Shared check for course endpoints: valid Supabase session + KPPS access (or admin).
const SUPABASE_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const SUPABASE_KEY = 'sb_publishable_DFQoTRoat37YdIzPHzbZsQ_rAcubQH8';
const ADMIN_EMAIL = 'ggkidsspa@gmail.com';

async function requireStudent(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { error: 'Please sign in again.', status: 401 };
  const u = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } });
  if (!u.ok) return { error: 'Please sign in again.', status: 401 };
  const user = await u.json();
  if (user.email === ADMIN_EMAIL) return { user };
  const p = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=has_kpps_access&id=eq.' + encodeURIComponent(user.id), { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } });
  const rows = p.ok ? await p.json() : [];
  if (!rows[0] || rows[0].has_kpps_access !== true) return { error: 'This is part of the Kids Party Profit System.', status: 403 };
  return { user };
}
module.exports = { requireStudent };
