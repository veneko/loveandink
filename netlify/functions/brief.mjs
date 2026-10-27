// Morning check for the daily brief. Counts only: no customer names, emails, addresses or money.
import { wrap, json, store, sqReady, loadCatalog } from '../lib/lib.mjs';
export default wrap(async () => {
  const st = store(), now = Date.now();
  const list = async p => { const { blobs } = await st.list({ prefix: p }); return (await Promise.all(blobs.map(b => st.get(b.key, { type: 'json' })))).filter(Boolean) };
  const [orders, inbox, live, draft, cal] = await Promise.all([list('orders/'), list('inbox/'), st.get('site/live', { type: 'json' }), st.get('site/draft', { type: 'json' }), st.get('calendar', { type: 'json' })]);
  const open = orders.filter(o => ['new', 'production', 'packed'].includes(o.status));
  const oldest = open.reduce((m, o) => Math.max(m, (now - new Date(o.at)) / 36e5), 0);
  let stock = { connected: sqReady(), soldOut: 0, low: 0, items: 0 };
  if (sqReady()) { try { const c = await loadCatalog(); stock.items = c.length; c.forEach(i => i.variations.forEach(v => { if (v.stock === 0) stock.soldOut++; else if (v.stock != null && v.stock <= 3) stock.low++ })) } catch (e) { stock.error = true } }
  const day = d => new Date(d).toISOString().slice(0, 10), today = day(now), wk = day(now + 7 * 864e5);
  const c = cal || [];
  return json({
    at: new Date().toISOString(),
    orders: { new: orders.filter(o => o.status === 'new').length, inProduction: orders.filter(o => o.status === 'production').length, packed: orders.filter(o => o.status === 'packed').length,
      last24h: orders.filter(o => now - new Date(o.at) < 864e5).length, oldestOpenHours: Math.round(oldest), awaitingPayment: orders.filter(o => o.payment && o.payment.state === 'pending').length },
    inbox: { new: inbox.filter(m => m.status === 'new' && m.form !== 'preorder').length },
    stock, website: { draftWaiting: !!(draft && (!live || draft.savedAt > (live.publishedAt || ''))), lastPublished: live && live.publishedAt || null, livePromos: ((live && live.promos) || []).filter(p => p.on && (!p.end || new Date(p.end) > now)).length },
    calendar: { today: c.filter(p => p.date === today).length, next7Days: c.filter(p => p.date > today && p.date <= wk).length, notReadyNext7: c.filter(p => p.date >= today && p.date <= wk && ['idea', 'draft'].includes(p.status)).length }
  }, 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
});
