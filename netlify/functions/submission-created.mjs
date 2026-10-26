// Netlify calls this for every verified form submission (fan messages, pre-orders, reviews, notify-me).
// Messages go to the back office inbox; checkouts also become orders on the Orders board.
import { store } from '../lib/lib.mjs';
import { orderFromForm } from '../lib/orders.mjs';
export default async req => {
  try {
    const { payload: p = {} } = await req.json();
    const d = p.data || {}, at = p.created_at || new Date().toISOString();
    const id = at.replace(/[^0-9]/g, '').slice(0, 14) + '-' + String(p.id || Math.random().toString(36).slice(2)).slice(-8);
    const files = Object.entries(d).filter(([, v]) => v && typeof v === 'object' && v.url).map(([k, v]) => ({ field: k, url: v.url, name: v.filename || k }));
    const fields = Object.fromEntries(Object.entries(d).filter(([k, v]) => typeof v === 'string' && !['ip', 'user_agent', 'referrer', 'bot-field', 'form-name'].includes(k)).map(([k, v]) => [k, v.slice(0, 4000)]));
    const form = p.form_name || d['form-name'] || 'form';
    await store().setJSON('inbox/' + id, { id, at, form, name: p.name || fields.name || '', email: p.email || fields.email || '', fields, files, page: d.referrer || '', status: form === 'preorder' ? 'read' : 'new' });
    if (form === 'preorder') {
      const o = await orderFromForm(id, at, fields, files);
      const prev = await store().get('orders/' + o.code, { type: 'json' });
      if (!prev) await store().setJSON('orders/' + o.code, o);
    }
  } catch (e) { console.error('submission', e) }
  return new Response('ok');
};
