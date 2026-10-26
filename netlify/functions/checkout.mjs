// Netlify Function: turns a Love & Ink bag into a Square payment link.
// Prices and stock come from Square (by SKU), never from the browser.
// Env vars (set in Netlify > Site configuration > Environment variables):
//   SQUARE_ACCESS_TOKEN  (Sandbox token first, then Production)
//   SQUARE_LOCATION_ID
//   SQUARE_ENV           "sandbox" or "production"
import { loadSquare } from '../lib/lib.mjs';
let API;
const H = () => ({ 'Square-Version': '2025-01-23', Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' });
// Custom prints are priced in the Prints studio; the server only accepts prices inside these ranges (USD).
const CUSTOM_RANGE = { MUG: [22, 28], TUMBLER: [32, 52], APPAREL: [28, 54], KEYCHAIN: [12, 18] };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
async function sq(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error((d.errors && d.errors[0] && d.errors[0].detail) || 'Square error');
  return d;
}
export default async (req) => {
  await loadSquare(); API = process.env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) return json({ error: 'Checkout is not connected yet.' }, 503);
  let p; try { p = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const items = Array.isArray(p.items) ? p.items.slice(0, 30) : [];
  if (!items.length) return json({ error: 'Your bag is empty.' }, 400);
  const code = String(p.code || '').slice(0, 12), email = String((p.customer && p.customer.email) || '').slice(0, 120);
  try {
    const catalog = items.filter(i => !/^CUSTOM-/.test(i.sku));
    const found = {};
    await Promise.all([...new Set(catalog.map(i => i.sku))].map(async sku => {
      let v;
      if (/^SQV-[A-Z0-9]+$/i.test(sku)) { // items added in Square without a SKU: the variation id travels instead
        const r = await fetch(API + '/v2/catalog/object/' + sku.slice(4), { headers: H() }); const d = await r.json().catch(() => ({}));
        if (r.ok && d.object && d.object.type === 'ITEM_VARIATION' && !d.object.is_deleted) v = d.object;
      } else {
        const d = await sq('/v2/catalog/search', { object_types: ['ITEM_VARIATION'], query: { exact_query: { attribute_name: 'sku', attribute_value: sku } } });
        v = (d.objects || [])[0];
      }
      if (v) found[sku] = v;
    }));
    const missing = catalog.find(i => !found[i.sku]);
    if (missing) return json({ error: `${missing.name} isn’t available right now.` }, 409);
    // stock check (only for variations that track inventory)
    const ids = Object.values(found).filter(v => v.item_variation_data.track_inventory).map(v => v.id);
    if (ids.length) {
      const d = await sq('/v2/inventory/counts/batch-retrieve', { catalog_object_ids: ids, location_ids: [process.env.SQUARE_LOCATION_ID], states: ['IN_STOCK'] });
      const have = Object.fromEntries((d.counts || []).map(c => [c.catalog_object_id, Number(c.quantity)]));
      for (const i of catalog) { const v = found[i.sku]; if (v.item_variation_data.track_inventory) { const n = have[v.id] || 0; if (n < i.qty) return json({ error: n ? `Only ${n} left of ${i.name}.` : `${i.name} just sold out.` }, 409) } }
    }
    let subtotal = 0;
    const line_items = items.map(i => {
      const qty = Math.max(1, Math.min(20, parseInt(i.qty, 10) || 1)), note = String(i.meta || '').slice(0, 400);
      if (/^CUSTOM-/.test(i.sku)) {
        const r = CUSTOM_RANGE[i.sku.slice(7)], price = Number(i.price);
        if (!r || !(price >= r[0] && price <= r[1])) throw new Error(`Price check failed for ${i.name}.`);
        subtotal += price * qty;
        return { name: String(i.name).slice(0, 120), quantity: String(qty), note, base_price_money: { amount: Math.round(price * 100), currency: 'USD' } };
      }
      const v = found[i.sku]; subtotal += Number(v.item_variation_data.price_money.amount) / 100 * qty;
      return { catalog_object_id: v.id, quantity: String(qty), note };
    });
    const order = { location_id: process.env.SQUARE_LOCATION_ID, reference_id: code, line_items };
    if (subtotal < 75) order.service_charges = [{ name: 'Shipping', amount_money: { amount: 650, currency: 'USD' }, calculation_phase: 'SUBTOTAL_PHASE' }];
    const site = process.env.URL || 'https://loveandink.co';
    const d = await sq('/v2/online-checkout/payment-links', {
      idempotency_key: `${code}-${Date.now()}`, order,
      checkout_options: { redirect_url: `${site}/?order=${encodeURIComponent(code)}`, ask_for_shipping_address: true, allow_tipping: false },
      pre_populated_data: email ? { buyer_email: email } : undefined
    });
    return json({ url: d.payment_link.url });
  } catch (e) { return json({ error: e.message || 'Checkout is busy. Try again.' }, 502) }
};
