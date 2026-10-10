(function () {
  const cloud = window.AVEIR_CLOUD;
  const P = window.AVEIR_PRODUCTS;
  const MAX_PICKS = 24;
  const PREVIEW_LIMIT = 12;
  const PROBE_BASE = '../../';
  const $ = id => document.getElementById(id);
  const gate = $('gate');

  let me = null;
  let mode = 'auto';
  let picks = [];
  let saved = '';
  let all = [];
  let shots = {};
  let busy = false;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function money(n) { return '$' + (Number(n) || 0).toFixed(2); }

  function note(text, kind) {
    const el = $('note');
    el.textContent = text || '';
    el.className = 'av-note' + (kind ? ' is-' + kind : '');
  }

  function shot(p) { return p.cover || shots[p.slug] || ''; }
  function hasShot(p) { return !!shot(p); }

  function state() { return JSON.stringify({ mode, picks }); }
  function dirty() { return state() !== saved; }

  function probe(p) {
    if (p.cover || shots[p.slug] !== undefined) return Promise.resolve();
    const colors = (p.colors && p.colors.length ? p.colors : (window.AVEIR_COLORS || ['black', 'white'])).slice(0, 8);
    const kind = p.kind || 'tees';
    return new Promise(resolve => {
      let i = 0;
      const next = () => {
        if (i >= colors.length) { shots[p.slug] = ''; resolve(); return; }
        const url = PROBE_BASE + kind + '/' + p.slug + '/' + colors[i++] + '.png';
        const img = new Image();
        img.onload = () => { shots[p.slug] = url; resolve(); };
        img.onerror = next;
        img.src = url;
      };
      next();
    });
  }

  function find(slug) { return all.find(p => p.slug === slug) || null; }

  function card(p, body) {
    const src = shot(p);
    const art = src ? '<img src="' + esc(src) + '" alt="">' : '<span>AVR</span>';
    return '<div class="av-pick' + (src ? '' : ' is-dim') + '">' +
      '<span class="av-pick-shot">' + art + '</span>' +
      '<span class="av-pick-main">' +
        '<span class="av-pick-name">' + esc(p.name || p.slug) + '</span>' +
        '<span class="av-pick-meta">' + esc(String(p.kind || 'tees').toUpperCase()) + ' - ' + money(p.price) +
          (src ? '' : ' - <b>NO PHOTO, STAYS HIDDEN</b>') +
          (p.cloud ? '' : ' - <b>IN CODE</b>') +
        '</span>' +
      '</span>' +
      '<span class="av-pick-actions">' + body + '</span>' +
    '</div>';
  }

  function renderPicks() {
    const list = picks.map(find).filter(Boolean);
    $('pickCount').textContent = list.length ? list.length + ' PICKED' : '';
    if (!list.length) {
      $('pickList').innerHTML = '<div class="av-empty">NOTHING PICKED YET. ADD SOMETHING BELOW.</div>';
      return;
    }
    $('pickList').innerHTML = list.map((p, i) => card(p,
      '<span class="av-ord">' + (i + 1) + '</span>' +
      '<button type="button" data-up="' + esc(p.slug) + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">&#8593;</button>' +
      '<button type="button" data-down="' + esc(p.slug) + '"' + (i === list.length - 1 ? ' disabled' : '') + ' aria-label="Move down">&#8595;</button>' +
      '<button type="button" data-remove="' + esc(p.slug) + '" aria-label="Remove">&#10005;</button>'
    )).join('');
  }

  function renderPool() {
    const list = all.filter(p => picks.indexOf(p.slug) < 0);
    $('poolCount').textContent = list.length ? list.length + ' AVAILABLE' : '';
    if (!list.length) {
      $('poolList').innerHTML = '<div class="av-empty">EVERYTHING IS ALREADY PICKED.</div>';
      return;
    }
    $('poolList').innerHTML = list.map(p => card(p,
      '<button type="button" data-add="' + esc(p.slug) + '"' + (picks.length >= MAX_PICKS ? ' disabled' : '') + '>+ ADD</button>'
    )).join('');
  }

  function previewList() {
    const live = all.filter(hasShot);
    if (mode === 'manual' && picks.length) {
      const got = picks.map(find).filter(p => p && hasShot(p));
      if (got.length) return got.slice(0, PREVIEW_LIMIT);
    }
    return (P ? P.newest(live.length) : live).filter(hasShot).slice(0, PREVIEW_LIMIT);
  }

  function renderPreview() {
    const list = previewList();
    $('count').textContent = list.length ? list.length + ' SHOWING' : 'NOTHING TO SHOW';
    if (!list.length) {
      $('preview').innerHTML = '<div class="av-empty">NO PRODUCT HAS A PHOTO YET.</div>';
      return;
    }
    $('preview').innerHTML = list.map(p =>
      '<div class="av-prev-card">' +
        '<span class="av-prev-shot"><img src="' + esc(shot(p)) + '" alt=""></span>' +
        '<span class="av-prev-name">' + esc(p.name || p.slug) + '</span>' +
      '</div>'
    ).join('');
  }

  function render() {
    const manual = mode === 'manual';
    Array.prototype.forEach.call($('modeTabs').children, b => {
      b.classList.toggle('is-on', b.dataset.mode === mode);
    });
    $('modeNote').textContent = manual
      ? 'THE ROW SHOWS EXACTLY WHAT YOU PICK, IN YOUR ORDER. GOOD FOR A PROMO OR A DROP.'
      : 'THE ROW SHOWS THE NEWEST PRODUCTS FIRST. NOTHING TO MANAGE.';
    $('pickPanel').hidden = !manual;
    $('poolPanel').hidden = !manual;
    if (manual) { renderPicks(); renderPool(); }
    renderPreview();
    $('saveBtn').disabled = busy || !dirty();
    $('saveBtn').textContent = busy ? 'SAVING...' : 'SAVE';
  }

  function move(slug, step) {
    const i = picks.indexOf(slug);
    const j = i + step;
    if (i < 0 || j < 0 || j >= picks.length) return;
    picks.splice(j, 0, picks.splice(i, 1)[0]);
    render();
  }

  async function save() {
    if (busy || !dirty()) return;
    busy = true;
    note('');
    render();
    try {
      await cloud.saveArrivals(mode, picks);
      saved = state();
      note('SAVED. THE HOMEPAGE WILL PICK IT UP ON THE NEXT LOAD.', 'good');
    } catch (e) {
      note('COULD NOT SAVE: ' + String(e && e.message ? e.message : e).toUpperCase(), 'bad');
    }
    busy = false;
    render();
  }

  function wire() {
    $('modeTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b || b.dataset.mode === mode) return;
      mode = b.dataset.mode;
      note('');
      render();
    });

    document.addEventListener('click', e => {
      const t = e.target.closest ? e.target.closest('[data-add],[data-remove],[data-up],[data-down]') : null;
      if (!t) return;
      if (t.dataset.add) {
        if (picks.length >= MAX_PICKS) { note('THAT IS THE MAXIMUM OF ' + MAX_PICKS + '.', 'bad'); return; }
        picks.push(t.dataset.add);
      }
      if (t.dataset.remove) picks = picks.filter(s => s !== t.dataset.remove);
      if (t.dataset.up) move(t.dataset.up, -1);
      if (t.dataset.down) move(t.dataset.down, 1);
      note('');
      render();
    });

    $('saveBtn').addEventListener('click', save);
    $('signout').addEventListener('click', () => cloud.signOut());
    window.addEventListener('beforeunload', e => {
      if (!dirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  async function start(staff) {
    me = staff;
    $('me').textContent = staff.email || '';
    gate.hidden = true;

    if (P) await P.ready;
    all = (window.AVEIR_CATALOG || []).slice();
    await Promise.all(all.map(probe));

    const cfg = await cloud.getArrivals().catch(() => ({ mode: 'auto', picks: [] }));
    mode = cfg.mode === 'manual' ? 'manual' : 'auto';
    picks = (cfg.picks || []).filter(find);
    saved = state();

    wire();
    render();
  }

  if (!cloud || !cloud.configured) {
    gate.textContent = 'ADMIN LOGIN IS NOT CONNECTED YET';
    return;
  }

  cloud.watchStaff(s => {
    if (s.state === 'loading') { gate.hidden = false; gate.textContent = 'CHECKING ACCESS...'; return; }
    if (s.state === 'in') {
      if (s.staff.role === 'admin' || s.staff.products === true) { start(s.staff); return; }
      gate.hidden = false;
      gate.innerHTML = 'YOU ARE SIGNED IN AS ' + esc(String(s.user.email).toUpperCase()) + ' BUT YOU DO NOT HAVE THE PRODUCTS PERMISSION YET.<br><br>ASK AN ADMIN TO TURN IT ON FOR YOU ON THE TEAM PAGE.<br><br><a href="../orders/" style="color:#ff06bc;">BACK TO ORDERS</a>';
      return;
    }
    location.replace('../login/?next=' + encodeURIComponent('../arrivals/'));
  });
})();
