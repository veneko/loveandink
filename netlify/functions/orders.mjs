// Back office Orders: every website checkout from all four shops, with Square payment status.
import { wrap, json, store, requireAdmin, sq, sqReady, HttpError } from '../lib/lib.mjs';
const STATUSES = ['new', 'production', 'packed', 'shipped', 'delivered', 'cancelled'];
const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'];
async function syncPayments(list) {
  if (!sqReady()) return;
  const want = list.filter(o => o.mode === 'square' && !['paid', 'refunded', 'canceled'].includes(o.payment && o.payment.state));
  if (!want.length) return;
  const links = await Promise.all(want.map(o => store().get('paylink/' + o.code, { type: 'json' })));
  const ids = links.map(l => l && l.orderId).filter(Boolean); if (!ids.length) return;
  const d = await sq('/v2/orders/batch-retrieve', { body: { location_id: process.env.SQUARE_LOCATION_ID, order_ids: ids.slice(0, 100) } }).catch(() => null);
  const by = Object.fromEntries(((d && d.orders) || []).map(o => [o.id, o]));
  for (let i = 0; i < want.length; i++) {
    const so = links[i] && by[links[i].orderId]; if (!so) continue;
    const paid = (so.tenders || []).length > 0 || so.state === 'COMPLETED';
    const refunded = (so.refunds || []).length > 0;
    const state = refunded ? 'refunded' : so.state === 'CANCELED' ? 'canceled' : paid ? 'paid' : 'pending';
    if (state === want[i].payment.state) continue;
    want[i].payment = { state, squareOrder: so.id, amount: so.total_money ? so.total_money.amount / 100 : null, at: new Date().toISOString() };
    if (so.fulfillments && so.fulfillments[0] && so.fulfillments[0].shipment_details && !want[i].address) {
      const r = so.fulfillments[0].shipment_details.recipient || {}, a = r.address || {};
      want[i].address = [r.display_name, a.address_line_1, a.address_line_2, [a.locality, a.administrative_district_level_1, a.postal_code].filter(Boolean).join(' ')].filter(Boolean).join('\n');
    }
    await store().setJSON('orders/' + want[i].code, want[i]);
  }
}
export default wrap(async req => {
  const me = await requireAdmin(req); const u = new URL(req.url), st = store();
  if (req.method === 'GET' && u.searchParams.has('file')) {
    const id = u.searchParams.get('file'); if (!/^[a-f0-9]{20}$/.test(id)) throw new HttpError(404, 'Not found');
    const r = await st.getWithMetadata('orderfile/' + id, { type: 'arrayBuffer' }); if (!r) throw new HttpError(404, 'Not found');
    return new Response(r.data, { headers: { 'Content-Type': r.metadata.type || 'image/jpeg', 'Content-Disposition': `inline; filename="${String(r.metadata.name || 'art').replace(/[^\w.-]/g, '')}.jpg"`, 'Cache-Control': 'private, max-age=3600' } });
  }
  if (req.method === 'GET') {
    const { blobs } = await st.list({ prefix: 'orders/' });
    const list = (await Promise.all(blobs.map(b => st.get(b.key, { type: 'json' })))).filter(Boolean);
    await syncPayments(list).catch(e => console.error('sync', e));
    list.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return json({ orders: list, square: sqReady() });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = await req.json().catch(() => ({}));
  const code = String(b.code || '').replace(/[^\w-]/g, ''); const o = await st.get('orders/' + code, { type: 'json' });
  if (!o) throw new HttpError(404, 'That order is gone.');
  const at = new Date().toISOString(), by = me.email.split('@')[0];
  if (b.status && b.status !== o.status) { if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Unknown status'); o.status = b.status; o.history = [...(o.history || []), { at, by, status: b.status }] }
  if (b.tracking != null) o.tracking = String(b.tracking).replace(/[^\w-]/g, '').slice(0, 40);
  if (b.carrier != null) o.carrier = CARRIERS.includes(b.carrier) ? b.carrier : '';
  if (b.staffNote != null) o.staffNote = String(b.staffNote).slice(0, 1000);
  o.updatedAt = at; o.updatedBy = by;
  await st.setJSON('orders/' + code, o);
  return json(o);
});
