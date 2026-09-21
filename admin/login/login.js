(function () {
  const cloud = window.AVEIR_CLOUD;
  const $ = id => document.getElementById(id);
  const form = $('form'), email = $('email'), password = $('password'), password2 = $('password2');
  const submit = $('submit'), note = $('note'), heading = $('heading');
  const tabs = $('tabs'), links = $('links'), pending = $('pending');
  let mode = 'in';
  let busy = false;

  function nextUrl() {
    const n = new URLSearchParams(location.search).get('next') || '';
    return /^\.\.\/[a-z-]+\/$/.test(n) ? n : '../orders/';
  }

  function say(text, kind) {
    note.textContent = text || '';
    note.className = 'av-note' + (kind ? ' is-' + kind : '');
  }

  function setMode(m) {
    mode = m;
    Array.from(tabs.children).forEach(b => b.classList.toggle('is-on', b.dataset.mode === m));
    password2.hidden = m !== 'setup';
    password.autocomplete = m === 'setup' ? 'new-password' : 'current-password';
    heading.textContent = m === 'setup' ? 'SET UP ACCOUNT' : 'SIGN IN';
    submit.textContent = m === 'setup' ? 'CREATE LOGIN' : 'SIGN IN';
    $('forgot').hidden = m === 'setup';
    say(m === 'setup' ? 'MAKE AN ACCOUNT WITH ANY EMAIL. PASSWORD NEEDS 8+ CHARACTERS. ADMIN ACCESS NEEDS AN INVITE.' : '');
  }

  function showForm(on) {
    form.hidden = !on;
    tabs.hidden = !on;
    links.hidden = !on;
    pending.hidden = on;
  }

  function lock(on) {
    busy = on;
    submit.disabled = on;
  }

  if (!cloud || !cloud.configured) {
    showForm(false);
    pending.hidden = true;
    tabs.hidden = true;
    say('ADMIN LOGIN IS NOT CONNECTED YET. ADD THE FIREBASE CONFIG TO AVEIR-CLOUD.JS.', 'bad');
    return;
  }

  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (b && !busy) setMode(b.dataset.mode);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const em = email.value.trim();
    if (!em || !password.value) { say('ENTER YOUR EMAIL AND PASSWORD', 'bad'); return; }
    if (mode === 'setup' && password.value !== password2.value) { say('PASSWORDS DO NOT MATCH', 'bad'); return; }
    lock(true);
    say(mode === 'setup' ? 'CREATING YOUR LOGIN...' : 'SIGNING IN...');
    try {
      if (mode === 'setup') await cloud.setUp(em, password.value);
      else await cloud.signIn(em, password.value);
    } catch (err) {
      say(cloud.friendly(err), 'bad');
    }
    lock(false);
  });

  $('forgot').addEventListener('click', async () => {
    const em = email.value.trim();
    if (!em) { say('TYPE YOUR EMAIL FIRST, THEN HIT FORGOT PASSWORD', 'bad'); return; }
    try {
      await cloud.resetPassword(em);
      say('IF THAT EMAIL HAS A LOGIN, A RESET LINK IS ON ITS WAY', 'good');
    } catch (err) {
      say(cloud.friendly(err), 'bad');
    }
  });

  $('resend').addEventListener('click', async () => {
    try { await cloud.resendVerification(); say('VERIFICATION EMAIL SENT AGAIN. CHECK SPAM TOO.', 'good'); }
    catch (err) { say(cloud.friendly(err), 'bad'); }
  });

  $('recheck').addEventListener('click', () => location.reload());
  $('signout').addEventListener('click', () => cloud.signOut());

  cloud.watchStaff(s => {
    if (s.state === 'loading') { showForm(false); pending.hidden = true; say('CHECKING...'); return; }
    if (s.state === 'in') { say('WELCOME BACK. OPENING ADMIN...', 'good'); location.replace(nextUrl()); return; }
    if (s.state === 'out') { showForm(true); if (note.textContent === 'CHECKING...') setMode(mode); return; }
    if (s.state === 'unverified') {
      showForm(false);
      $('resend').hidden = false;
      $('recheck').hidden = false;
      heading.textContent = 'CHECK YOUR EMAIL';
      say('WE SENT A VERIFICATION LINK TO ' + String(s.user.email).toUpperCase() + '. CLICK IT, THEN HIT I VERIFIED.');
      return;
    }
    if (s.state === 'denied') {
      showForm(false);
      $('resend').hidden = true;
      $('recheck').hidden = true;
      heading.textContent = 'YOU ARE IN';
      say('SIGNED IN AS ' + String(s.user.email).toUpperCase() + '. MEMBER PERKS ARE COMING SOON. ADMIN PAGES NEED AN INVITE FROM AN ADMIN.');
      return;
    }
    showForm(true);
    say(s.error || 'SOMETHING WENT WRONG', 'bad');
  });
})();
