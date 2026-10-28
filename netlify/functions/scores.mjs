// Evaluna's Arcade scoreboard (Netlify Function + Blobs, no outside database).
// Public: GET ?start=<game> (run token), GET ?game=&range= (top 10), POST a score.
// Team only (back office sign-in): GET ?admin=1, POST {action:'remove'|'unban'}.
// No accounts, emails or real names; nicknames are A–Z/0–9 only and run through a kid-safe filter.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { json, requireAdmin, HttpError } from '../lib/lib.mjs';

const GAMES = { blocks: { max: 80000, perSec: 450 }, chop: { max: 6000, perSec: 14 } };
// Long words match anywhere; short ones only as a whole word or with a tiny ending (keeps KNIGHT, CASSIE, GRAPE).
const BAD_LONG = ['FUCK', 'SHIT', 'BITCH', 'DICK', 'COCK', 'PUSSY', 'CUNT', 'PORN', 'PUTA', 'PUTO', 'MIERDA', 'CULO', 'PENDEJ', 'VERGA', 'CHINGA', 'MARICON', 'PINGA', 'CARAJO', 'SLUT', 'NAZI', 'NIGG', 'PENIS', 'CABRON', 'COJON', 'WHORE', 'BOOB', 'HITLER'];
const BAD_SHORT = ['ASS', 'HOE', 'SEX', 'FAG', 'NIG', 'KKK', 'FUK', 'FCK', 'RAPE', 'TETA', 'CUM', 'TIT', 'GAY'];
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const ok = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

export function cleanNick(n) {
  const c = String(n || '').toUpperCase().replace(/[^A-Z0-9 _]/g, '').replace(/\s+/g, ' ').trim().slice(0, 10);
  if (c.replace(/[ _]/g, '').length < 3) return '';
  const flat = c.replace(/[ _0-9]/g, '');
  if (BAD_LONG.some(w => flat.includes(w))) return '';
  const words = [...c.split(/[ _0-9]+/).filter(Boolean), flat];
  if (words.some(t => BAD_SHORT.some(w => t.startsWith(w) && t.length <= w.length + 2))) return '';
  return c;
}

async function secret(st) {
  if (process.env.SCORE_SECRET) return process.env.SCORE_SECRET;
  let s = await st.get('secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); await st.set('secret', s); s = (await st.get('secret')) || s; }
  return s;
}

export default async (req) => {
  const url = new URL(req.url);
  const st = getStore({ name: 'tl-arcade', consistency: 'strong' });
  try {
    if (req.method === 'GET' && url.searchParams.get('admin')) return await admin(req, st);
    if (req.method === 'POST' && (req.headers.get('content-type') || '').includes('json') && url.searchParams.get('admin')) return await adminPost(req, st);

    const SECRET = await secret(st);
    const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);

    if (req.method === 'GET') {
      const start = url.searchParams.get('start');
      if (start) {
        if (!GAMES[start]) return ok({ error: 'bad game' }, 400);
        const p = `${start}.${Date.now().toString(36)}.${crypto.randomBytes(8).toString('hex')}`;
        try { const k = `plays-${day()}`; const c = (await st.get(k, { type: 'json' })) || {}; c[start] = (c[start] || 0) + 1; await st.setJSON(k, c); } catch (e) {}
        return ok({ token: `${p}.${sign(p)}` });
      }
      const game = url.searchParams.get('game');
      if (!GAMES[game]) return ok({ error: 'bad game' }, 400);
      const range = url.searchParams.get('range') || 'all';
      const list = (await st.get(`scores-${game}`, { type: 'json' })) || [];
      const win = { day: 864e5, week: 6048e5 }[range], now = Date.now();
      const entries = (win ? list.filter(e => now - e.ts < win) : list)
        .sort((a, b) => b.score - a.score || a.ts - b.ts).slice(0, 10)
        .map(({ name, score, ts }) => ({ name, score, ts }));
      return ok({ entries }, 200, { 'cache-control': 'public, max-age=10' });
    }

    if (req.method !== 'POST') return ok({ error: 'method not allowed' }, 405);
    const raw = await req.text();
    if (raw.length > 2000) return ok({ error: 'too big' }, 413);
    let b; try { b = JSON.parse(raw); } catch { return ok({ error: 'bad json' }, 400); }
    const g = GAMES[b && b.game];
    if (!g) return ok({ error: 'bad game' }, 400);
    const name = cleanNick(b.name);
    const banned = (await st.get('banned', { type: 'json' })) || [];
    if (!name || banned.includes(name)) return ok({ error: 'Pick a different 3–10 letter nickname.' }, 400);
    const score = Math.floor(Number(b.score));
    if (!Number.isFinite(score) || score < 1 || score > g.max) return ok({ error: 'bad score' }, 400);

    const parts = String(b.token || '').split('.');
    if (parts.length !== 4) return ok({ error: 'bad token' }, 400);
    const [tg, ts, nonce, sig] = parts;
    if (tg !== b.game || !/^[a-f0-9]{16}$/.test(nonce) || sign(`${tg}.${ts}.${nonce}`) !== sig) return ok({ error: 'bad token' }, 400);
    // Time is measured on the server from when the run's token was issued, so it can't be faked.
    const age = (Date.now() - parseInt(ts, 36)) / 1000;
    if (!(age >= 0) || age > 8 * 3600) return ok({ error: 'expired' }, 400);
    const resumed = Math.min(Math.max(0, Number(b.duration) || 0), 8 * 3600); // a continued Bedtime Blocks night carries earlier play time
    const duration = Math.max(1, b.game === 'blocks' ? Math.min(resumed, age + 2 * 3600) : age);
    if (score > g.perSec * duration + 600) return ok({ error: 'too fast' }, 400);

    const ip = req.headers.get('x-nf-client-connection-ip') || 'anon';
    const ipKey = `ip-${sign(ip).slice(0, 16)}`;
    const last = Number((await st.get(ipKey)) || 0);
    if (Date.now() - last < 8000) return ok({ error: 'slow down' }, 429);
    await st.set(ipKey, String(Date.now()));

    const usedKey = `used-${day(parseInt(ts, 36))}`; // one post per run; grouped by day so it doesn't pile up forever
    const used = (await st.get(usedKey, { type: 'json' })) || [];
    if (used.includes(nonce)) return ok({ error: 'already posted' }, 409);
    used.push(nonce); await st.setJSON(usedKey, used.slice(-20000));

    const key = `scores-${b.game}`;
    let list = (await st.get(key, { type: 'json' })) || [];
    const entry = { name, score, ts: Date.now() };
    list.push(entry);
    const weekAgo = Date.now() - 6048e5;
    const top = [...list].sort((a, z) => z.score - a.score).slice(0, 100);
    const recent = list.filter(e => e.ts > weekAgo).slice(-3000);
    const keep = new Map();
    [...top, ...recent].forEach(e => keep.set(`${e.ts}|${e.name}|${e.score}`, e));
    list = [...keep.values()];
    await st.setJSON(key, list);
    const rank = [...list].sort((a, z) => z.score - a.score || a.ts - z.ts).findIndex(e => e.ts === entry.ts && e.name === name) + 1;
    return ok({ ok: true, rank });
  } catch (e) {
    return json({ error: e.message || 'Something went wrong.' }, e.status || 500);
  }
};

async function admin(req, st) {
  await requireAdmin(req);
  const out = { games: {}, plays: [], banned: (await st.get('banned', { type: 'json' })) || [] };
  for (const g of Object.keys(GAMES)) {
    const list = (await st.get(`scores-${g}`, { type: 'json' })) || [];
    out.games[g] = { total: list.length, top: [...list].sort((a, b) => b.score - a.score).slice(0, 25), latest: [...list].sort((a, b) => b.ts - a.ts).slice(0, 25) };
  }
  for (let i = 13; i >= 0; i--) { const d = day(Date.now() - i * 864e5); out.plays.push({ day: d, ...((await st.get(`plays-${d}`, { type: 'json' })) || {}) }); }
  return json(out);
}

async function adminPost(req, st) {
  await requireAdmin(req);
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || '').toUpperCase().replace(/[^A-Z0-9 _]/g, '').slice(0, 10);
  if (!name) throw new HttpError(400, 'Missing nickname');
  let banned = (await st.get('banned', { type: 'json' })) || [];
  if (b.action === 'unban') { await st.setJSON('banned', banned.filter(n => n !== name)); return json({ ok: true }); }
  if (b.action !== 'remove') throw new HttpError(400, 'Unknown action');
  // Removes every score under that nickname from both games and blocks the nickname from coming back.
  let removed = 0;
  for (const g of Object.keys(GAMES)) {
    const list = (await st.get(`scores-${g}`, { type: 'json' })) || [];
    const kept = list.filter(e => e.name !== name); removed += list.length - kept.length;
    if (kept.length !== list.length) await st.setJSON(`scores-${g}`, kept);
  }
  if (b.ban !== false && !banned.includes(name)) { banned.push(name); await st.setJSON('banned', banned.slice(-2000)); }
  return json({ ok: true, removed });
}
