(function () {
  const cloud = window.AVEIR_CLOUD;
  const $ = id => document.getElementById(id);
  const gate = $('gate');
  let me = null;
  let stops = [];

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function when(ts) {
    const d = ts && ts.toDate ? ts.toDate() : null;
    if (!d) return '';
    const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return M[d.getMonth()] + ' ' + ('0' + d.getDate()).slice(-2) + ', ' + d.getFullYear();
  }

  function chip(role) {
    return '<span class="av-chip av-chip-' + (role === 'admin' ? 'admin' : 'owner') + '">' + esc(String(role).toUpperCase()) + '</span>';
  }

  function noteTo(el, text, kind) {
    el.textContent = text || '';
    el.className = 'av-note' + (kind ? ' is-' + kind : '');
  }

  function renderStaff(list, err) {
    const box = $('staff');
    if (err) { box.innerHTML = '<div class="av-empty">' + esc(cloud.friendly(err)) + '</div>'; return; }
    list.sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
    $('staffCount').textContent = list.length + (list.length === 1 ? ' PERSON' : ' PEOPLE');
    $('count').textContent = list.length + ' ON THE TEAM';
    const admin = me && me.role === 'admin';
    box.innerHTML = list.map(p => {
      const self = me && p.id === me.uid;
      const other = p.role === 'admin' ? 'owner' : 'admin';
      const actions = admin && !self
        ? '<button class="av-btn-ghost" data-act="role" data-id="' + esc(p.id) + '" data-role="' + other + '">MAKE ' + other.toUpperCase() + '</button>' +
          '<button class="av-btn-ghost av-btn-danger" data-act="remove" data-id="' + esc(p.id) + '" data-email="' + esc(p.email) + '">REMOVE</button>'
        : '';
      return '<div class="av-person"><div><div class="av-person-email">' + esc(p.email) + chip(p.role) + (self ? '<span class="av-chip av-chip-you">YOU</span>' : '') +
        '</div><div class="av-person-meta">' + (when(p.createdAt) ? 'JOINED ' + when(p.createdAt) : '') + '</div></div>' +
        '<div class="av-person-actions">' + actions + '</div></div>';
    }).join('') || '<div class="av-empty">NOBODY YET</div>';
  }

  function renderInvites(list, err) {
    const box = $('invites');
    if (err) { box.innerHTML = '<div class="av-empty">' + esc(cloud.friendly(err)) + '</div>'; return; }
    list.sort((a, b) => a.email.localeCompare(b.email));
    $('inviteCount').textContent = list.length ? list.length + ' PENDING' : '';
    box.innerHTML = list.map(p =>
      '<div class="av-person"><div><div class="av-person-email">' + esc(p.email) + chip(p.role) + '</div>' +
      '<div class="av-person-meta">ADDED ' + esc(when(p.createdAt)) + (p.invitedBy ? ' BY ' + esc(String(p.invitedBy).toUpperCase()) : '') + '</div></div>' +
      '<div class="av-person-actions"><button class="av-btn-ghost av-btn-danger" data-act="cancel" data-email="' + esc(p.email) + '">CANCEL</button></div></div>'
    ).join('') || '<div class="av-empty">NO PENDING INVITES</div>';
  }

  async function act(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const kind = b.dataset.act;
    try {
      if (kind === 'role') {
        if (!confirm('CHANGE THIS PERSON TO ' + b.dataset.role.toUpperCase() + '?')) return;
        await cloud.setRole(b.dataset.id, b.dataset.role);
      } else if (kind === 'remove') {
        if (!confirm('REMOVE ' + b.dataset.email.toUpperCase() + ' FROM THE TEAM? THEY LOSE ADMIN ACCESS RIGHT AWAY.')) return;
        await cloud.removeStaff(b.dataset.id);
      } else if (kind === 'cancel') {
        if (!confirm('CANCEL THE INVITE FOR ' + b.dataset.email.toUpperCase() + '?')) return;
        await cloud.cancelInvite(b.dataset.email);
      }
    } catch (err) {
      alert(cloud.friendly(err));
    }
  }

  function start(staff) {
    me = staff;
    gate.hidden = true;
    $('me').textContent = staff.email;
    $('loginUrl').textContent = location.origin + location.pathname.replace(/team\/?$/, 'login/');
    const roleSel = $('inviteRole');
    if (staff.role !== 'admin') {
      const adminOpt = roleSel.querySelector('option[value="admin"]');
      if (adminOpt) adminOpt.remove();
      roleSel.disabled = true;
    }
    stops.forEach(f => f());
    stops = [cloud.watchTeam(renderStaff), cloud.watchInvites(renderInvites)];
  }

  $('staff').addEventListener('click', act);
  $('invites').addEventListener('click', act);
  $('signout').addEventListener('click', () => cloud.signOut());

  $('inviteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const note = $('inviteNote');
    const btn = $('inviteBtn');
    btn.disabled = true;
    noteTo(note, 'ADDING...');
    try {
      const email = await cloud.invite($('inviteEmail').value, $('inviteRole').value);
      $('inviteEmail').value = '';
      noteTo(note, email.toUpperCase() + ' CAN NOW SET UP THEIR LOGIN', 'good');
    } catch (err) {
      noteTo(note, cloud.friendly(err), 'bad');
    }
    btn.disabled = false;
  });

  if (!cloud || !cloud.configured) {
    gate.textContent = 'ADMIN LOGIN IS NOT CONNECTED YET';
    return;
  }

  cloud.watchStaff(s => {
    if (s.state === 'loading') { gate.hidden = false; gate.textContent = 'CHECKING ACCESS...'; return; }
    if (s.state === 'in') { start(s.staff); return; }
    stops.forEach(f => f());
    stops = [];
    location.replace('../login/?next=' + encodeURIComponent('../team/'));
  });
})();
