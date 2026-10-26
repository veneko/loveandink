// Netlify calls this for every verified form submission (fan messages, pre-orders, reviews, notify-me).
// It files a copy in the back office inbox.
import { store } from '../lib/lib.mjs';
export default async req => {
  try {
    const { payload: p = {} } = await req.json();
    const d = p.data || {}, at = p.created_at || new Date().toISOString();
    const id = at.replace(/[^0-9]/g, '').slice(0, 14) + '-' + String(p.id || Math.random().toString(36).slice(2)).slice(-8);
    const files = Object.entries(d).filter(([, v]) => v && typeof v === 'object' && v.url).map(([k, v]) => ({ field: k, url: v.url, name: v.filename || k }));
    const fields = Object.fromEntries(Object.entries(d).filter(([k, v]) => typeof v === 'string' && !['ip', 'user_agent', 'referrer', 'bot-field', 'form-name'].includes(k)).map(([k, v]) => [k, v.slice(0, 4000)]));
    await store().setJSON('inbox/' + id, { id, at, form: p.form_name || d['form-name'] || 'form', name: p.name || fields.name || '', email: p.email || fields.email || '', fields, files, page: d.referrer || '', status: 'new' });
  } catch (e) { console.error('inbox', e) }
  return new Response('ok');
};
