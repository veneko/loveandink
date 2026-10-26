// Images uploaded in the Studio (banners, promo art). GET /media/<id> is public; POST needs an admin.
import { wrap, json, store, requireAdmin, HttpError } from '../lib/lib.mjs';
import { randomBytes } from 'node:crypto';
export default wrap(async req => {
  const u = new URL(req.url);
  if (req.method === 'GET' && u.searchParams.has('list')) {
    await requireAdmin(req);
    const { blobs } = await store().list({ prefix: 'media/' });
    const items = await Promise.all(blobs.map(async b => { const m = await store().getMetadata(b.key).catch(() => null); const md = (m && m.metadata) || {}; return { id: b.key.slice(6), url: `/media/${b.key.slice(6)}.${(md.type || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg')}`, name: md.name || '', at: md.at || '', brand: !!md.brand } }));
    return json({ items: items.sort((a, b) => (b.at || '').localeCompare(a.at || '')) });
  }
  if (req.method === 'GET') {
    const id = (u.searchParams.get('id') || '').replace(/\.\w+$/, '');
    if (!/^[a-f0-9]{20}$/.test(id)) throw new HttpError(404, 'Not found');
    const r = await store().getWithMetadata('media/' + id, { type: 'arrayBuffer' });
    if (!r) throw new HttpError(404, 'Not found');
    return new Response(r.data, { headers: { 'Content-Type': r.metadata.type || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const me = await requireAdmin(req);
  const b = await req.json().catch(() => ({}));
  const m = String(b.data || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/); if (!m) throw new HttpError(400, 'Use a JPG, PNG, WebP or GIF.');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4.5e6) throw new HttpError(400, 'That image is too large. Try one under 4 MB.');
  const id = randomBytes(10).toString('hex'), ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  await store().set('media/' + id, buf, { metadata: { type: m[1], by: me.email, at: new Date().toISOString(), name: String(b.name || '').slice(0, 80), brand: !!b.brand } });
  return json({ url: `/media/${id}.${ext}` });
});
