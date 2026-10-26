// Back office API (signed-in admins only): Square products, prices, stock, photos, hide/show; connection status.
import { wrap, json, requireAdmin, sq, sqReady, sqBase, loadCatalog, autoSku, categoryName, HttpError } from '../lib/lib.mjs';
import { randomUUID } from 'node:crypto';
const key = () => randomUUID();
const money = n => { const v = Math.round(Number(n) * 100); if (!(v >= 0 && v < 1e7)) throw new HttpError(400, 'Check the price.'); return { amount: v, currency: 'USD' } };
async function categoryId(brand, section) {
  const name = categoryName(brand, section);
  const d = await sq('/v2/catalog/search', { body: { object_types: ['CATEGORY'], query: { exact_query: { attribute_name: 'name', attribute_value: name } } } });
  if (d.objects && d.objects[0]) return d.objects[0].id;
  const c = await sq('/v2/catalog/object', { body: { idempotency_key: key(), object: { type: 'CATEGORY', id: '#cat', category_data: { name } } } });
  return c.catalog_object.id;
}
async function getObj(id) { return (await sq('/v2/catalog/object/' + encodeURIComponent(id), { method: 'GET' })).object }
async function saveItem(it) {
  const name = String(it.name || '').trim().slice(0, 120); if (!name) throw new HttpError(400, 'Give the item a name.');
  const vars = (it.variations || []).filter(v => String(v.name || '').trim()); if (!vars.length) throw new HttpError(400, 'Add at least one size or option.');
  const cat = await categoryId(it.brand, it.section);
  const obj = it.sqId ? await getObj(it.sqId) : { type: 'ITEM', id: '#item', item_data: {} };
  const d = obj.item_data;
  d.name = name; d.description = String(it.description || '').slice(0, 1000); d.categories = [{ id: cat }]; d.reporting_category = { id: cat };
  const existing = Object.fromEntries((d.variations || []).map(v => [v.id, v]));
  const pre = ({ tla: 'TLA', li: 'LI', pub: 'PUB' })[it.brand] || 'TLA', stem = ((d.variations || []).map(v => (v.item_variation_data.sku || '').match(new RegExp('^' + pre + '-[A-Z0-9_]+'))).find(Boolean) || [])[0];
  d.variations = vars.map((v, i) => { const old = v.sqId && existing[v.sqId];
    const vd = old ? old.item_variation_data : { pricing_type: 'FIXED_PRICING', track_inventory: true };
    vd.name = String(v.name).trim().slice(0, 60); vd.price_money = money(v.price); vd.pricing_type = 'FIXED_PRICING';
    vd.sku = (old && vd.sku) || String(v.sku || '').trim() || autoSku(it.brand, name, vd.name, stem); vd.item_id = obj.id; if (vd.track_inventory == null) vd.track_inventory = true;
    return old ? { ...old, item_variation_data: vd } : { type: 'ITEM_VARIATION', id: '#v' + i, item_variation_data: vd } });
  const r = await sq('/v2/catalog/object', { body: { idempotency_key: key(), object: obj } });
  return r.catalog_object.id;
}
export default wrap(async req => {
  const s = await requireAdmin(req);
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('what') === 'status') {
      if (!sqReady()) return json({ me: s.email, square: { connected: false } });
      const loc = await sq('/v2/locations/' + process.env.SQUARE_LOCATION_ID, { method: 'GET' }).catch(e => ({ error: e.message }));
      return json({ me: s.email, square: { connected: !loc.error, error: loc.error || null, env: process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox', location: loc.location ? loc.location.name : null, dashboard: process.env.SQUARE_ENV === 'production' ? 'https://squareup.com/dashboard/items/library' : 'https://squareupsandbox.com/dashboard/items/library', api: sqBase() } });
    }
    return json({ items: await loadCatalog({ includeArchived: true }) });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = await req.json().catch(() => ({}));
  switch (b.action) {
    case 'save': return json({ sqId: await saveItem(b.item || {}) });
    case 'stock': {
      const q = Math.max(0, Math.min(99999, parseInt(b.quantity, 10) || 0));
      await sq('/v2/inventory/changes/batch-create', { body: { idempotency_key: key(), changes: [{ type: 'PHYSICAL_COUNT', physical_count: { catalog_object_id: String(b.variationId), location_id: process.env.SQUARE_LOCATION_ID, quantity: String(q), state: 'IN_STOCK', occurred_at: new Date().toISOString() } }] } });
      return json({ ok: true, quantity: q });
    }
    case 'archive': case 'restore': {
      const obj = await getObj(String(b.sqId)); obj.item_data.is_archived = b.action === 'archive';
      await sq('/v2/catalog/object', { body: { idempotency_key: key(), object: obj } }); return json({ ok: true });
    }
    case 'photo': {
      const m = String(b.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!m) throw new HttpError(400, 'Use a JPG, PNG or WebP photo.');
      const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4.5e6) throw new HttpError(400, 'That photo is too large. Try one under 4 MB.');
      const form = new FormData();
      form.append('request', new Blob([JSON.stringify({ idempotency_key: key(), object_id: String(b.sqId), is_primary: true, image: { type: 'IMAGE', id: '#img', image_data: { caption: String(b.caption || '').slice(0, 80) } } })], { type: 'application/json' }));
      form.append('image_file', new Blob([buf], { type: m[1] }), 'photo.' + m[1].split('/')[1]);
      const r = await sq('/v2/catalog/images', { form }); return json({ imageId: r.image.id });
    }
    default: throw new HttpError(400, 'Unknown action');
  }
});
