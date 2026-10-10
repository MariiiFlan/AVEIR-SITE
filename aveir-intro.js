window.AVEIR_INTRO = window.AVEIR_INTRO || (function () {
  const AVEIR_INTRO_VIDEO = 'media/intro.mp4';
  const AVEIR_INTRO_VIDEO_ALT = 'media/intro.webm';
  const AVEIR_INTRO_POSTER = 'media/intro-poster.jpg';
  const AVEIR_INTRO_ACCENT = '#ff06bc';
  const AVEIR_INTRO_EVERY_VISIT = true;
  const AVEIR_INTRO_SEEN_KEY = 'aveir_intro_seen';
  const AVEIR_INTRO_ENTER_MS = 950;
  const AVEIR_INTRO_WIPE_MS = 760;
  const AVEIR_INTRO_SCALE = 0.14;
  const AVEIR_INTRO_FADE = 0.92;
  const AVEIR_INTRO_UI_FADE = 2.2;
  const AVEIR_INTRO_ROOT_ID = 'avIntro';
  const AVEIR_INTRO_STYLE_ID = 'avIntroCss';
  const AVEIR_INTRO_FALLBACK_BASE = '../';

  const self = document.currentScript;
  const srcAttr = self ? self.getAttribute('src') || '' : '';
  const cut = srcAttr.lastIndexOf('aveir-intro.js');
  const BASE = cut > 0 ? srcAttr.slice(0, cut) : AVEIR_INTRO_FALLBACK_BASE;

  const slow = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let wrap = null, stage = null, ui = null, bar = null, vid = null;
  let entering = false, done = false, raf = 0;

  function seen() {
    try { return sessionStorage.getItem(AVEIR_INTRO_SEEN_KEY) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { sessionStorage.setItem(AVEIR_INTRO_SEEN_KEY, '1'); } catch (e) {}
  }

  function css() {
    if (document.getElementById(AVEIR_INTRO_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = AVEIR_INTRO_STYLE_ID;
    el.textContent = [
      '#' + AVEIR_INTRO_ROOT_ID + '{position:relative;z-index:3;width:100%;height:100vh;height:100svh;min-height:420px;background:#000;overflow:hidden;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-stage{position:absolute;inset:0;will-change:transform,opacity;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' video{display:block;width:100%;height:100%;object-fit:cover;background:#000;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-veil{position:absolute;inset:0;pointer-events:none;background:radial-gradient(125% 95% at 50% 38%, rgba(0,0,0,0) 42%, rgba(0,0,0,.6) 100%);}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-ui{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:24px clamp(16px,4vw,44px) 32px;pointer-events:none;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-row{display:flex;align-items:center;justify-content:space-between;gap:14px;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-tag{font:700 10px/1.6 "Space Mono",ui-monospace,monospace;letter-spacing:.34em;color:#f2efe9;text-transform:uppercase;text-shadow:0 1px 14px rgba(0,0,0,.7);}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-tag b{color:' + AVEIR_INTRO_ACCENT + ';font-weight:700;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-btns{display:flex;gap:9px;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' button{pointer-events:auto;appearance:none;cursor:pointer;background:rgba(10,10,10,.42);border:1px solid rgba(242,239,233,.5);color:#f2efe9;font:700 10px/1 "Space Mono",ui-monospace,monospace;letter-spacing:.26em;padding:11px 15px;backdrop-filter:blur(3px);}',
      '#' + AVEIR_INTRO_ROOT_ID + ' button:hover{border-color:' + AVEIR_INTRO_ACCENT + ';color:' + AVEIR_INTRO_ACCENT + ';}',
      '#' + AVEIR_INTRO_ROOT_ID + ' button:focus-visible{outline:2px solid ' + AVEIR_INTRO_ACCENT + ';outline-offset:2px;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-cue{display:flex;flex-direction:column;align-items:center;gap:8px;font:700 9px/1 "Space Mono",ui-monospace,monospace;letter-spacing:.34em;color:rgba(242,239,233,.78);animation:avIntroBob 2.1s ease-in-out infinite;}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-cue span{display:block;width:1px;height:26px;background:linear-gradient(to bottom,' + AVEIR_INTRO_ACCENT + ',rgba(255,6,188,0));}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-bar{position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(242,239,233,.13);}',
      '#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-bar i{display:block;height:100%;background:' + AVEIR_INTRO_ACCENT + ';transform:scaleX(0);transform-origin:0 50%;}',
      '#' + AVEIR_INTRO_ROOT_ID + '.is-out::after{content:"";position:absolute;inset:0;z-index:4;background:' + AVEIR_INTRO_ACCENT + ';transform:scaleY(0);transform-origin:50% 100%;animation:avIntroWipe ' + AVEIR_INTRO_WIPE_MS + 'ms cubic-bezier(.68,0,.18,1) forwards;}',
      '@keyframes avIntroWipe{0%{transform:scaleY(0);opacity:1}52%{transform:scaleY(1);opacity:1}100%{transform:scaleY(1);opacity:0}}',
      '@keyframes avIntroBob{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}',
      '@media (prefers-reduced-motion:reduce){#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-stage{transform:none !important}#' + AVEIR_INTRO_ROOT_ID + '.is-out::after{display:none}#' + AVEIR_INTRO_ROOT_ID + ' .av-intro-cue{animation:none}}'
    ].join('');
    (document.head || document.documentElement).appendChild(el);
  }

  function markup() {
    wrap = document.createElement('div');
    wrap.id = AVEIR_INTRO_ROOT_ID;
    wrap.innerHTML =
      '<div class="av-intro-stage">' +
        '<video playsinline muted autoplay preload="auto" poster="' + BASE + AVEIR_INTRO_POSTER + '">' +
          '<source src="' + BASE + AVEIR_INTRO_VIDEO + '" type="video/mp4">' +
          '<source src="' + BASE + AVEIR_INTRO_VIDEO_ALT + '" type="video/webm">' +
        '</video>' +
        '<div class="av-intro-veil"></div>' +
      '</div>' +
      '<div class="av-intro-ui">' +
        '<div class="av-intro-row">' +
          '<div class="av-intro-tag">AVEIR <b>STUDIOS</b></div>' +
          '<div class="av-intro-btns">' +
            '<button type="button" data-act="sound">SOUND ON</button>' +
            '<button type="button" data-act="enter">ENTER</button>' +
          '</div>' +
        '</div>' +
        '<div class="av-intro-row" style="justify-content:center;">' +
          '<div class="av-intro-cue">SCROLL<span></span></div>' +
        '</div>' +
      '</div>' +
      '<div class="av-intro-bar"><i></i></div>';
    document.body.insertBefore(wrap, document.body.firstChild);
    stage = wrap.querySelector('.av-intro-stage');
    ui = wrap.querySelector('.av-intro-ui');
    bar = wrap.querySelector('.av-intro-bar i');
    vid = wrap.querySelector('video');
  }

  function height() { return wrap.offsetHeight || window.innerHeight || 1; }

  function paint() {
    raf = 0;
    const p = Math.min(1, Math.max(0, window.pageYOffset / height()));
    if (!slow) stage.style.transform = 'scale(' + (1 + p * AVEIR_INTRO_SCALE) + ')';
    stage.style.opacity = String(1 - p * AVEIR_INTRO_FADE);
    ui.style.opacity = String(Math.max(0, 1 - p * AVEIR_INTRO_UI_FADE));
    ui.style.pointerEvents = p > 0.4 ? 'none' : '';
    if (p < 0.02 && done) replay();
    if (p > 0.6) markSeen();
  }

  function onScroll() {
    if (!raf) raf = requestAnimationFrame(paint);
  }

  function replay() {
    done = false;
    if (!vid) return;
    try { vid.currentTime = 0; vid.play().catch(function () {}); } catch (e) {}
  }

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function smoothTo(target, ms, after) {
    const from = window.pageYOffset;
    const delta = target - from;
    if (Math.abs(delta) < 2 || slow) { window.scrollTo(0, target); if (after) after(); return; }
    const t0 = performance.now();
    let cancelled = false;
    const stop = function () { cancelled = true; };
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    (function step(now) {
      if (cancelled) { if (after) after(); return; }
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, from + delta * ease(t));
      if (t < 1) requestAnimationFrame(step);
      else { window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); if (after) after(); }
    })(t0);
  }

  function enter() {
    if (entering) return;
    entering = true;
    markSeen();
    if (!slow) wrap.classList.add('is-out');
    smoothTo(height(), AVEIR_INTRO_ENTER_MS, function () {
      entering = false;
      setTimeout(function () { wrap.classList.remove('is-out'); }, AVEIR_INTRO_WIPE_MS);
    });
  }

  function sound(btn) {
    if (!vid) return;
    vid.muted = !vid.muted;
    btn.textContent = vid.muted ? 'SOUND ON' : 'SOUND OFF';
    if (!vid.muted) vid.play().catch(function () {});
  }

  function wire() {
    wrap.addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      if (b.dataset.act === 'enter') enter();
      if (b.dataset.act === 'sound') sound(b);
    });
    vid.addEventListener('timeupdate', function () {
      if (!vid.duration) return;
      bar.style.transform = 'scaleX(' + (vid.currentTime / vid.duration) + ')';
    });
    vid.addEventListener('ended', function () {
      done = true;
      bar.style.transform = 'scaleX(1)';
      if (window.pageYOffset < height() * 0.5) enter();
    });
    vid.addEventListener('loadeddata', function () { vid.play().catch(function () {}); });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    paint();
  }

  function start() {
    if (document.getElementById(AVEIR_INTRO_ROOT_ID)) return;
    if (!AVEIR_INTRO_EVERY_VISIT && seen()) return;
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
    css();
    markup();
    window.scrollTo(0, 0);
    wire();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return { enter: function () { if (wrap) enter(); }, replay, seen };
})();
