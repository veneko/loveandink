/* Legends Club Pass: shared helpers for the landing page and the Members Lounge. */
window.Club = (() => {
  const API = '/.netlify/functions/club';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function api(qs = '', opt = {}) {
    const r = await fetch(API + qs, { credentials: 'same-origin', ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.');
    return d;
  }
  const me = qs => api(qs || '');
  const signOut = () => api('', { method: 'DELETE' });
  const buy = () => api('', { method: 'POST', body: JSON.stringify({ action: 'buy' }) });
  let cfg;
  async function config() { return cfg || (cfg = await api('?config')) }
  /** Draws the Google button into el; resolves the signed-in member after a successful sign-in. */
  async function googleButton(el, onDone, onErr) {
    const c = await config();
    if (!c.clientId) { el.innerHTML = '<p class="err">Sign-in is being set up. Check back soon.</p>'; return }
    const go = () => {
      google.accounts.id.initialize({ client_id: c.clientId, ux_mode: 'popup', auto_select: false, callback: async res => {
        try { onDone(await api('', { method: 'POST', body: JSON.stringify({ action: 'signin', credential: res.credential }) })) } catch (e) { onErr && onErr(e) }
      } });
      google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
    };
    if (window.google && google.accounts) go();
    else { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = go; s.onerror = () => onErr && onErr(new Error('Google sign-in could not load. Check your connection.')); document.head.appendChild(s) }
  }
  const sinceText = iso => { if (!iso) return 'Founding member'; try { return 'Member since ' + new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) } catch (e) { return 'Member' } };
  return { api, me, signOut, buy, config, googleButton, esc, sinceText };
})();
