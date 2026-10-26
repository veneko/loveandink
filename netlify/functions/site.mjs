// Website customizations made in the back office Studio: text, theme colors, swapped images, promos.
// Draft is what the Studio edits and previews; Publish copies it live and keeps a version history.
import { wrap, json, store, requireAdmin, session, HttpError } from '../lib/lib.mjs';
const EMPTY = { text: {}, theme: {}, images: {}, layout: {}, promos: [] };
const s = v => typeof v === 'string' ? v : '';
const hex = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : '';
const url = v => { v = s(v).trim(); return /^(\/[^\s]*|https:\/\/[^\s]+)$/.test(v) ? v.slice(0, 600) : '' };
function clean(d) {
  const o = { text: {}, theme: {}, images: {}, layout: {}, promos: [] };
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) * 1000) / 1000 || 0));
  for (const [k, v] of Object.entries(d.layout || {}).slice(0, 400)) if (/^[\w:./#\-]{1,140}$/.test(k) && v && typeof v === 'object') o.layout[k] = { x: num(v.x, -500, 500), y: num(v.y, -500, 500), s: num(v.s, .2, 4) || 1 };
  for (const [k, v] of Object.entries(d.text || {}).slice(0, 1500)) {
    if (!/^[\w:.\-]{1,80}$/.test(k)) continue;
    if (typeof v === 'string') o.text[k] = v.slice(0, 1200);
    else if (v && typeof v === 'object') { o.text[k] = {}; for (const [l, t] of Object.entries(v)) if (/^[a-z]{2}$/.test(l)) o.text[k][l] = s(t).slice(0, 1200) }
  }
  for (const [w, c] of Object.entries(d.theme || {}).slice(0, 20)) {
    if (!/^[a-z]{2,16}$/.test(w) || !c) continue; o.theme[w] = {};
    for (const [k, v] of Object.entries(c)) if (/^[a-z]{1,12}$/.test(k) && hex(v)) o.theme[w][k] = v;
  }
  for (const [k, v] of Object.entries(d.images || {}).slice(0, 300)) if (/^[\w:./\-]{1,120}$/.test(k) && url(v)) o.images[k] = url(v);
  o.promos = (Array.isArray(d.promos) ? d.promos : []).slice(0, 30).map(p => ({
    id: s(p.id).replace(/[^\w-]/g, '').slice(0, 30) || 'p' + Date.now().toString(36), on: !!p.on,
    kind: ['popup', 'bar'].includes(p.kind) ? p.kind : 'popup', name: s(p.name).slice(0, 80),
    eyebrow: s(p.eyebrow).slice(0, 60), title: s(p.title).slice(0, 120), body: s(p.body).slice(0, 400),
    cta: s(p.cta).slice(0, 40), link: url(p.link), image: url(p.image), code: s(p.code).replace(/[^\w-]/g, '').slice(0, 24),
    pages: (Array.isArray(p.pages) ? p.pages : []).filter(x => /^[a-z]{2,16}$/.test(x)).slice(0, 8),
    start: s(p.start).slice(0, 16), end: s(p.end).slice(0, 16), freq: ['once', 'day', 'visit'].includes(p.freq) ? p.freq : 'once',
    delay: Math.max(0, Math.min(60, parseInt(p.delay, 10) || 0)), bg: hex(p.bg), fg: hex(p.fg), accent: hex(p.accent), v: Math.max(1, parseInt(p.v, 10) || 1)
  }));
  return o;
}
export default wrap(async req => {
  const u = new URL(req.url), st = store();
  if (req.method === 'GET') {
    if (u.searchParams.has('draft') || u.searchParams.has('history')) {
      const me = await session(req);
      if (!me) { const live = await st.get('site/live', { type: 'json' }); return json(live || EMPTY) }
      if (u.searchParams.has('history')) {
        const idx = (await st.get('site/history-index', { type: 'json' })) || [];
        return json({ versions: idx });
      }
      const [draft, live] = await Promise.all([st.get('site/draft', { type: 'json' }), st.get('site/live', { type: 'json' })]);
      return json({ ...(draft || live || EMPTY), publishedAt: live && live.publishedAt || null, dirty: !!draft && (!live || draft.savedAt > (live.publishedAt || '')) });
    }
    const live = await st.get('site/live', { type: 'json' });
    return json(live || EMPTY, 200, { 'Cache-Control': 'public, max-age=0, must-revalidate', 'Netlify-CDN-Cache-Control': 'public, s-maxage=10, stale-while-revalidate=120' });
  }
  const me = await requireAdmin(req);
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null); if (!body) throw new HttpError(400, 'Bad request');
    const d = { ...clean(body), savedAt: new Date().toISOString(), savedBy: me.email };
    await st.setJSON('site/draft', d); return json({ ok: true, savedAt: d.savedAt });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = await req.json().catch(() => ({}));
  if (b.action === 'publish') {
    const draft = await st.get('site/draft', { type: 'json' }); if (!draft) throw new HttpError(400, 'Nothing to publish yet.');
    const at = new Date().toISOString(), live = { ...clean(draft), publishedAt: at, publishedBy: me.email };
    await st.setJSON('site/live', live);
    const id = at.replace(/[^0-9]/g, '').slice(0, 14);
    await st.setJSON('site/history/' + id, live);
    const idx = (await st.get('site/history-index', { type: 'json' })) || [];
    idx.unshift({ id, at, by: me.email, note: String(b.note || '').slice(0, 120) });
    await st.setJSON('site/history-index', idx.slice(0, 40));
    await st.setJSON('site/draft', { ...live, savedAt: at });
    return json({ ok: true, publishedAt: at });
  }
  if (b.action === 'restore') {
    const v = await st.get('site/history/' + String(b.id).replace(/\D/g, ''), { type: 'json' }); if (!v) throw new HttpError(404, 'That version is gone.');
    const d = { ...clean(v), savedAt: new Date().toISOString(), savedBy: me.email }; await st.setJSON('site/draft', d); return json(d);
  }
  if (b.action === 'discard') { await st.delete('site/draft'); return json({ ok: true }) }
  throw new HttpError(400, 'Unknown action');
});
