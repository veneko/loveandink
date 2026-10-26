// Back office inbox: everything fans and customers send through the site's forms.
import { wrap, json, store, requireAdmin, HttpError } from '../lib/lib.mjs';
export default wrap(async req => {
  await requireAdmin(req);
  const st = store();
  if (req.method === 'GET') {
    const { blobs } = await st.list({ prefix: 'inbox/' });
    const keys = blobs.map(b => b.key).sort().reverse().slice(0, 300);
    const items = (await Promise.all(keys.map(k => st.get(k, { type: 'json' })))).filter(Boolean);
    return json({ items });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = await req.json().catch(() => ({}));
  const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(x => String(x || '').replace(/[^\w-]/g, '')).filter(Boolean).slice(0, 100);
  if (!['new', 'read', 'done', 'archived'].includes(b.status)) throw new HttpError(400, 'Unknown status');
  await Promise.all(ids.map(async id => { const m = await st.get('inbox/' + id, { type: 'json' }); if (m) await st.setJSON('inbox/' + id, { ...m, status: b.status }) }));
  return json({ ok: true });
});
