// Shared helpers for Love & Ink Netlify Functions.
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
export const wrap = fn => async (req, ctx) => { try { return await fn(req, ctx) } catch (e) { return json({ error: e.message || 'Something went wrong.' }, e.status || 500) } };
export const store = () => getStore({ name: 'loveandink', consistency: 'strong' });

/* ---------- admins + sessions ---------- */
export const ADMINS = () => (process.env.ADMIN_EMAILS || 'jasminemorsini@gmail.com,venekoraw@gmail.com').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
export const newId = () => randomBytes(24).toString('hex');
export function cookie(req, name) { const c = req.headers.get('cookie') || ''; const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : null }
export async function session(req) {
  const id = cookie(req, 'li_admin'); if (!id || !/^[a-f0-9]{48}$/.test(id)) return null;
  const s = await store().get('session/' + id, { type: 'json' });
  if (!s || s.exp < Date.now() || !ADMINS().includes(s.email)) return null;
  return { ...s, id };
}
export async function requireAdmin(req) {
  const s = await session(req); if (!s) throw new HttpError(401, 'Please sign in again.');
  if (req.method !== 'GET') { const o = req.headers.get('origin'); if (o && new URL(o).host !== new URL(req.url).host) throw new HttpError(403, 'Blocked: wrong origin.') }
  return s;
}

/* ---------- Square ---------- */
export const sqReady = () => !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
export const sqBase = () => process.env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
export async function sq(path, { method = 'POST', body, form } = {}) {
  if (!sqReady()) throw new HttpError(503, 'Square is not connected yet.');
  const headers = { 'Square-Version': '2025-01-23', Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}` };
  if (!form) headers['Content-Type'] = 'application/json';
  const r = await fetch(sqBase() + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = d.errors && d.errors[0]; throw new HttpError(r.status === 401 ? 503 : 502, e ? (e.detail || e.code) : 'Square error') }
  return d;
}
export const BRANDS = {
  tla: { prefix: 'Tiny Legends', sku: 'TLA', sections: { wear: 'Wear', baby: 'Baby', studio: 'Stickers & Studio', books: 'Books & Prints', digital: 'Digital' } },
  li:  { prefix: 'Lifestyle',    sku: 'LI',  sections: { men: 'Men', women: 'Women', swim: 'Swim', acc: 'Accessories' } },
  pub: { prefix: 'Publishing',   sku: 'PUB', sections: { books: 'Books', digital: 'Digital', art: 'Art prints' } }
};
export const categoryName = (brand, section) => { const B = BRANDS[brand] || BRANDS.tla; return `${B.prefix} · ${B.sections[section] || Object.values(B.sections)[0]}` };
function brandOf(catName) {
  for (const [k, B] of Object.entries(BRANDS)) if (catName.startsWith(B.prefix)) {
    const s = (catName.split('·')[1] || '').trim().toLowerCase();
    return { brand: k, section: Object.keys(B.sections).find(x => B.sections[x].toLowerCase() === s) || Object.keys(B.sections)[0] };
  }
  return null;
}
const slug = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').slice(0, 24).replace(/^_+|_+$/g, '');
/** New SKU for a size/option. Reuses the item's existing SKU stem (e.g. TLA-UNDEFEATED) so checkout and the site keep matching. */
export const autoSku = (brand, itemName, varName, stem) => (stem || ((BRANDS[brand] || BRANDS.tla).sku + '-' + slug(itemName))) + (varName && !/^(regular|one size)$/i.test(varName) ? '-' + slug(varName) : '');

/** Read the Love & Ink part of the Square catalog (all three shops), with stock. */
export async function loadCatalog({ includeArchived = false } = {}) {
  const items = [], related = {}; let cursor;
  do {
    const d = await sq('/v2/catalog/search', { body: { object_types: ['ITEM'], include_related_objects: true, cursor, limit: 100 } });
    items.push(...(d.objects || [])); (d.related_objects || []).forEach(o => related[o.id] = o); cursor = d.cursor;
  } while (cursor);
  const catName = id => related[id] && related[id].category_data ? related[id].category_data.name : '';
  const out = [];
  for (const it of items) {
    const d = it.item_data || {}; if (d.is_archived && !includeArchived) continue;
    const catIds = [...(d.categories || []).map(c => c.id), d.category_id, d.reporting_category && d.reporting_category.id].filter(Boolean);
    const bs = catIds.map(catName).map(brandOf).find(Boolean); if (!bs) continue;
    const vars = (d.variations || []).filter(v => !v.is_deleted).map(v => { const vd = v.item_variation_data || {};
      return { sqId: v.id, version: v.version, name: vd.name || 'Regular', sku: vd.sku || '', price: vd.price_money ? Number(vd.price_money.amount) / 100 : 0, track: vd.track_inventory !== false, stock: null } });
    const pre = BRANDS[bs.brand].sku, re = new RegExp('^' + pre + '-([A-Z0-9_]+?)(?:-|$)');
    const base = (vars.map(v => (v.sku.match(re) || [])[1]).find(Boolean) || '').toLowerCase();
    out.push({ sqId: it.id, version: it.version, brand: bs.brand, section: bs.section, id: base || 'sq' + it.id.slice(-8).toLowerCase(), name: d.name || 'Untitled', description: d.description_plaintext || d.description || '',
      image: (d.image_ids || [])[0] || null, archived: !!d.is_archived, variations: vars });
  }
  const ids = out.flatMap(i => i.variations.map(v => v.sqId));
  for (let i = 0; i < ids.length; i += 100) {
    const d = await sq('/v2/inventory/counts/batch-retrieve', { body: { catalog_object_ids: ids.slice(i, i + 100), location_ids: [process.env.SQUARE_LOCATION_ID], states: ['IN_STOCK'] } });
    (d.counts || []).forEach(c => { for (const it of out) for (const v of it.variations) if (v.sqId === c.catalog_object_id) v.stock = Number(c.quantity) });
  }
  out.forEach(it => it.variations.forEach(v => { if (v.track && v.stock == null) v.stock = 0; if (!v.track) v.stock = null }));
  return out;
}
