// Netlify Function: live stock for SKUs. GET /.netlify/functions/stock?skus=TLA-UNDEFEATED-BABY,LI-BRISA-M
// Returns { "SKU": quantity } for variations that track inventory in Square.
const API = process.env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
const H = () => ({ 'Square-Version': '2025-01-23', Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' });
const post = async (p, b) => (await fetch(API + p, { method: 'POST', headers: H(), body: JSON.stringify(b) })).json();
export default async (req) => {
  const skus = (new URL(req.url).searchParams.get('skus') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
  if (!skus.length || !process.env.SQUARE_ACCESS_TOKEN) return Response.json({});
  const vars = {};
  await Promise.all(skus.map(async sku => { const d = await post('/v2/catalog/search', { object_types: ['ITEM_VARIATION'], query: { exact_query: { attribute_name: 'sku', attribute_value: sku } } }); const v = (d.objects || [])[0]; if (v && v.item_variation_data.track_inventory) vars[v.id] = sku }));
  const ids = Object.keys(vars); if (!ids.length) return Response.json({});
  const d = await post('/v2/inventory/counts/batch-retrieve', { catalog_object_ids: ids, location_ids: [process.env.SQUARE_LOCATION_ID], states: ['IN_STOCK'] });
  const out = Object.fromEntries(ids.map(id => [vars[id], 0]));
  (d.counts || []).forEach(c => { out[vars[c.catalog_object_id]] = Number(c.quantity) });
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
};
