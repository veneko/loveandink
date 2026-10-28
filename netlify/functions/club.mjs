// Legends Club Pass: a one-time lifetime pass ($9.99) locked to one Google account.
// Members get the Lounge (early episodes, behind the scenes, printables) and an automatic merch discount.
// Only the newest sign-in for a member stays active, so a pass can't be shared across accounts or passed around.
import { wrap, json, store, newId, cookie, ADMINS, HttpError, sq, sqReady } from '../lib/lib.mjs';
import { randomBytes } from 'node:crypto';

export const PASS = { price: 999, name: 'Legends Club Pass (lifetime)', sku: 'TLA-CLUBPASS' };
const AGE = 60 * 60 * 24 * 60; // member session: 60 days
const COOKIE = (id, age) => `li_member=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const mkey = email => 'member/' + encodeURIComponent(String(email).toLowerCase());
const DEFAULTS = {
  discount: 15,
  welcome: 'Welcome to the Lounge, Legend! New drops land here before anywhere else.',
  episodes: [{ title: 'Round 2: the bedtime rematch', note: 'Members see it here first, before Instagram and YouTube.', url: '', date: '' }],
  bts: [], printables: []
};
const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const okUrl = u => (/^https:\/\/[^\s"'<>]+$/.test(u) ? u : '');
function cleanList(a, withFile) {
  return (Array.isArray(a) ? a : []).slice(0, 40).map(x => ({ title: s(x.title, 120), note: s(x.note, 400), url: okUrl(s(x.url, 500)), date: s(x.date, 20),
    ...(withFile ? { file: /^[a-f0-9]{20}$/.test(x.file || '') ? x.file : '', name: s(x.name, 120) } : {}) })).filter(x => x.title);
}
export async function clubContent() {
  const c = await store().get('club/content', { type: 'json' }).catch(() => null);
  return { ...DEFAULTS, ...(c || {}) };
}

async function verifyGoogle(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in is not set up yet.');
  if (!credential || credential.length > 4096) throw new HttpError(400, 'Missing Google credential.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.aud !== process.env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss) || String(t.email_verified) !== 'true') throw new HttpError(401, 'Google could not confirm this sign-in.');
  return { email: String(t.email || '').toLowerCase(), name: t.name || '', picture: t.picture || '' };
}

/** The signed-in member (or null). Exported so checkout can apply the member discount. */
export async function memberSession(req) {
  const id = cookie(req, 'li_member'); if (!id || !/^[a-f0-9]{48}$/.test(id)) return null;
  const st = store(), sess = await st.get('msession/' + id, { type: 'json' });
  if (!sess || sess.exp < Date.now()) return null;
  const m = await st.get(mkey(sess.email), { type: 'json' });
  if (!m || m.sid !== id) return null; // signed in somewhere newer
  const admin = ADMINS().includes(sess.email);
  return { id, email: sess.email, member: m, admin, active: !!m.active || admin };
}

async function confirmPayment(m) {
  if (m.active || !m.pending || !sqReady()) return m;
  const link = await store().get('paylink/' + m.pending, { type: 'json' }); if (!link || !link.orderId) return m;
  const d = await sq('/v2/orders/' + link.orderId, { method: 'GET' }).catch(() => null);
  const o = d && d.order; if (!o) return m;
  const paid = (o.tenders || []).length > 0 || o.state === 'COMPLETED';
  if (!paid) return m;
  const at = new Date().toISOString();
  m = { ...m, active: true, since: at, order: m.pending, pending: '' };
  await store().setJSON(mkey(m.email), m);
  const ord = await store().get('orders/' + m.order, { type: 'json' });
  if (ord) await store().setJSON('orders/' + m.order, { ...ord, status: 'delivered', payment: { state: 'paid', squareOrder: o.id, amount: o.total_money ? o.total_money.amount / 100 : null, at }, history: [...(ord.history || []), { at, by: 'website', status: 'delivered' }] });
  return m;
}

const pub = (me, m) => ({ email: me.email, name: m.name, picture: m.picture, active: me.active, admin: me.admin, since: m.since || '', pending: !!m.pending });

export default wrap(async req => {
  const url = new URL(req.url), st = store();
  if (req.method !== 'GET') { const o = req.headers.get('origin'); if (o && new URL(o).host !== url.host) throw new HttpError(403, 'Blocked: wrong origin.') }

  if (req.method === 'GET' && url.searchParams.has('config')) return json({ clientId: process.env.GOOGLE_CLIENT_ID || null, price: PASS.price / 100, discount: (await clubContent()).discount });

  // members-only downloads
  if (req.method === 'GET' && url.searchParams.has('file')) {
    const me = await memberSession(req); if (!me || !me.active) throw new HttpError(403, 'Members only.');
    const id = url.searchParams.get('file'); if (!/^[a-f0-9]{20}$/.test(id)) throw new HttpError(404, 'Not found');
    const r = await st.getWithMetadata('clubfile/' + id, { type: 'arrayBuffer' }); if (!r) throw new HttpError(404, 'Not found');
    const name = String(r.metadata.name || 'download').replace(/[^\w. -]/g, '');
    return new Response(r.data, { headers: { 'Content-Type': r.metadata.type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
  }

  if (req.method === 'GET') {
    let me = await memberSession(req); if (!me) return json({ signedIn: false });
    const m = await confirmPayment(me.member).catch(() => me.member);
    me = { ...me, member: m, active: !!m.active || me.admin };
    const out = { signedIn: true, ...pub(me, m) };
    if (me.active) out.content = await clubContent();
    if (me.admin && url.searchParams.has('members')) {
      const { blobs } = await st.list({ prefix: 'member/' });
      const all = (await Promise.all(blobs.map(b => st.get(b.key, { type: 'json' })))).filter(Boolean);
      out.members = all.filter(x => x.active).map(x => ({ email: x.email, since: x.since }));
    }
    return json(out);
  }

  if (req.method === 'DELETE') {
    const me = await memberSession(req); if (me) await st.delete('msession/' + me.id);
    return json({ ok: true }, 200, { 'Set-Cookie': COOKIE('', 0) });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = await req.json().catch(() => ({}));

  if (b.action === 'signin') {
    const g = await verifyGoogle(b.credential);
    const id = newId(), prev = await st.get(mkey(g.email), { type: 'json' });
    const m = { ...(prev || { email: g.email, created: new Date().toISOString(), active: false }), name: g.name || (prev && prev.name) || '', picture: g.picture, sid: id };
    await st.setJSON('msession/' + id, { email: g.email, exp: Date.now() + AGE * 1000 });
    await st.setJSON(mkey(g.email), m); // the newest sign-in wins; older devices are signed out
    if (prev && prev.sid) await st.delete('msession/' + prev.sid).catch(() => {});
    const me = { email: g.email, admin: ADMINS().includes(g.email), active: !!m.active || ADMINS().includes(g.email) };
    return json({ signedIn: true, ...pub(me, m) }, 200, { 'Set-Cookie': COOKIE(id, AGE) });
  }

  const me = await memberSession(req); if (!me) throw new HttpError(401, 'Please sign in with Google first.');

  if (b.action === 'buy') {
    if (me.active) throw new HttpError(409, 'You already have the Legends Club Pass.');
    if (!sqReady()) throw new HttpError(503, 'Checkout is not connected yet.');
    const code = 'LC-' + randomBytes(3).toString('hex').toUpperCase(), at = new Date().toISOString();
    const site = process.env.URL || 'https://loveandink.co';
    const d = await sq('/v2/online-checkout/payment-links', { body: {
      idempotency_key: code + '-' + Date.now(),
      order: { location_id: process.env.SQUARE_LOCATION_ID, reference_id: code, line_items: [{ name: PASS.name, quantity: '1', note: 'For ' + me.email, base_price_money: { amount: PASS.price, currency: 'USD' } }] },
      checkout_options: { redirect_url: `${site}/tinylegends/club/members/?paid=1`, ask_for_shipping_address: false, allow_tipping: false },
      pre_populated_data: { buyer_email: me.email }
    } });
    await st.setJSON('paylink/' + code, { orderId: d.payment_link.order_id, linkId: d.payment_link.id, at });
    await st.setJSON('orders/' + code, { code, at, source: 'website', mode: 'square', name: me.member.name || '', email: me.email, address: '',
      items: [{ qty: 1, name: PASS.name, meta: 'digital, one account', sku: PASS.sku, shop: 'tla', amount: PASS.price / 100 }], shops: ['tla'],
      subtotal: PASS.price / 100, shipping: 0, total: PASS.price / 100, custom: false, digital: true, note: '', files: [], status: 'new', tracking: '', carrier: '', staffNote: '',
      payment: { state: 'pending' }, history: [{ at, by: 'website', status: 'new' }] });
    await st.setJSON(mkey(me.email), { ...me.member, pending: code });
    return json({ url: d.payment_link.url });
  }

  // team only below
  if (!me.admin) throw new HttpError(403, 'Team only.');
  if (b.action === 'content') {
    const c = b.content || {};
    const out = { discount: Math.max(0, Math.min(50, Math.round(Number(c.discount) || 0))), welcome: s(c.welcome, 400),
      episodes: cleanList(c.episodes), bts: cleanList(c.bts), printables: cleanList(c.printables, true), savedAt: new Date().toISOString(), savedBy: me.email };
    await st.setJSON('club/content', out);
    return json(out);
  }
  if (b.action === 'upload') {
    const buf = Buffer.from(String(b.data || ''), 'base64');
    if (!buf.length || buf.length > 4.2e6) throw new HttpError(413, 'Files must be under 4 MB.');
    const type = /^(application\/pdf|image\/(png|jpeg|webp)|application\/zip)$/.test(b.type) ? b.type : 'application/octet-stream';
    const id = randomBytes(10).toString('hex');
    await st.set('clubfile/' + id, buf, { metadata: { type, name: s(b.name, 120) || 'download' } });
    return json({ id, name: s(b.name, 120) });
  }
  throw new HttpError(400, 'Unknown action');
});
