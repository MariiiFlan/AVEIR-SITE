window.AVEIR_CLOUD = window.AVEIR_CLOUD || (function () {
  const AVEIR_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCoQuN54Z_76uYcva2JHQ6ujefv4oYkwT8',
    authDomain: 'aveir-185b9.firebaseapp.com',
    projectId: 'aveir-185b9',
    storageBucket: 'aveir-185b9.firebasestorage.app',
    messagingSenderId: '466944543879',
    appId: '1:466944543879:web:88a9175d65cec53ecb7c22'
  };
  const AVEIR_FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const AVEIR_ORDER_LIMIT = 500;
  const AVEIR_ROLES = ['admin', 'owner'];

  const cfg = AVEIR_FIREBASE_CONFIG;
  const configured = !!(cfg.apiKey && cfg.projectId);
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let booting = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function boot() {
    if (!configured) return Promise.reject(new Error('not-configured'));
    if (!booting) {
      booting = (window.firebase && window.firebase.initializeApp ? Promise.resolve() : loadScript(AVEIR_FIREBASE_SDK + 'firebase-app-compat.js'))
        .then(() => Promise.all([
          window.firebase.auth ? null : loadScript(AVEIR_FIREBASE_SDK + 'firebase-auth-compat.js'),
          window.firebase.firestore ? null : loadScript(AVEIR_FIREBASE_SDK + 'firebase-firestore-compat.js')
        ]))
        .then(() => {
          const fb = window.firebase;
          if (!fb.apps.length) fb.initializeApp(cfg);
          return { fb, auth: fb.auth(), db: fb.firestore() };
        });
      booting.catch(() => { booting = null; });
    }
    return booting;
  }

  function day() {
    const d = new Date();
    return MONTHS[d.getMonth()] + ' ' + ('0' + d.getDate()).slice(-2) + ', ' + d.getFullYear();
  }

  function cleanEmail(v) { return String(v || '').trim().toLowerCase(); }
  function validEmail(e) { return e.length < 200 && /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(e); }
  function now(fb) { return fb.firestore.FieldValue.serverTimestamp(); }
  function rows(snap) { return snap.docs.map(d => Object.assign({}, d.data(), { id: d.id })); }
  function friendly(err) {
    const code = (err && err.code) || '';
    const map = {
      'auth/invalid-credential': 'WRONG EMAIL OR PASSWORD',
      'auth/wrong-password': 'WRONG EMAIL OR PASSWORD',
      'auth/user-not-found': 'WRONG EMAIL OR PASSWORD',
      'auth/invalid-email': 'THAT EMAIL LOOKS WRONG',
      'auth/email-already-in-use': 'THIS EMAIL ALREADY HAS AN ACCOUNT, SIGN IN INSTEAD',
      'auth/weak-password': 'PASSWORD NEEDS AT LEAST 8 CHARACTERS',
      'auth/too-many-requests': 'TOO MANY TRIES, WAIT A MINUTE',
      'auth/network-request-failed': 'NETWORK ERROR, TRY AGAIN',
      'permission-denied': 'THE DATABASE IS BLOCKING THIS. PUBLISH FIREBASE/FIRESTORE.RULES IN THE FIREBASE CONSOLE.',
      'not-configured': 'ADMIN LOGIN IS NOT CONNECTED YET'
    };
    return map[code] || map[err && err.message] || String((err && err.message) || 'SOMETHING WENT WRONG').toUpperCase();
  }

  function bootstrapOpen(ctx) {
    return ctx.db.collection('meta').doc('bootstrap').get().then(d => !d.exists);
  }

  async function claimSeat(ctx, user) {
    if (!user.emailVerified) await user.reload();
    const fresh = ctx.auth.currentUser;
    if (!fresh || !fresh.emailVerified) return false;
    await fresh.getIdToken(true);
    const key = cleanEmail(fresh.email);
    const invite = await ctx.db.collection('invites').doc(key).get();
    if (invite.exists) {
      await ctx.db.collection('staff').doc(fresh.uid).set({ email: key, role: invite.data().role, name: '', createdAt: now(ctx.fb) });
      await ctx.db.collection('invites').doc(key).delete().catch(() => {});
      return true;
    }
    if (!await bootstrapOpen(ctx)) return false;
    await ctx.db.collection('staff').doc(fresh.uid).set({ email: key, role: 'admin', name: '', createdAt: now(ctx.fb) });
    await ctx.db.collection('meta').doc('bootstrap').set({ claimedBy: key, claimedAt: now(ctx.fb) });
    return true;
  }

  function watch(query, cb) {
    let stop = () => {};
    let dead = false;
    boot().then(ctx => {
      if (dead) return;
      stop = query(ctx).onSnapshot(snap => cb(rows(snap), null), err => cb(null, err));
    }).catch(err => cb(null, err));
    return () => { dead = true; stop(); };
  }

  return {
    configured,
    boot,
    friendly,
    roles: AVEIR_ROLES,

    addSubscriber(email, source) {
      const e = cleanEmail(email);
      if (!configured || !validEmail(e)) return Promise.resolve(false);
      return boot()
        .then(ctx => ctx.db.collection('subscribers').doc(e).set({ email: e, joined: day(), ts: Date.now(), source: String(source || 'site').slice(0, 30) }))
        .then(() => true, () => false);
    },

    addSms(phone, source) {
      const raw = String(phone || '').trim();
      const digits = raw.replace(/\D/g, '');
      if (!configured || digits.length < 10 || digits.length > 15) return Promise.resolve(false);
      return boot()
        .then(ctx => ctx.db.collection('sms').doc(digits).set({ phone: raw.slice(0, 30), digits, joined: day(), ts: Date.now(), source: String(source || 'site').slice(0, 30) }))
        .then(() => true, () => false);
    },

    watchStaff(cb) {
      if (!configured) { cb({ state: 'off' }); return () => {}; }
      cb({ state: 'loading' });
      let stop = () => {};
      let dead = false;
      boot().then(ctx => {
        if (dead) return;
        stop = ctx.auth.onAuthStateChanged(async user => {
          if (!user) { cb({ state: 'out' }); return; }
          try {
            let doc = await ctx.db.collection('staff').doc(user.uid).get();
            if (!doc.exists && await claimSeat(ctx, user)) doc = await ctx.db.collection('staff').doc(user.uid).get();
            const current = ctx.auth.currentUser || user;
            if (!doc.exists) { cb({ state: current.emailVerified ? 'denied' : 'unverified', user: current }); return; }
            cb({ state: 'in', user: current, staff: Object.assign({ uid: user.uid }, doc.data()) });
          } catch (err) {
            cb({ state: 'error', user, error: friendly(err) });
          }
        });
      }).catch(err => cb({ state: 'error', error: friendly(err) }));
      return () => { dead = true; stop(); };
    },

    signIn(email, password) {
      return boot().then(ctx => ctx.auth.signInWithEmailAndPassword(cleanEmail(email), password));
    },

    async setUp(email, password) {
      const ctx = await boot();
      const key = cleanEmail(email);
      if (String(password || '').length < 8) throw { code: 'auth/weak-password' };
      const cred = await ctx.auth.createUserWithEmailAndPassword(key, password);
      void cred;
      await cred.user.sendEmailVerification();
      return true;
    },

    resendVerification() {
      return boot().then(ctx => ctx.auth.currentUser ? ctx.auth.currentUser.sendEmailVerification() : null);
    },

    resetPassword(email) {
      return boot().then(ctx => ctx.auth.sendPasswordResetEmail(cleanEmail(email)));
    },

    signOut() {
      return boot().then(ctx => ctx.auth.signOut());
    },

    watchOrders(cb) {
      return watch(ctx => ctx.db.collection('orders').orderBy('createdAt', 'desc').limit(AVEIR_ORDER_LIMIT), (list, err) => {
        cb(list ? list.filter(o => o.status && o.status !== 'PENDING') : null, err);
      });
    },

    updateOrder(id, patch) {
      return boot().then(ctx => ctx.db.collection('orders').doc(id).update(Object.assign({}, patch, { updatedAt: now(ctx.fb) })));
    },

    addTestOrder(order) {
      return boot().then(ctx => ctx.db.collection('orders').add(Object.assign({}, order, { status: 'NEW', test: true, createdAt: now(ctx.fb) })));
    },

    watchSubscribers(cb) {
      return watch(ctx => ctx.db.collection('subscribers').orderBy('ts', 'desc'), cb);
    },

    watchSms(cb) {
      return watch(ctx => ctx.db.collection('sms').orderBy('ts', 'desc'), cb);
    },

    watchTeam(cb) {
      return watch(ctx => ctx.db.collection('staff'), cb);
    },

    watchInvites(cb) {
      return watch(ctx => ctx.db.collection('invites'), cb);
    },

    async invite(email, role) {
      const key = cleanEmail(email);
      if (!validEmail(key)) throw new Error('THAT EMAIL LOOKS WRONG');
      if (AVEIR_ROLES.indexOf(role) < 0) throw new Error('PICK A ROLE');
      const ctx = await boot();
      const me = ctx.auth.currentUser;
      const taken = await ctx.db.collection('staff').where('email', '==', key).get();
      if (!taken.empty) throw new Error('THAT PERSON IS ALREADY ON THE TEAM');
      const existing = await ctx.db.collection('invites').doc(key).get();
      if (existing.exists) throw new Error('THAT EMAIL IS ALREADY INVITED');
      await ctx.db.collection('invites').doc(key).set({ email: key, role, invitedBy: me ? cleanEmail(me.email) : '', createdAt: now(ctx.fb) });
      return key;
    },

    cancelInvite(email) {
      return boot().then(ctx => ctx.db.collection('invites').doc(cleanEmail(email)).delete());
    },

    setRole(uid, role) {
      if (AVEIR_ROLES.indexOf(role) < 0) return Promise.reject(new Error('PICK A ROLE'));
      return boot().then(ctx => ctx.db.collection('staff').doc(uid).update({ role }));
    },

    removeStaff(uid) {
      return boot().then(ctx => ctx.db.collection('staff').doc(uid).delete());
    },

    getSetting(id) {
      return boot().then(ctx => ctx.db.collection('settings').doc(id).get()).then(d => (d.exists ? d.data() : null));
    },

    setSetting(id, data) {
      return boot().then(ctx => ctx.db.collection('settings').doc(id).set(data));
    }
  };
})();
