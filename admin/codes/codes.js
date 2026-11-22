(function () {
  const cloud = window.AVEIR_CLOUD;
  const WORKER = (window.AVEIR_PAY && window.AVEIR_PAY.worker) || '';
  const MIN_PCT = 1;
  const MAX_PCT = 90;
  const MAX_BATCH = 50;
  const MAX_USES = 1000;
  const PAGE_SIZE = 60;
  const BIG_PCT_WARNING = 50;
  const KIND_NAMES = { manual: 'MADE HERE', welcome: 'SIGNUP', receipt: 'RECEIPT' };
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const $ = id => document.getElementById(id);
  const gate = $('gate');

  let codes = [];
  let made = [];
  let filter = 'active';
  let kind = '';
  let query = '';
  let shown = PAGE_SIZE;
  let busy = false;
  let wired = false;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function note(text, k) {
    const el = $('note');
    el.textContent = text || '';
    el.className = 'av-note' + (k ? ' is-' + k : '');
  }

  function clamp(v, lo, hi, dflt) {
    const n = Math.round(Number(v));
    if (!isFinite(n) || !String(v).trim()) return dflt;
    return Math.min(hi, Math.max(lo, n));
  }

  function cleanCode(v) {
    return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function dateText(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  async function call(action, extra) {
    if (!WORKER) throw new Error('payment server is not set up');
    const token = await cloud.idToken();
    if (!token) throw new Error('sign in again');
    const r = await fetch(WORKER + '/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token, action }, extra || {}))
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('server said ' + r.status));
    return j;
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    }
  }

  function flash(btn, text) {
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1400);
  }

  function isLive(c) { return !c.disabled && c.uses < c.maxUses; }

  function form() {
    const pct = clamp($('pct').value, MIN_PCT, MAX_PCT, 0);
    const count = clamp($('count1').value, 1, MAX_BATCH, 1);
    const uses = clamp($('uses').value, 1, MAX_USES, 1);
    const code = count === 1 ? cleanCode($('custom').value) : '';
    return { pct, count, uses, code, note: $('noteIn').value.trim().slice(0, 60) };
  }

  function renderForm() {
    const f = form();
    document.querySelectorAll('#pctRow .av-pct').forEach(b => b.classList.toggle('is-on', Number(b.dataset.pct) === f.pct));
    $('custom').disabled = f.count > 1;
    $('customField').style.opacity = f.count > 1 ? '.45' : '';
    const useText = f.uses === 1 ? 'ONE USE EACH' : f.uses + ' USES EACH';
    $('sum').textContent = f.pct
      ? (f.count === 1 ? '1 CODE' : f.count + ' CODES') + ' FOR ' + f.pct + '% OFF, ' + useText + '. SHIPPING IS NEVER DISCOUNTED.'
      : 'PICK A PERCENT BETWEEN ' + MIN_PCT + ' AND ' + MAX_PCT + '.';
    $('makeBtn').textContent = busy ? 'MAKING...' : (f.count === 1 ? 'MAKE CODE' : 'MAKE ' + f.count + ' CODES');
    $('makeBtn').disabled = busy || !f.pct;
  }

  function codeRow(c, opts) {
    const live = isLive(c);
    const k = KIND_NAMES[c.kind] ? c.kind : 'other';
    const chip = '<span class="av-chip av-chip-' + k + '">' + esc(KIND_NAMES[c.kind] || String(c.kind || 'OTHER').toUpperCase()) + '</span>';
    const dead = c.disabled ? '<span class="av-chip av-chip-dead">KILLED</span>' : (!live ? '<span class="av-chip av-chip-dead">USED UP</span>' : '');
    const meta = [];
    meta.push(c.maxUses === 1 ? (c.uses ? 'USED' : 'NOT USED YET') : 'USED ' + c.uses + ' / ' + c.maxUses);
    if (c.createdAt) meta.push('MADE ' + dateText(c.createdAt));
    if (c.lastOrder) meta.push('LAST ORDER ' + esc(c.lastOrder));
    if (c.email) meta.push(esc(c.email.toUpperCase()));
    if (c.orderNumber) meta.push('FROM ORDER ' + esc(c.orderNumber));
    const noteLine = c.note ? '<br><span class="av-code-note">' + esc(c.note.toUpperCase()) + '</span>' : '';
    const actions = '<button class="av-btn-ghost" type="button" data-copy="' + esc(c.code) + '">COPY</button>' +
      (opts.kill && live ? '<button class="av-btn-ghost av-btn-danger" type="button" data-kill="' + esc(c.code) + '">KILL</button>' : '');
    return '<div class="av-code' + (live ? '' : ' is-dead') + '">' +
      '<div><span class="av-code-name">' + esc(c.code) + '</span><span class="av-code-pct">' + c.pct + '% OFF</span>' + chip + dead +
      '<div class="av-code-meta">' + meta.join(' &middot; ') + noteLine + '</div></div>' +
      '<div class="av-code-actions">' + actions + '</div></div>';
  }

  function visible() {
    const q = query.toUpperCase();
    return codes.filter(c => {
      if (filter === 'active' && !isLive(c)) return false;
      if (filter === 'used' && isLive(c)) return false;
      if (kind && c.kind !== kind) return false;
      if (!q) return true;
      return [c.code, c.note, c.email, c.orderNumber, c.lastOrder].some(v => String(v || '').toUpperCase().includes(q));
    });
  }

  function renderList() {
    const list = visible();
    const live = codes.filter(isLive).length;
    $('count').textContent = live + ' ACTIVE';
    $('listCount').textContent = list.length + (list.length === 1 ? ' CODE' : ' CODES');
    if (!list.length) {
      $('codeList').innerHTML = '<div class="av-empty">' + (codes.length ? 'NOTHING MATCHES.' : 'NO CODES YET. MAKE ONE ON THE RIGHT.') + '</div>';
      return;
    }
    const more = list.length > shown
      ? '<button class="av-btn-ghost av-more" type="button" id="moreBtn">SHOW ' + Math.min(PAGE_SIZE, list.length - shown) + ' MORE</button>'
      : '';
    $('codeList').innerHTML = list.slice(0, shown).map(c => codeRow(c, { kill: true })).join('') + more;
  }

  function renderMade() {
    $('madePanel').hidden = !made.length;
    $('madeList').innerHTML = made.map(c => codeRow(c, { kill: false })).join('');
  }

  function renderFixed() {
    const promos = (window.AVEIR_STORE && window.AVEIR_STORE.promos) || {};
    const keys = Object.keys(promos);
    if (!keys.length) return;
    $('fixedList').innerHTML = keys.map(k => '<div class="av-code"><div><span class="av-code-name">' + esc(k.toUpperCase()) + '</span>' +
      '<span class="av-code-pct">' + Math.round(Number(promos[k]) * 100) + '% OFF</span><span class="av-chip av-chip-other">ALWAYS ON</span>' +
      '<div class="av-code-meta">UNLIMITED USES</div></div>' +
      '<div class="av-code-actions"><button class="av-btn-ghost" type="button" data-copy="' + esc(k.toUpperCase()) + '">COPY</button></div></div>').join('');
  }

  async function load() {
    $('codeList').innerHTML = '<div class="av-empty">LOADING...</div>';
    try {
      const j = await call('list');
      codes = j.codes || [];
      renderList();
    } catch (e) {
      $('codeList').innerHTML = '<div class="av-empty">COULD NOT LOAD CODES: ' + esc(String(e.message || e).toUpperCase()) + '</div>';
    }
  }

  async function make() {
    const f = form();
    if (!f.pct || busy) return;
    if (f.pct >= BIG_PCT_WARNING && !confirm(f.pct + '% OFF IS A LOT. MAKE ' + (f.count === 1 ? 'THIS CODE' : 'THESE ' + f.count + ' CODES') + '?')) return;
    busy = true;
    note('');
    renderForm();
    try {
      const j = await call('create', f);
      const now = new Date().toISOString();
      const fresh = (j.codes || []).map(code => ({ code, pct: j.pct, kind: 'manual', uses: 0, maxUses: j.uses, note: f.note, email: '', orderNumber: '', lastOrder: '', disabled: false, createdAt: now }));
      made = fresh.concat(made);
      codes = fresh.concat(codes.filter(c => !fresh.some(x => x.code === c.code)));
      $('custom').value = '';
      renderMade();
      renderList();
      const short = fresh.length < f.count ? ' (ONLY ' + fresh.length + ' OF ' + f.count + ' WENT THROUGH)' : '';
      note((fresh.length === 1 ? 'MADE ' + fresh[0].code : 'MADE ' + fresh.length + ' CODES') + short + '. THEY WORK AT CHECKOUT RIGHT NOW.', short ? 'bad' : 'good');
    } catch (e) {
      note(String(e.message || e).toUpperCase(), 'bad');
    }
    busy = false;
    renderForm();
  }

  async function kill(code, btn) {
    if (!confirm('KILL ' + code + '? IT STOPS WORKING AT CHECKOUT RIGHT AWAY. THIS CANNOT BE UNDONE.')) return;
    btn.disabled = true;
    btn.textContent = 'KILLING...';
    try {
      await call('kill', { code });
      codes.forEach(c => { if (c.code === code) c.disabled = true; });
      made.forEach(c => { if (c.code === code) c.disabled = true; });
      renderList();
      renderMade();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'KILL';
      alert('COULD NOT KILL ' + code + ': ' + String(e.message || e).toUpperCase());
    }
  }

  function tabs(id, attr, set) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('.av-tab');
      if (!b) return;
      $(id).querySelectorAll('.av-tab').forEach(t => t.classList.toggle('is-on', t === b));
      set(b.dataset[attr]);
      shown = PAGE_SIZE;
      renderList();
    });
  }

  function wire() {
    if (wired) return;
    wired = true;
    $('pctRow').addEventListener('click', e => {
      const b = e.target.closest('.av-pct');
      if (!b) return;
      $('pct').value = b.dataset.pct;
      renderForm();
    });
    ['pct', 'count1', 'uses', 'custom', 'noteIn'].forEach(id => $(id).addEventListener('input', renderForm));
    $('makeBtn').addEventListener('click', make);
    $('custom').addEventListener('keydown', e => { if (e.key === 'Enter') make(); });
    $('noteIn').addEventListener('keydown', e => { if (e.key === 'Enter') make(); });
    tabs('filterTabs', 'filter', v => { filter = v; });
    tabs('kindTabs', 'kind', v => { kind = v; });
    $('search').addEventListener('input', e => { query = e.target.value.trim(); shown = PAGE_SIZE; renderList(); });
    $('refreshBtn').addEventListener('click', load);
    $('copyAll').addEventListener('click', async e => {
      const ok = await copy(made.map(c => c.code).join('\n'));
      flash(e.target, ok ? 'COPIED ' + made.length : 'COPY FAILED');
    });
    document.addEventListener('click', async e => {
      const c = e.target.closest('[data-copy]');
      if (c) { flash(c, (await copy(c.dataset.copy)) ? 'COPIED' : 'FAILED'); return; }
      const k = e.target.closest('[data-kill]');
      if (k) { kill(k.dataset.kill, k); return; }
      if (e.target.id === 'moreBtn') { shown += PAGE_SIZE; renderList(); }
    });
    $('signout').addEventListener('click', () => cloud.signOut());
  }

  function start(staff) {
    $('me').textContent = staff.email || '';
    gate.hidden = true;
    wire();
    renderForm();
    renderFixed();
    load();
  }

  if (!cloud || !cloud.configured) {
    gate.textContent = 'ADMIN LOGIN IS NOT CONNECTED YET';
    return;
  }

  cloud.watchStaff(s => {
    if (s.state === 'loading') { gate.hidden = false; gate.textContent = 'CHECKING ACCESS...'; return; }
    if (s.state === 'in') {
      if (s.staff.role === 'admin') { start(s.staff); return; }
      gate.hidden = false;
      gate.innerHTML = 'YOU ARE SIGNED IN AS ' + esc(String(s.user.email).toUpperCase()) + ' BUT ONLY ADMINS CAN MAKE CODES.<br><br><a href="../orders/" style="color:#ff06bc;">BACK TO ORDERS</a>';
      return;
    }
    location.replace('../login/?next=' + encodeURIComponent('../codes/'));
  });
})();
