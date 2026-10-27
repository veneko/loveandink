// Back office content calendar: posts, reels, drops and emails across all brands.
import { wrap, json, store, requireAdmin, HttpError } from '../lib/lib.mjs';
const s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const pick = (v, list, d) => list.includes(v) ? v : d;
const BRANDS = ['li', 'prints', 'pub', 'lifestyle', 'tla'], PLAT = ['instagram', 'tiktok', 'youtube', 'facebook', 'etsy', 'email', 'site', 'inperson'];
const TYPES = ['post', 'reel', 'story', 'video', 'drop', 'promo', 'listing', 'event', 'email', 'live'], STAT = ['idea', 'draft', 'scheduled', 'posted'];
function clean(p) {
  return { id: s(p.id, 30).replace(/[^\w-]/g, '') || 'c' + Date.now().toString(36), date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : new Date().toISOString().slice(0, 10),
    time: /^\d{2}:\d{2}$/.test(p.time || '') ? p.time : '', end: /^\d{4}-\d{2}-\d{2}$/.test(p.end || '') && p.end >= p.date ? p.end : '', place: s(p.place, 160), brand: pick(p.brand, BRANDS, 'tla'), platforms: (Array.isArray(p.platforms) ? p.platforms : []).filter(x => PLAT.includes(x)).slice(0, 6),
    type: pick(p.type, TYPES, 'post'), status: pick(p.status, STAT, 'idea'), title: s(p.title, 140), caption: s(p.caption, 2200), hashtags: s(p.hashtags, 500),
    link: s(p.link, 300), item: s(p.item, 80), promo: s(p.promo, 40), assets: (Array.isArray(p.assets) ? p.assets : []).filter(u => /^(\/|https:\/\/)/.test(u)).slice(0, 8).map(u => s(u, 400)),
    owner: s(p.owner, 40), notes: s(p.notes, 1000) };
}
export default wrap(async req => {
  const me = await requireAdmin(req), st = store();
  const all = (await st.get('calendar', { type: 'json' })) || [];
  if (req.method === 'GET') return json({ items: all });
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = await req.json().catch(() => ({}));
  let out = all;
  if (b.action === 'save') { const it = clean(b.item || {}); it.updatedBy = me.email.split('@')[0]; it.updatedAt = new Date().toISOString(); const i = all.findIndex(x => x.id === it.id); if (i >= 0) out[i] = it; else out.push(it) }
  else if (b.action === 'delete') out = all.filter(x => x.id !== String(b.id))
  else throw new HttpError(400, 'Unknown action');
  if (out.length > 3000) throw new HttpError(400, 'Calendar is full.');
  await st.setJSON('calendar', out); return json({ items: out });
});
