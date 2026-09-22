(function () {
  const cloud = window.AVEIR_CLOUD;
  const P = window.AVEIR_PRODUCTS;
  const $ = id => document.getElementById(id);
  const gate = $('gate');
  const IMG = window.AVEIR_IMAGE;
  const KIND_ORDER = ['tees', 'hats', 'pants', 'shorts'];
  const MAX_DOC_BYTES = 900000;
  let me = null;
  let stop = null;
  let all = [];
  let form = null;
  let sizesTouched = false;
  let busy = false;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function money(n) { return '$' + (Number(n) || 0).toFixed(2); }

  function slugify(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function chip(text, cls) { return '<span class="av-chip ' + cls + '">' + esc(text) + '</span>'; }

  function note(text, kind) {
    const el = $('note');
    el.textContent = text || '';
    el.className = 'av-note' + (kind ? ' is-' + kind : '');
  }

  function blank(kind) {
    return { slug: '', name: '', kind, cat: P.kinds[kind], price: '', was: '', sizes: P.defaultSizes[kind].slice(), colors: [], images: {}, thumbs: {}, coverColor: '', desc: '', live: false, createdAt: null, isNew: true, loading: false };
  }

  function fromDoc(d) {
    return {
      slug: d.id, name: d.name || '', kind: P.kinds[d.kind] ? d.kind : 'tees', cat: d.cat || '', price: d.price, was: d.was || '',
      sizes: Array.isArray(d.sizes) ? d.sizes.slice() : [], colors: Array.isArray(d.colors) ? d.colors.slice() : [],
      images: {}, thumbs: d.cover ? { __saved: d.cover } : {}, coverColor: '', desc: d.desc || '', live: !!d.live, createdAt: d.createdAt || null, isNew: false, loading: true
    };
  }

  function thumb(src, alt) {
    return src ? '<img src="' + esc(src) + '" alt="' + esc(alt) + '">' : '<span>AVR</span>';
  }

  function renderList() {
    const box = $('cloudList');
    const list = all.slice().sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || String(a.name).localeCompare(String(b.name)));
    $('cloudCount').textContent = list.length ? list.length + (list.length === 1 ? ' LISTING' : ' LISTINGS') : '';
    $('count').textContent = list.filter(p => p.live).length + ' LIVE';
    box.innerHTML = list.map(p =>
      '<div class="av-product' + (form && !form.isNew && form.slug === p.id ? ' is-editing' : '') + '">' +
        '<div class="av-product-thumb">' + thumb(p.cover, p.name) + '</div>' +
        '<div><div class="av-product-name">' + esc(p.name) + '</div>' +
          '<div class="av-product-meta">' + chip(P.kinds[p.kind] || 'TEES', 'av-chip-kind') + chip(p.live ? 'LIVE' : 'DRAFT', p.live ? 'av-chip-live' : 'av-chip-draft') + ' ' + esc(money(p.price)) + (p.was > p.price ? ' <s>' + esc(money(p.was)) + '</s>' : '') + '</div></div>' +
        '<div class="av-product-actions"><button class="av-btn-ghost" data-edit="' + esc(p.id) + '" type="button">EDIT</button></div>' +
      '</div>'
    ).join('') || '<div class="av-empty">NOTHING YET. HIT + NEW LISTING.</div>';

    const code = ((window.AVEIR_STORE && window.AVEIR_STORE.catalog) || []).filter(p => !p.cloud);
    $('codeCount').textContent = code.length ? code.length + ' IN CODE' : '';
    $('codeList').innerHTML = code.map(p =>
      '<div class="av-product">' +
        '<div class="av-product-thumb"><span>AVR</span></div>' +
        '<div><div class="av-product-name">' + esc(p.name) + '</div>' +
          '<div class="av-product-meta">' + chip(P.kinds[p.kind || 'tees'] || 'TEES', 'av-chip-kind') + chip('IN CODE', 'av-chip-code') + ' ' + esc(money(p.price)) + (p.was > p.price ? ' <s>' + esc(money(p.was)) + '</s>' : '') + '</div></div>' +
        '<div class="av-product-actions"><a class="av-btn-ghost" href="../../' + esc(P.href(p)) + '" target="_blank" rel="noopener">VIEW</a></div>' +
      '</div>'
    ).join('') || '<div class="av-empty">NOTHING IN CATALOG.JS</div>';
  }

  function weight() {
    return form.colors.reduce((a, c) => a + (form.images[c] || '').length, 0);
  }

  function renderColors() {
    const box = $('colors');
    if (form.loading) { box.innerHTML = '<div class="av-note">LOADING PHOTOS...</div>'; return; }
    box.innerHTML = form.colors.map(c => {
      const src = form.images[c] || '';
      const isCover = form.coverColor === c;
      return '<div class="av-color">' +
        '<div class="av-color-thumb">' + (src ? '<img src="' + esc(src) + '" alt="' + esc(c) + '">' : '<span>NO PHOTO</span>') + '</div>' +
        '<div><div class="av-color-name">' + esc(c) + (isCover ? chip('COVER', 'av-chip-you') : '') + '</div>' +
          '<div class="av-color-state" data-state="' + esc(c) + '">' + (src ? Math.round(src.length / 1024) + ' KB' : 'UPLOAD A PHOTO') + '</div></div>' +
        '<div class="av-color-actions">' +
          '<button class="av-btn-ghost" type="button" data-upload="' + esc(c) + '">' + (src ? 'REPLACE' : 'UPLOAD') + '</button>' +
          (src && !isCover ? '<button class="av-btn-ghost" type="button" data-cover="' + esc(c) + '">MAKE COVER</button>' : '') +
          '<button class="av-btn-ghost av-btn-danger" type="button" data-remove="' + esc(c) + '">X</button>' +
        '</div>' +
        '<input class="av-file" type="file" accept="image/png,image/jpeg,image/webp" data-file="' + esc(c) + '">' +
      '</div>';
    }).join('') || '<div class="av-note">NO COLORS YET. ADD ONE BELOW, THEN UPLOAD ITS PHOTO.</div>';
    const used = weight();
    $('colorNote').textContent = used ? Math.round(used / 1024) + ' KB OF ' + Math.round(MAX_DOC_BYTES / 1024) + ' KB USED' : 'ONE PHOTO PER COLOR. PHOTOS ARE SHRUNK IN YOUR BROWSER BEFORE SAVING.';
  }

  async function loadImages(slug) {
    try {
      const m = await cloud.getProductImages(slug);
      if (!form || form.slug !== slug) return;
      form.images = m || {};
      form.coverColor = Object.keys(form.images).find(c => form.thumbs.__saved && form.images[c]) || Object.keys(form.images)[0] || '';
      form.loading = false;
      renderColors();
    } catch (err) {
      if (!form || form.slug !== slug) return;
      form.loading = false;
      renderColors();
      note(cloud.friendly(err), 'bad');
    }
  }

  function fillForm() {
    $('kind').value = form.kind;
    $('name').value = form.name;
    $('slug').value = form.slug;
    $('slug').disabled = !form.isNew;
    $('slugNote').hidden = !form.isNew;
    $('cat').value = form.cat;
    $('price').value = form.price === '' ? '' : Number(form.price);
    $('was').value = form.was === '' || !form.was ? '' : Number(form.was);
    $('sizes').value = form.sizes.join(', ');
    $('desc').value = form.desc;
    $('live').checked = form.live;
    $('deleteBtn').hidden = form.isNew;
    $('editorTitle').textContent = form.isNew ? 'NEW LISTING' : 'EDIT ' + form.name.toUpperCase();
    $('saveBtn').textContent = form.isNew ? 'CREATE LISTING' : 'SAVE CHANGES';
    sizesTouched = !form.isNew;
    renderColors();
    note('');
  }

  function readForm() {
    form.kind = $('kind').value;
    form.name = $('name').value.trim().toUpperCase();
    if (form.isNew) form.slug = slugify($('slug').value || form.name);
    form.cat = $('cat').value.trim().toUpperCase();
    form.price = $('price').value;
    form.was = $('was').value;
    form.sizes = $('sizes').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    form.desc = $('desc').value.trim();
    form.live = $('live').checked;
  }

  function openEditor(p) {
    form = p ? fromDoc(p) : blank('hats');
    $('editor').hidden = false;
    fillForm();
    renderList();
    if (p) loadImages(form.slug);
    if (window.innerWidth < 1100) $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEditor() {
    form = null;
    $('editor').hidden = true;
    renderList();
  }

  async function upload(color, file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { note('THAT IS NOT AN IMAGE.', 'bad'); return; }
    const state = document.querySelector('[data-state="' + color + '"]');
    if (state) state.textContent = 'SHRINKING...';
    try {
      const pair = await IMG.pair(file);
      const next = weight() - (form.images[color] || '').length + pair.full.length;
      if (next > MAX_DOC_BYTES) { if (state) state.textContent = 'TOO MANY PHOTOS'; note('THAT WOULD PUSH THIS LISTING OVER ITS PHOTO LIMIT. REMOVE A COLOR FIRST.', 'bad'); return; }
      form.images[color] = pair.full;
      form.thumbs[color] = pair.thumb;
      if (!form.coverColor || !form.images[form.coverColor]) form.coverColor = color;
      renderColors();
      note('PHOTO READY. HIT SAVE WHEN YOU ARE DONE.', 'good');
    } catch (err) {
      if (state) state.textContent = 'FAILED';
      note(String(err && err.message ? err.message : err).toUpperCase(), 'bad');
    }
  }

  function validate() {
    if (!form.name) return 'GIVE IT A NAME';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.slug)) return 'SLUG CAN ONLY HAVE LOWERCASE LETTERS, NUMBERS AND DASHES';
    if (form.isNew && ((window.AVEIR_STORE && window.AVEIR_STORE.catalog) || []).some(p => p.slug === form.slug)) return 'THAT SLUG IS ALREADY USED IN CATALOG.JS';
    if (form.isNew && all.some(p => p.id === form.slug)) return 'THAT SLUG IS ALREADY USED';
    const price = Number(form.price);
    if (!(price > 0) || price > 10000) return 'PRICE NEEDS TO BE MORE THAN 0';
    const was = form.was === '' ? 0 : Number(form.was);
    if (!(was >= 0) || was > 10000) return 'COMPARE AT PRICE LOOKS WRONG';
    if (was && was <= price) return 'COMPARE AT PRICE HAS TO BE HIGHER THAN THE PRICE, OR LEAVE IT EMPTY';
    if (!form.sizes.length) return 'ADD AT LEAST ONE SIZE';
    if (form.sizes.length > 20) return 'TOO MANY SIZES';
    if (form.colors.length > 20) return 'TOO MANY COLORS';
    if (form.loading) return 'STILL LOADING THIS LISTING, GIVE IT A SECOND';
    if (form.live && !form.colors.some(c => form.images[c])) return 'ADD AT LEAST ONE PHOTO BEFORE GOING LIVE';
    if (weight() > MAX_DOC_BYTES) return 'TOO MANY PHOTOS ON THIS LISTING. REMOVE A COLOR.';
    return '';
  }

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    readForm();
    const bad = validate();
    if (bad) { note(bad, 'bad'); return; }
    busy = true;
    $('saveBtn').disabled = true;
    note('SAVING...');
    const images = {};
    form.colors.forEach(c => { if (form.images[c]) images[c] = form.images[c]; });
    const coverColor = images[form.coverColor] ? form.coverColor : Object.keys(images)[0] || '';
    let cover = '';
    if (coverColor) {
      if (!form.thumbs[coverColor]) {
        try { form.thumbs[coverColor] = await IMG.thumb(images[coverColor]); }
        catch (err) { busy = false; $('saveBtn').disabled = false; note('COULD NOT MAKE A COVER FROM THAT PHOTO', 'bad'); return; }
      }
      cover = form.thumbs[coverColor];
    }
    const doc = {
      name: form.name, kind: form.kind, cat: form.cat || P.kinds[form.kind], price: Math.round(Number(form.price) * 100) / 100,
      was: form.was === '' ? 0 : Math.round(Number(form.was) * 100) / 100,
      sizes: form.sizes, colors: form.colors, cover, desc: form.desc, live: form.live
    };
    try {
      await cloud.saveProduct(form.slug, doc, form.isNew ? null : { createdAt: form.createdAt });
      await cloud.saveProductImages(form.slug, images);
      const saved = form.live ? 'SAVED. IT IS LIVE ON THE SITE.' : 'SAVED AS A DRAFT. TICK LIVE WHEN IT IS READY.';
      note(saved, 'good');
      if (form.isNew) {
        const wasNew = form.slug;
        setTimeout(() => { const hit = all.find(p => p.id === wasNew); if (hit) { openEditor(hit); note(saved, 'good'); } }, 600);
      }
    } catch (err) {
      note(cloud.friendly(err), 'bad');
    }
    busy = false;
    $('saveBtn').disabled = false;
  }

  async function remove() {
    if (!form || form.isNew) return;
    if (!confirm('DELETE ' + form.name + ' FOR GOOD? THIS TAKES IT OFF THE SITE RIGHT AWAY.')) return;
    busy = true;
    note('DELETING...');
    try {
      await cloud.deleteProduct(form.slug);
      closeEditor();
    } catch (err) {
      note(cloud.friendly(err), 'bad');
    }
    busy = false;
  }

  function start(staff) {
    me = staff;
    gate.hidden = true;
    $('me').textContent = staff.email;
    const dl = $('colorList');
    dl.innerHTML = ((window.AVEIR_STORE && window.AVEIR_STORE.colors) || []).map(c => '<option value="' + esc(c) + '">').join('');
    if (stop) stop();
    stop = cloud.watchProducts((list, err) => {
      if (err) { $('cloudList').innerHTML = '<div class="av-empty">' + esc(cloud.friendly(err)) + '</div>'; return; }
      all = list;
      renderList();
    });
    renderList();
  }

  $('newBtn').addEventListener('click', () => openEditor(null));
  $('closeBtn').addEventListener('click', closeEditor);
  $('form').addEventListener('submit', save);
  $('deleteBtn').addEventListener('click', remove);
  $('signout').addEventListener('click', () => cloud.signOut());

  $('cloudList').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const hit = all.find(p => p.id === b.dataset.edit);
    if (hit) openEditor(hit);
  });

  $('kind').addEventListener('change', () => {
    if (!form) return;
    const k = $('kind').value;
    if (!sizesTouched) $('sizes').value = P.defaultSizes[k].join(', ');
    if (!$('cat').value.trim() || Object.values(P.kinds).indexOf($('cat').value.trim().toUpperCase()) >= 0) $('cat').value = P.kinds[k];
  });
  $('sizes').addEventListener('input', () => { sizesTouched = true; });
  $('name').addEventListener('input', () => { if (form && form.isNew && !$('slug').dataset.touched) $('slug').value = slugify($('name').value); });
  $('slug').addEventListener('input', () => { $('slug').dataset.touched = '1'; $('slug').value = slugify($('slug').value) || $('slug').value.toLowerCase(); });

  $('addColorBtn').addEventListener('click', () => {
    const v = $('newColor').value.trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);
    if (!v) return;
    if (form.colors.indexOf(v) < 0) form.colors.push(v);
    $('newColor').value = '';
    renderColors();
  });
  $('newColor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('addColorBtn').click(); } });

  $('colors').addEventListener('click', e => {
    const up = e.target.closest('[data-upload]');
    if (up) { const inp = document.querySelector('[data-file="' + up.dataset.upload + '"]'); if (inp) inp.click(); return; }
    const cv = e.target.closest('[data-cover]');
    if (cv) { form.coverColor = cv.dataset.cover; renderColors(); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const c = rm.dataset.remove;
      form.colors = form.colors.filter(x => x !== c);
      if (form.coverColor === c) form.coverColor = '';
      delete form.images[c];
      delete form.thumbs[c];
      renderColors();
    }
  });
  $('colors').addEventListener('change', e => {
    const inp = e.target.closest('[data-file]');
    if (inp && inp.files && inp.files[0]) upload(inp.dataset.file, inp.files[0]);
  });

  if (!cloud || !cloud.configured) {
    gate.textContent = 'ADMIN LOGIN IS NOT CONNECTED YET';
    return;
  }

  if (!IMG || !IMG.supported()) {
    note('THIS BROWSER CANNOT SHRINK PHOTOS WELL. USE CHROME OR SAFARI TO ADD PHOTOS.', 'bad');
  }

  cloud.watchStaff(s => {
    if (s.state === 'loading') { gate.hidden = false; gate.textContent = 'CHECKING ACCESS...'; return; }
    if (s.state === 'in') {
      if (s.staff.role === 'admin' || s.staff.products === true) { start(s.staff); return; }
      gate.hidden = false;
      gate.innerHTML = 'YOU ARE SIGNED IN AS ' + esc(String(s.user.email).toUpperCase()) + ' BUT YOU DO NOT HAVE THE PRODUCTS PERMISSION YET.<br><br>ASK AN ADMIN TO TURN IT ON FOR YOU ON THE TEAM PAGE.<br><br><a href="../orders/" style="color:#e01313;">BACK TO ORDERS</a>';
      return;
    }
    if (stop) stop();
    stop = null;
    location.replace('../login/?next=' + encodeURIComponent('../products/'));
  });
})();
