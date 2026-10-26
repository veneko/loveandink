// Site content Square doesn't hold: recipes, announcement bar, closet picks, hero video order.
// GET is public (read by the Tiny Legends page). PUT needs a signed-in admin.
import { wrap, json, store, requireAdmin, HttpError } from '../lib/lib.mjs';
const str = (v, n = 2000) => typeof v === 'string' ? v.slice(0, n) : '';
const langs = (a, n) => Array.isArray(a) ? a.slice(0, 6).map(x => str(x, n)) : [str(a, n)];
function clean(c) {
  const out = {};
  if (Array.isArray(c.recipes)) out.recipes = c.recipes.slice(0, 40).map(r => ({ id: str(r.id, 40).replace(/[^a-z0-9_-]/gi, '') || 'r' + Math.random().toString(36).slice(2, 8), who: str(r.who, 20), color: str(r.color, 40), name: langs(r.name, 120), meta: langs(r.meta, 160), ing: langs(r.ing, 3000), steps: langs(r.steps, 6000) }));
  if (c.announcement) out.announcement = { on: !!c.announcement.on, text: langs(c.announcement.text, 120) };
  if (c.picks && typeof c.picks === 'object') { out.picks = {}; for (const k of ['c', 'j', 'e']) out.picks[k] = (Array.isArray(c.picks[k]) ? c.picks[k] : []).slice(0, 2).map(x => str(x, 40)) }
  if (Array.isArray(c.hero)) out.hero = c.hero.slice(0, 20).map(x => str(x, 40));
  return out;
}
export default wrap(async req => {
  if (req.method === 'GET') {
    const c = await store().get('content', { type: 'json' });
    return json(c || {}, 200, { 'Cache-Control': 'public, max-age=0, must-revalidate', 'Netlify-CDN-Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60' });
  }
  if (req.method !== 'PUT') throw new HttpError(405, 'Method not allowed');
  const s = await requireAdmin(req);
  const body = await req.json().catch(() => null); if (!body) throw new HttpError(400, 'Bad request');
  const prev = (await store().get('content', { type: 'json' })) || {};
  const next = { ...prev, ...clean(body), updatedBy: s.email, updatedAt: new Date().toISOString() };
  await store().setJSON('content', next);
  await store().setJSON('content-history/' + Date.now(), prev);
  return json(next);
});
