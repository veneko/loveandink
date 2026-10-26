// Turning website checkouts into order records for the back office.
import { store } from './lib.mjs';
import { randomBytes } from 'node:crypto';
export const SHOPS = { TLA: 'tla', LI: 'li', PUB: 'pub', CUSTOM: 'prints', SQV: 'tla' };
export const shopOf = sku => SHOPS[String(sku || '').split('-')[0].toUpperCase()] || 'other';
const money = s => Number(String(s || '').replace(/[^0-9.]/g, '')) || 0;
export function parseItems(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d+)\s*×\s*(.+?)(?:\s+\((.*)\))?\s+\[([^\]]*)\]\s+(\$[\d.,]+)\s*$/);
    if (!m) return { qty: 1, name: l, meta: '', sku: '', shop: 'other', amount: 0 };
    return { qty: +m[1], name: m[2], meta: m[3] || '', sku: m[4], shop: shopOf(m[4]), amount: money(m[5]) };
  });
}
/** Save a copy of a customer upload (custom print art) privately, since form file links expire. */
export async function keepFile(url, name) {
  try {
    const r = await fetch(url); if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 9e6) return null;
    const id = randomBytes(10).toString('hex');
    await store().set('orderfile/' + id, buf, { metadata: { type: r.headers.get('content-type') || 'image/jpeg', name } });
    return id;
  } catch (e) { return null }
}
export async function orderFromForm(id, at, f, files) {
  const code = String(f.code || '').replace(/[^\w-]/g, '').slice(0, 20) || 'LI-' + id.slice(-6).toUpperCase();
  const kept = [];
  for (const x of files || []) { const fid = await keepFile(x.url, x.name); kept.push(fid ? { id: fid, name: x.name } : { url: x.url, name: x.name }) }
  const items = parseItems(f.items);
  return {
    code, at, source: 'website', mode: f.mode || 'preorder', name: f.name || '', email: f.email || '', address: f.address || '',
    items, shops: [...new Set(items.map(i => i.shop))], subtotal: money(f.subtotal), shipping: money(f.shipping), total: money(f.total),
    custom: items.some(i => i.shop === 'prints'), note: f.note || '', files: kept, status: 'new', tracking: '', carrier: '', staffNote: '',
    payment: { state: f.mode === 'square' ? 'pending' : 'not charged' }, history: [{ at, by: 'website', status: 'new' }]
  };
}
