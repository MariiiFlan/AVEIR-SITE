(function () {
  const cloud = window.AVEIR_CLOUD;
  const P = window.AVEIR_PRODUCTS;
  const MAX_PICKS = 12;
  const MIN_INTERVAL = 2500;
  const MAX_INTERVAL = 20000;
  const DEFAULT_INTERVAL = 6000;
  const PROBE_BASE = '../../';
  const $ = id => document.getElementById(id);
  const gate = $('gate');

  let me = null;
  let mode = 'auto';
  let picks = [];
  let interval = DEFAULT_INTERVAL;
  let saved = '';
  let all = [];
  let shots = {};
  let busy = false;
  let spin = 0;
  let timer = null;

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

  function state() { return JSON.stringify({ mode, picks, interval }); }
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

  function newest() {
    return all.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function slides() {
    if (mode === 'manual') {
      const out = [];
      picks.forEach(s => { const p = find(s); if (p && hasShot(p)) out.push(p); });
      return out;
    }
    return newest().filter(hasShot).slice(0, 1);
  }

  function card(p, body) {
    const src = shot(p);
    const art = src ? '<img src="' + esc(src) + '" alt="">' : '<span>AVR</span>';
    return '<div class="av-pick' + (src ? '' : ' is-dim') + '">' +
      '<span class="av-pick-shot">' + art + '</span>' +
      '<span class="av-pick-main">' +
        '<span class="av-pick-name">' + esc(p.name) + '</span>' +
        '<span class="av-pick-meta">' + esc((p.kind || 'tees').toUpperCase()) + ' - <b>' + money(p.price) + '</b>' +
          (src ? '' : ' - NO PHOTO') + '</span>' +
      '</span>' +
      '<span class="av-pick-actions">' + body + '</span>' +
    '</div>';
  }

  function renderPicks() {
    const el = $('pickList');
    $('pickCount').textContent = picks.length + ' / ' + MAX_PICKS;
    if (!picks.length) {
      el.innerHTML = '<div class="av-empty">NOTHING PICKED YET. ADD SOMETHING BELOW.</div>';
      return;
    }
    el.innerHTML = picks.map((slug, i) => {
      const p = find(slug);
      if (!p) return '';
      return card(p,
        '<span class="av-ord">' + (i + 1) + '</span>' +
        '<button type="button" data-up="' + esc(slug) + '"' + (i === 0 ? ' disabled' : '') + '>&#8593;</button>' +
        '<button type="button" data-down="' + esc(slug) + '"' + (i === picks.length - 1 ? ' disabled' : '') + '>&#8595;</button>' +
        '<button type="button" data-remove="' + esc(slug) + '">&#10005;</button>');
    }).join('');
  }

  function renderPool() {
    const rest = all.filter(p => picks.indexOf(p.slug) < 0);
    $('poolCount').textContent = rest.length + '';
    $('poolList').innerHTML = rest.length
      ? rest.map(p => card(p, '<button type="button" data-add="' + esc(p.slug) + '">ADD</button>')).join('')
      : '<div class="av-empty">EVERYTHING IS ALREADY IN THE BANNER.</div>';
  }

  function renderPreview() {
    const el = $('preview');
    const s = slides();
    if (!s.length) {
      el.innerHTML = '<div class="av-empty">NOTHING TO SHOW YET.</div>';
      $('prevRead').textContent = '';
      return;
    }
    if (spin >= s.length) spin = 0;
    const p = s[spin];
    const dots = s.length > 1
      ? '<div class="av-hp-dots">' + s.map((x, i) =>
          '<button class="av-hp-dot' + (i === spin ? ' is-on' : '') + '" type="button" data-dot="' + i + '"></button>').join('') + '</div>'
      : '';
    el.innerHTML =
      '<div class="av-hp-txt av-hp-anim" key="' + spin + '">' +
        '<span class="av-hp-kicker">LATEST DROP</span>' +
        '<span class="av-hp-name">' + esc(p.name) + '</span>' +
        '<span class="av-hp-price">' + money(p.price) + '</span>' +
        '<span class="av-hp-cta">SHOP THE DROP</span>' +
      '</div>' +
      '<div class="av-hp-img av-hp-anim"><img src="' + esc(shot(p)) + '" alt=""></div>' + dots;
    $('prevRead').textContent = s.length > 1 ? (spin + 1) + ' OF ' + s.length : '1 SLIDE';
  }

  function retime() {
    if (timer) { clearInterval(timer); timer = null; }
    if (slides().length < 2) return;
    timer = setInterval(() => { spin++; renderPreview(); }, interval);
  }

  function render() {
    const manual = mode === 'manual';
    Array.prototype.forEach.call($('modeTabs').children, b => {
      b.classList.toggle('is-on', b.dataset.mode === mode);
    });
    $('modeNote').textContent = manual
      ? 'THE BANNER CYCLES THROUGH EXACTLY WHAT YOU PICK, IN YOUR ORDER.'
      : 'THE BANNER SHOWS THE NEWEST PRODUCT. NOTHING TO MANAGE.';
    $('pickPanel').hidden = !manual;
    $('poolPanel').hidden = !manual;
    $('speedPanel').hidden = !manual;
    $('speed').value = String(interval);
    $('speedRead').textContent = (interval / 1000).toFixed(1).replace(/\.0$/, '') + ' SEC';
    $('count').textContent = manual ? picks.length + ' PICKED' : 'AUTOMATIC';
    if (manual) { renderPicks(); renderPool(); }
    renderPreview();
    retime();
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
      await cloud.saveHero(mode, picks, interval);
      saved = state();
      note('SAVED. THE FRONT PAGE WILL PICK IT UP ON THE NEXT LOAD.', 'good');
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
      spin = 0;
      note('');
      render();
    });

    $('speed').addEventListener('input', e => {
      interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Number(e.target.value) || DEFAULT_INTERVAL));
      $('speedRead').textContent = (interval / 1000).toFixed(1).replace(/\.0$/, '') + ' SEC';
      $('saveBtn').disabled = busy || !dirty();
    });
    $('speed').addEventListener('change', () => { note(''); render(); });

    document.addEventListener('click', e => {
      const t = e.target.closest ? e.target.closest('[data-add],[data-remove],[data-up],[data-down],[data-dot]') : null;
      if (!t) return;
      if (t.dataset.dot !== undefined) { spin = Number(t.dataset.dot) || 0; renderPreview(); retime(); return; }
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

    const cfg = await cloud.getHero().catch(() => ({ mode: 'auto', picks: [], intervalMs: DEFAULT_INTERVAL }));
    mode = cfg.mode === 'manual' ? 'manual' : 'auto';
    picks = (cfg.picks || []).filter(find);
    interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Number(cfg.intervalMs) || DEFAULT_INTERVAL));
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
    location.replace('../login/?next=' + encodeURIComponent('../hero/'));
  });
})();
