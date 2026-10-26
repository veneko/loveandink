// Sign in with Google for the Love & Ink back office. Only emails in ADMIN_EMAILS get a session.
import { wrap, json, store, session, newId, ADMINS, HttpError } from '../lib/lib.mjs';
const COOKIE = (id, age) => `li_admin=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export default wrap(async req => {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.has('config')) return json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
  if (req.method === 'GET') { const s = await session(req); return s ? json({ email: s.email, name: s.name, picture: s.picture }) : json({ error: 'Not signed in' }, 401) }
  if (req.method === 'DELETE') { const s = await session(req); if (s) await store().delete('session/' + s.id); return json({ ok: true }, 200, { 'Set-Cookie': COOKIE('', 0) }) }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (!process.env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in is not set up yet.');
  const { credential } = await req.json().catch(() => ({}));
  if (!credential || credential.length > 4096) throw new HttpError(400, 'Missing Google credential.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.aud !== process.env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss) || String(t.email_verified) !== 'true') throw new HttpError(401, 'Google could not confirm this sign-in.');
  const email = String(t.email || '').toLowerCase();
  if (!ADMINS().includes(email)) throw new HttpError(403, `${email} isn't on the Love & Ink team list.`);
  const id = newId(), age = 60 * 60 * 12;
  await store().setJSON('session/' + id, { email, name: t.name || email, picture: t.picture || '', exp: Date.now() + age * 1000 });
  return json({ email, name: t.name || email, picture: t.picture || '' }, 200, { 'Set-Cookie': COOKIE(id, age) });
});
