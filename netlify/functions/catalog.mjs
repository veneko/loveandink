// Public: Tiny Legends products, prices and stock straight from Square.
import { wrap, json, sqReady, loadCatalog } from '../lib/lib.mjs';
export default wrap(async () => {
  if (!sqReady()) return json({ connected: false, items: [] }, 200, { 'Cache-Control': 'public, max-age=60' });
  const all = await loadCatalog({ includeArchived: true });
  const hidden = all.filter(i => i.archived).flatMap(i => i.variations.map(v => v.sku).filter(Boolean));
  const items = all.filter(i => !i.archived).map(({ version, archived, ...i }) => ({ ...i, variations: i.variations.map(({ version, track, ...v }) => v) }));
  return json({ connected: true, items, hidden }, 200, { 'Cache-Control': 'public, max-age=0, must-revalidate', 'Netlify-CDN-Cache-Control': 'public, s-maxage=45, stale-while-revalidate=300' });
});
