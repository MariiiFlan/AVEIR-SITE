window.AVEIR_HOVER = window.AVEIR_HOVER || (function () {
  const AVEIR_HOVER_FADE_MS = 340;
  const AVEIR_HOVER_SCAN_MS = 90;
  const AVEIR_HOVER_CARD = 'a.av-gcard';
  const AVEIR_HOVER_SHOT = 'img.av-shot';
  const AVEIR_HOVER_STAGE = '.av-card-img';
  const AVEIR_HOVER_HERO = '.av-hero-img';
  const AVEIR_HOVER_ALT = 'av-shot-alt';
  const AVEIR_HOVER_FLAG = 'av-has-alt';
  const AVEIR_HOVER_STYLE_ID = 'avHoverCss';

  const maps = {};
  const asked = {};
  let scanT = 0;

  function style() {
    if (document.getElementById(AVEIR_HOVER_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = AVEIR_HOVER_STYLE_ID;
    el.textContent =
      '.' + AVEIR_HOVER_ALT + '{opacity:0;transition:opacity ' + AVEIR_HOVER_FADE_MS + 'ms ease,transform .5s cubic-bezier(.2,.7,.3,1);pointer-events:none;z-index:1;}' +
      '.' + AVEIR_HOVER_FLAG + ':hover .' + AVEIR_HOVER_ALT + '{opacity:1;}' +
      '.' + AVEIR_HOVER_FLAG + ':hover ' + AVEIR_HOVER_SHOT + ',' + AVEIR_HOVER_HERO + '.' + AVEIR_HOVER_FLAG + ':hover img:not(.' + AVEIR_HOVER_ALT + '){opacity:0;transition:opacity ' + AVEIR_HOVER_FADE_MS + 'ms ease;}' +
      '.av-gcard.' + AVEIR_HOVER_FLAG + ':hover .' + AVEIR_HOVER_ALT + '{transform:scale(1.045);}' +
      '@media (prefers-reduced-motion:reduce){.' + AVEIR_HOVER_ALT + '{transition:opacity .15s ease;}.av-gcard.' + AVEIR_HOVER_FLAG + ':hover .' + AVEIR_HOVER_ALT + '{transform:none;}}';
    (document.head || document.documentElement).appendChild(el);
  }

  function products() { return window.AVEIR_PRODUCTS || null; }

  function slugFromHref(el) {
    const href = el.getAttribute('href') || '';
    const q = href.indexOf('?p=');
    if (q >= 0) return decodeURIComponent(href.slice(q + 3).split('&')[0]);
    const parts = href.split('?')[0].split('#')[0].split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function heroSlug() {
    const P = products();
    const h = P ? P.newest(1)[0] : null;
    return h && h.cloud ? h.slug : '';
  }

  function shots(slug) {
    const P = products();
    const prod = P ? P.find(slug) : null;
    const map = maps[slug];
    if (!prod || !map) return [];
    const order = prod.colors && prod.colors.length ? prod.colors : Object.keys(map);
    const out = [];
    for (let i = 0; i < order.length; i++) if (map[order[i]]) out.push(map[order[i]]);
    return out;
  }

  function otherImage(slug, showing) {
    const list = shots(slug);
    if (list.length < 2) return '';
    const at = list.indexOf(showing);
    return at >= 0 ? list[(at + 1) % list.length] : list[list.length - 1];
  }

  function resolve(slug) {
    if (!slug || asked[slug]) return;
    asked[slug] = true;
    const P = products();
    if (!P) { asked[slug] = false; return; }
    const prod = P.find(slug);
    if (!prod || !prod.cloud || !prod.colors || prod.colors.length < 2) { maps[slug] = {}; return; }
    const have = P.loadedImages(slug);
    if (have) { maps[slug] = have; apply(); return; }
    P.images(slug).then(function (m) { maps[slug] = m || {}; apply(); });
  }

  function geometry(shot) {
    const s = shot.getAttribute('style') || '';
    const pad = /padding\s*:\s*([^;]+)/.exec(s);
    return 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;box-sizing:border-box;padding:' + (pad ? pad[1].trim() : '2%') + ';';
  }

  function strip(host) {
    const old = host.querySelector('.' + AVEIR_HOVER_ALT);
    if (old) old.remove();
    host.classList.remove(AVEIR_HOVER_FLAG);
  }

  function deco(host, stage, shot, src) {
    if (!src || !shot || !stage || shot.style.display === 'none') { strip(host); return; }
    let img = host.querySelector('.' + AVEIR_HOVER_ALT);
    if (!img) {
      img = document.createElement('img');
      img.className = AVEIR_HOVER_ALT;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.style.cssText = geometry(shot);
      stage.appendChild(img);
    }
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    host.classList.add(AVEIR_HOVER_FLAG);
  }

  function apply() {
    style();
    const cards = document.querySelectorAll(AVEIR_HOVER_CARD);
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const shot = card.querySelector(AVEIR_HOVER_SHOT);
      const stage = card.querySelector(AVEIR_HOVER_STAGE) || (shot ? shot.parentNode : null);
      deco(card, stage, shot, shot ? otherImage(slugFromHref(card), shot.getAttribute('src')) : '');
    }
    const heroes = document.querySelectorAll(AVEIR_HOVER_HERO);
    const hs = heroSlug();
    for (let i = 0; i < heroes.length; i++) {
      const hero = heroes[i];
      const shot = hero.querySelector('img:not(.' + AVEIR_HOVER_ALT + ')');
      deco(hero, hero, shot, shot ? otherImage(hs, shot.getAttribute('src')) : '');
    }
  }

  function scan() {
    clearTimeout(scanT);
    scanT = setTimeout(apply, AVEIR_HOVER_SCAN_MS);
  }

  function enter(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const card = t.closest(AVEIR_HOVER_CARD);
    if (card) { resolve(slugFromHref(card)); return; }
    if (t.closest(AVEIR_HOVER_HERO)) resolve(heroSlug());
  }

  function reset() {
    for (const k in maps) delete maps[k];
    for (const k in asked) delete asked[k];
    scan();
  }

  function watch() {
    document.addEventListener('mouseover', enter, true);
    document.addEventListener('focusin', enter, true);
    window.addEventListener('aveir:catalog', reset);
    if (window.MutationObserver) new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    resolve(heroSlug());
    scan();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();

  return { refresh: scan, reset, resolve };
})();
