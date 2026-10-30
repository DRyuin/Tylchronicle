/* =====================================================================
   shim.js : couche d'adaptation « plateforme Artifact » -> Supabase
   Table de combat Tylchronicle.

   Imite window.claude.use(name) (spec : artifact-capabilities 0.2.75,
   claude.d.ts / db.d.ts / room.d.ts / user.d.ts) avec supabase-js v2.
   ES5 uniquement, aucune dépendance autre que supabase.js (window.supabase).
   Ordre de chargement : supabase.js, config.js, shim.js, data.js, app.js.

   Capacités servies :
     use('user')   -> isOwner/canEdit/can/id/me/profiles/name/avatarUrl/email/search
     use('db')     -> doc/collection, get/set/update/delete/add/onSnapshot
     use('room')   -> emit/on/connected/onConnection (+ stubs présence/join)
     use('assets') -> délégué à window.__tylAssets(client, {uid, isMj}) ou null
     use('sample') -> null (IA désactivée)
     autre nom     -> null
   Tant qu'aucune session Supabase n'existe, les promesses restent en
   attente et un écran de connexion (e-mail + mot de passe, ou lien magique
   pour la 1re connexion / le mot de passe oublié) est affiché ; après un lien,
   l'écran « Choisis ton mot de passe » est obligatoire.
   Si TYL_CONFIG / supabase.js manquent : tout résout null (« absent »).
   ===================================================================== */
(function (window) {
  'use strict';

  var VERSION = '1.1.0';
  window.TYL_SHIM_VERSION = VERSION;

  var document = window.document;
  var lastErrors = [];
  var stats = { reads: 0, writes: 0, events: 0, echoes: 0, deliveries: 0 };

  function noteErr(where, e) {
    try {
      lastErrors.push({
        at: new Date().toISOString(),
        where: where,
        code: e && e.code ? String(e.code) : '',
        message: String((e && (e.message || e.error_description)) || e)
      });
      if (lastErrors.length > 15) lastErrors.shift();
    } catch (x) { /* ignoré */ }
  }

  // ---------------------------------------------------------------------
  // « Rester connecté » (revue I2). La session est TOUJOURS dans localStorage :
  // un seul exemplaire, partagé par les onglets et protégé par le verrou de
  // supabase-js (pas de réutilisation du refresh token entre deux onglets, pas
  // de sessions de comptes différents mélangées). Case décochée (tyl.keep « 0 ») :
  // un cookie de session « tyl.alive » (sans date d'expiration, donc supprimé
  // par le navigateur à sa fermeture, et partagé par les onglets) marque la
  // visite en cours. Au chargement, AVANT createClient, si tyl.keep vaut « 0 »
  // et que le marqueur manque (navigateur rouvert), les jetons sb-*-auth-token
  // sont retirés de localStorage. Le « code verifier » PKCE n'est jamais purgé.
  // Cookies refusés : marqueur de repli en sessionStorage (limité à l'onglet).
  // Limite connue : un navigateur qui restaure la session au démarrage garde
  // aussi les cookies de session. Stockage bloqué : repli en mémoire.
  // Aucun mot de passe n'est stocké ici.
  // ---------------------------------------------------------------------
  var KEEP_KEY = 'tyl.keep', ALIVE = 'tyl.alive', GATE_KEY = 'tyl.gate';
  var VERIF_RE = /-code-verifier$/, TOKEN_RE = /^sb-.+-auth-token$/;
  var keepMem = true, memStore = {};
  function stoGet(kind, k) {
    try { var s = window[kind]; if (!s) return null; var v = s.getItem(k); return v === undefined ? null : v; } catch (e) { return null; }
  }
  function stoSet(kind, k, v) {
    try { var s = window[kind]; if (!s) return false; s.setItem(k, v); return true; } catch (e) { return false; }
  }
  function stoDel(kind, k) {
    try { var s = window[kind]; if (s) s.removeItem(k); } catch (e) { /* ignoré */ }
  }
  function localKeys(re) {
    var out = [], i, k;
    try { var s = window.localStorage; if (!s) return out; for (i = 0; i < s.length; i++) { k = s.key(i); if (k && re.test(k)) out.push(k); } } catch (e) { /* ignoré */ }
    return out;
  }
  function readKeep() {
    try {
      var v = window.localStorage.getItem(KEEP_KEY);
      if (v === '0') return false;
      if (v === '1') return true;
    } catch (e) { /* ignoré */ }
    return keepMem;
  }
  function saveKeep(on) {
    keepMem = !!on;
    try { window.localStorage.setItem(KEEP_KEY, on ? '1' : '0'); } catch (e) { /* ignoré */ }
  }
  function hasAliveCookie() {
    try { return /(?:^|;\s*)tyl\.alive=1(?:;|$)/.test(String(window.document.cookie || '')); } catch (e) { return false; }
  }
  function isAlive() { return hasAliveCookie() || stoGet('sessionStorage', ALIVE) === '1'; }
  function markAlive() {
    try {
      var dir = String(window.location.pathname || '/').replace(/[^\/]*$/, '') || '/';
      window.document.cookie = ALIVE + '=1; path=' + dir + '; SameSite=Strict' + (window.location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) { /* ignoré */ }
    if (!hasAliveCookie()) stoSet('sessionStorage', ALIVE, '1');
  }
  (function () {
    if (!readKeep() && !isAlive()) {
      var ks = localKeys(TOKEN_RE), i;
      for (i = 0; i < ks.length; i++) stoDel('localStorage', ks[i]);
    }
    markAlive();
  })();
  // Un code verifier existait-il AVANT que supabase-js ne traite l'URL ? (revue I3)
  var verifierAtLoad = localKeys(VERIF_RE).some(function (k) { return !!stoGet('localStorage', k); });
  function verifierInMemory() { for (var k in memStore) if (hasOwn(memStore, k) && VERIF_RE.test(k)) return true; return false; }
  var sessionStore = {
    getItem: function (k) {
      var v = stoGet('localStorage', k);
      if (v === null && hasOwn(memStore, k)) v = memStore[k];
      return v;
    },
    setItem: function (k, v) {
      if (stoSet('localStorage', k, String(v))) delete memStore[k]; else memStore[k] = String(v);
    },
    removeItem: function (k) { stoDel('localStorage', k); delete memStore[k]; }
  };

  // ---------------------------------------------------------------------
  // Configuration : absente ou invalide => toutes les capacités « absentes ».
  // ---------------------------------------------------------------------
  var CFG = window.TYL_CONFIG;
  var SB = window.supabase;
  var client = null;
  if (CFG && typeof CFG.url === 'string' && /^https?:\/\/\S+$/.test(CFG.url) &&
      typeof CFG.key === 'string' && CFG.key.length > 10 &&
      SB && typeof SB.createClient === 'function') {
    try {
      // Flux PKCE (audit M5) : le lien magique revient avec ?code=…, échangé
      // contre la session grâce au « code verifier » gardé dans CE navigateur.
      // Les jetons ne transitent plus dans l'URL. Repli possible : flow:'implicit'
      // dans config.js (ancien comportement).
      client = SB.createClient(CFG.url, CFG.key, {
        auth: {
          persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
          storage: sessionStore,
          flowType: CFG.flow === 'implicit' ? 'implicit' : 'pkce'
        }
      });
    } catch (e) { noteErr('createClient', e); client = null; }
  }

  if (!client) {
    // Comme la plateforme quand la capacité n'est pas servie : null.
    if (!(window.claude && typeof window.claude.use === 'function')) {
      window.claude = { use: function () { return Promise.resolve(null); } };
    }
    window.tylSignOut = function () { return Promise.resolve(); };
    window.tylDebug = function () {
      return { version: VERSION, configured: false, lastErrors: lastErrors.slice() };
    };
    try { if (window.console) window.console.warn('[tyl-shim] TYL_CONFIG ou supabase.js absent : mode local.'); } catch (e) { /* ignoré */ }
    return;
  }

  // ---------------------------------------------------------------------
  // Petits utilitaires
  // ---------------------------------------------------------------------
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
  }
  function utf8Len(s) { return unescape(encodeURIComponent(s)).length; }
  function later(fn, ms) { return setTimeout(fn, ms || 0); }
  function randomId(n) {
    var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = '', i, r = null;
    try {
      if (window.crypto && window.crypto.getRandomValues) { r = new Uint8Array(n); window.crypto.getRandomValues(r); }
    } catch (e) { r = null; }
    for (i = 0; i < n; i++) s += a.charAt((r ? r[i] : Math.floor(Math.random() * 256)) % a.length);
    return s;
  }
  // Copie JSON pure (supprime undefined, fonctions...). Lève si non sérialisable.
  function plain(v) { return JSON.parse(JSON.stringify(v)); }
  // JSON canonique : clés triées récursivement. Sert à comparer un contenu
  // écrit avec ce que renvoie Postgres (jsonb réordonne les clés).
  function canon(v) {
    var i, ks, out;
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Object.prototype.toString.call(v) === '[object Array]') {
      out = [];
      for (i = 0; i < v.length; i++) out.push(v[i] === undefined ? 'null' : canon(v[i]));
      return '[' + out.join(',') + ']';
    }
    ks = Object.keys(v).sort();
    out = [];
    for (i = 0; i < ks.length; i++) {
      if (v[ks[i]] === undefined || typeof v[ks[i]] === 'function') continue;
      out.push(JSON.stringify(ks[i]) + ':' + canon(v[ks[i]]));
    }
    return '{' + out.join(',') + '}';
  }
  // Même sémantique que private.jsonb_deep_merge (002_functions.sql).
  function deepMerge(base, patch) {
    var res = isPlainObject(base) ? base : {}, k;
    for (k in patch) {
      if (!hasOwn(patch, k)) continue;
      if (isPlainObject(patch[k])) res[k] = deepMerge(isPlainObject(res[k]) ? res[k] : {}, patch[k]);
      else res[k] = patch[k];
    }
    return res;
  }

  // ---------------------------------------------------------------------
  // Erreurs : objets Error avec .code (codes de db.d.ts)
  // ---------------------------------------------------------------------
  function dbErr(code, message, cause) {
    var e = new Error(message || code);
    e.code = code;
    if (cause) e.cause = cause;
    return e;
  }
  // Traduction d'une erreur PostgREST / réseau.
  //  - 42501 (RLS, docs_assign_guard, doc_update refusé), P0001 (doc_update :
  //    « invalid_argument: … »), 22xxx/23xxx (contraintes : taille, liste
  //    blanche des collections…), HTTP 400/403/409/413 => invalid_argument
  //    (l'appli passe alors en lecture seule).
  //  - pas de réponse / 5xx / 401 (jeton expiré, rafraîchi tout seul) => unavailable.
  //  - PGRST2xx (fonction ou table absente : migration oubliée) => invalid_argument,
  //    sinon l'appli réessaierait sans fin (revue M7).
  function toDbError(err, status, op) {
    var code = String((err && err.code) || ''), msg = String((err && err.message) || err || 'erreur');
    var out;
    if (code === '42501' || code === 'P0001' || /^PGRST2/.test(code) || /^invalid_argument/.test(msg) || /^2[23]/.test(code)) out = 'invalid_argument';
    else if (status === 429) out = 'resource_exhausted';
    else if (!status || status >= 500 || status === 401 || status === 404 || /FetchError|Failed to fetch|NetworkError|AbortError|timeout/i.test(msg)) out = 'unavailable';
    else if (status === 400 || status === 403 || status === 409 || status === 413) out = 'invalid_argument';
    else out = 'unavailable';
    var e = dbErr(out, op + ' : ' + msg, err);
    noteErr('db.' + op, e);
    return e;
  }
  // Exécute un builder supabase (thenable) et normalise exceptions et erreurs.
  function run(builderFn, op) {
    return new Promise(function (resolve, reject) {
      var b;
      // Exception levée en construisant la requête : bogue, pas le réseau.
      try { b = builderFn(); } catch (e) { reject(toDbError({ code: 'PGRST200', message: String((e && e.message) || e) }, 400, op)); return; }
      Promise.resolve(b).then(function (r) {
        r = r || {};
        if (r.error) reject(toDbError(r.error, r.status, op));
        else resolve(r);
      }, function (e) { reject(toDbError(e, 0, op)); });
    });
  }

  // ---------------------------------------------------------------------
  // Session / connexion
  // ---------------------------------------------------------------------
  var uid = null, userEmail = null, profile = null, profileOk = false, profP = null;
  var readyResolve = null;
  var readyP = new Promise(function (r) { readyResolve = r; });
  var isReady = false;

  // Erreur éventuelle renvoyée par le lien magique (lue avant que supabase-js
  // ne nettoie l'URL).
  var urlAuthError = (function () {
    try {
      var h = String(window.location.hash || '').replace(/^#/, '') + '&' + String(window.location.search || '').replace(/^\?/, '');
      var m = /(?:^|&)error_code=([^&]*)/.exec(h), d = /(?:^|&)error_description=([^&]*)/.exec(h);
      if (!m && !d) return '';
      var c = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
      if (/otp_expired/i.test(c)) return 'Ce lien a expiré ou a déjà servi. Demande un nouveau lien.';
      return 'Le lien de connexion n\'est pas valide (' + (d ? decodeURIComponent(d[1].replace(/\+/g, ' ')) : c) + '). Demande un nouveau lien.';
    } catch (e) { return ''; }
  })();

  var AUTH_KEYS = /^(access_token|refresh_token|expires_at|expires_in|token_type|type|provider_token|provider_refresh_token|error|error_code|error_description|code|sb|sb_flow_id)$/;
  // Retire de l'URL les seuls paramètres d'authentification (garde par ex. #joueuse).
  function cleanUrl() {
    try {
      var loc = window.location, h = String(loc.hash || '').replace(/^#/, ''), s = String(loc.search || '').replace(/^\?/, '');
      var keep = function (str) {
        if (!str) return '';
        if (str.indexOf('=') < 0) return str; // simple fragment (#joueuse)
        return str.split('&').filter(function (p) { return p && !AUTH_KEYS.test(p.split('=')[0]); }).join('&');
      };
      var nh = keep(h), ns = keep(s);
      if (nh === h && ns === s && String(loc.href).slice(-1) !== '#') return;
      var url = loc.pathname + (ns ? '?' + ns : '') + (nh ? '#' + nh : '');
      if (window.history && window.history.replaceState) window.history.replaceState(window.history.state, '', url);
    } catch (e) { noteErr('cleanUrl', e); }
  }

  function loadProfile() {
    if (profileOk) return Promise.resolve(profile);
    if (profP) return profP;
    profP = run(function () {
      return client.from('profiles').select('id,role,display_name,email').eq('id', uid).maybeSingle();
    }, 'profile').then(function (r) {
      profile = r.data || null; profileOk = true;
      if (profile) profCache[uid] = { row: profile, at: Date.now() };
      return profile;
    }, function () { profP = null; return null; });
    return profP;
  }
  // Profil : tant que la lecture échoue (réseau), nouvel essai avec délai
  // croissant (0,5 s, 1 s, 2 s… plafonné à 30 s) ; les capacités ne sont
  // servies qu'une fois le profil lu (revue I5 : un MJ n'est jamais pris pour
  // une joueuse à cause d'un réseau instable). Un profil réellement absent
  // (réponse vide) termine l'attente tout de suite.
  var PROFILE_RETRY0 = 500, PROFILE_RETRY_MAX = 30000;
  function profileUntilOk() {
    var wait = PROFILE_RETRY0, n = 0;
    function attempt() {
      return loadProfile().then(function (p) {
        if (profileOk) { waitBanner(false); return p; }
        if (++n >= 2) waitBanner(true);
        var d = wait; wait = Math.min(PROFILE_RETRY_MAX, wait * 2);
        return new Promise(function (r) { later(r, d); }).then(attempt);
      });
    }
    return attempt();
  }
  function profileRetry() { return profileOk ? Promise.resolve(profile) : profileUntilOk(); }
  function isMj() { return !!(profile && profile.role === 'mj'); }

  // Petit bandeau « Connexion au serveur… » (seulement si le profil tarde).
  var waitEl = null;
  function waitBanner(on) {
    try {
      if (on && !waitEl && document && document.body) {
        waitEl = el('div', { id: 'tyl-wait', role: 'status', 'aria-live': 'polite',
          style: 'position:fixed;top:0;left:0;right:0;z-index:2147483001;background:var(--primary,#2E5B4E);color:var(--on-primary,#FFFFFF);padding:6px 12px;text-align:center;font:inherit' },
          'Connexion au serveur… nouvel essai en cours.');
        document.body.appendChild(waitEl);
      } else if (!on && waitEl) {
        if (waitEl.parentNode) waitEl.parentNode.removeChild(waitEl);
        waitEl = null;
      }
    } catch (e) { /* ignoré */ }
  }

  // Session expirée ou révoquée (revue I6) : pas de rechargement (la dernière
  // écriture serait perdue). Écran de connexion par-dessus l'appli, écritures
  // refusées en « unavailable » (l'appli réessaie), reprise sans rechargement
  // si le MÊME compte revient ; un autre compte => rechargement.
  var signedOut = false, leaving = false;
  function onSignedOut() {
    if (leaving || signedOut) return;
    signedOut = true;
    showLogin('Session expirée, reconnecte-toi.');
  }
  function onSession(s) {
    if (!s || !s.user) return;
    if (uid) {
      if (s.user.id !== uid) { reload(); return; } // autre compte connecté
      if (signedOut) {
        signedOut = false;
        hideLogin();
        authSync();
        Object.keys(cols).forEach(function (k) { refresh(cols[k]); });
        if (roomNs && roomNs.__resume) roomNs.__resume();
      }
      return;
    }
    uid = s.user.id;
    userEmail = s.user.email || null;
    hideLogin();
    cleanUrl();
    profileUntilOk().then(function () {
      isReady = true;
      readyResolve();
    });
  }
  function reload() { try { window.location.reload(); } catch (e) { /* ignoré */ } }

  // Realtime (canaux privés : room ET documents) : le JWT courant doit être
  // transmis avant chaque jonction et à chaque rafraîchissement (sinon
  // déconnexion à son expiration). setAuth() sans argument relit le jeton.
  // Source : https://supabase.com/docs/guides/realtime/authorization
  function authSync() {
    try {
      if (!client.realtime || typeof client.realtime.setAuth !== 'function') return Promise.resolve();
      return Promise.resolve(client.realtime.setAuth()).then(null, function (e) { noteErr('realtime.setAuth', e); });
    } catch (e) { noteErr('realtime.setAuth', e); return Promise.resolve(); }
  }

  // Retour d'un lien (revue I3). Seul un VRAI retour de lien compte : un code
  // ?code=… avec un code verifier présent au chargement (sinon supabase-js 2.118
  // ignore le code et garde la session déjà stockée), ou des jetons dans le
  // fragment en flux implicite. La preuve finale est l'événement SIGNED_IN /
  // PASSWORD_RECOVERY émis par l'échange réussi ; sans lui, pas de porte forcée.
  var urlHadCode = (function () {
    try { return /(?:^|&)code=/.test(String(window.location.search || '').replace(/^\?/, '')); } catch (e) { return false; }
  })();
  var linkCandidate = (urlHadCode && verifierAtLoad) || (CFG.flow === 'implicit' && (function () {
    try { return /(?:^|&)access_token=/.test(String(window.location.hash || '').replace(/^#/, '')); } catch (e) { return false; }
  })());
  var linkWait = linkCandidate, fromLink = false, LINK_WAIT = 1500;
  var PKCE_OTHER = 'Ce lien doit être ouvert dans le navigateur où tu l\'as demandé. Redemande un lien depuis ce navigateur-ci.';
  var LINK_BAD = 'Ce lien a expiré ou a déjà servi. Demande un nouveau lien.';

  // Revue I1 : supabase-js relaie aussi les événements des AUTRES onglets
  // (BroadcastChannel) sans rien écrire dans le stockage de celui-ci. On ne
  // croit donc que la session relue ici : même compte pour une connexion,
  // stockage réellement vide pour une déconnexion.
  function onAuthEvent(ev, s) {
    Promise.resolve().then(function () { return client.auth.getSession(); }).then(function (r) {
      var cur = r && r.data && r.data.session;
      if (s && s.user) {
        if (!cur || !cur.user || cur.user.id !== s.user.id) return; // pas (ou plus) la session de cet onglet
        if (linkWait) {
          if (ev !== 'SIGNED_IN' && ev !== 'PASSWORD_RECOVERY') return; // la décision attend la preuve du lien
          linkWait = false; fromLink = true;
        }
        route(ev, cur);
      } else if (ev === 'SIGNED_OUT') {
        if (cur && cur.user) return; // déconnexion d'un autre onglet au stockage distinct
        if (pwdGate) { closeGateState(); if (!uid) showLogin(''); }
        if (uid) onSignedOut();
      }
      if (ev === 'TOKEN_REFRESHED') authSync();
    }, function (e) { noteErr('getSession', e); });
  }
  try {
    client.auth.onAuthStateChange(function (ev, s) {
      // Ne pas appeler supabase depuis ce callback (verrou auth) : on diffère.
      later(function () { onAuthEvent(ev, s); });
    });
  } catch (e) { noteErr('onAuthStateChange', e); }

  Promise.resolve().then(function () { return client.auth.getSession(); }).then(function (r) {
    var s = r && r.data && r.data.session;
    cleanUrl();
    if (s && linkWait) {
      // Échange en cours ou raté : sans preuve, la session existante est servie sans porte forcée.
      later(function () { if (!linkWait) return; linkWait = false; route('INITIAL_SESSION', s); }, LINK_WAIT);
      return;
    }
    if (s) {
      if (urlHadCode && !linkCandidate) toast(PKCE_OTHER, 9000); // code sans verifier : ignoré, bandeau non bloquant
      route('INITIAL_SESSION', s);
      return;
    }
    linkWait = false;
    if (!uid) showLogin(urlAuthError || (urlHadCode ? (linkCandidate ? LINK_BAD : PKCE_OTHER) : '') || (r && r.error ? 'Session illisible, reconnecte-toi.' : ''));
  }, function (e) {
    noteErr('getSession', e);
    linkWait = false;
    if (!uid) showLogin('Connexion au serveur impossible. Vérifie ta connexion puis réessaie.');
  });

  window.tylSignOut = function () {
    leaving = true;
    stoDel('sessionStorage', GATE_KEY);
    var done = function () { reload(); };
    try { return Promise.resolve(client.auth.signOut()).then(done, done); } catch (e) { done(); return Promise.resolve(); }
  };

  // ---------------------------------------------------------------------
  // Écran de connexion : e-mail + mot de passe, lien magique (1re connexion /
  // mot de passe oublié), puis choix obligatoire du mot de passe.
  // Aucun mot de passe n'est stocké, journalisé ni affiché : les champs sont
  // vidés après chaque tentative, les erreurs serveur ne sont jamais
  // recopiées à l'écran (messages fixes, identiques que le compte existe ou non).
  // ---------------------------------------------------------------------
  var login = null, loginWanted = false, loginMsg = '', loginMode = 'signin';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var MSG_BAD = 'E-mail ou mot de passe incorrect.';
  var MSG_MANY = 'Trop de tentatives. Patiente quelques minutes puis réessaie.';
  var MSG_NET = 'Serveur injoignable. Vérifie ta connexion Internet.';
  var MSG_SENT = 'Si cette adresse est invitée, un message vient d\'être envoyé.';
  var MSG_BLOCKED = 'Ton navigateur bloque le stockage de ce site : le lien reçu ne pourra pas te connecter. Autorise les données de site pour cette adresse, puis redemande un lien.';
  var PW_MIN = 6, PW_MAX_BYTES = 72; // 6 = minimum de Supabase Auth ; 72 octets = limite bcrypt

  function errText(err) { return String((err && err.message) || '') + ' ' + String((err && err.code) || ''); }
  function isRate(err) { return !!(err && (err.status === 429 || /rate.?limit|over_.*_limit|security purposes/i.test(errText(err)))); }
  function isNet(err) { return !!(err && (!err.status || /fetch|network/i.test(String(err.message || '')))) || !err; }
  function isSamePwd(err) { return /same_password|different from the old/i.test(errText(err)); }

  function pwdMessage(err) {
    if (isRate(err)) return MSG_MANY;
    if (isNet(err)) return MSG_NET;
    if (err.status >= 500) return 'Connexion impossible pour le moment. Réessaie dans un instant.';
    return MSG_BAD; // mauvais mot de passe, compte inexistant, non invité, non confirmé : un seul texte
  }
  // Lien magique : seul le réseau et la limite de débit se distinguent ; toute
  // autre réponse (invité ou non) donne le même message.
  function otpOutcome(err) {
    if (!err) return { t: MSG_SENT, k: 'ok' };
    if (isRate(err)) return { t: MSG_MANY, k: 'err' };
    if (isNet(err)) return { t: MSG_NET, k: 'err' };
    return { t: MSG_SENT, k: 'ok' };
  }
  function setPwdMessage(err) {
    var c = errText(err);
    if (isRate(err)) return { t: MSG_MANY };
    if (isNet(err)) return { t: MSG_NET };
    // « Secure password change » activé (revue I4) : session trop ancienne.
    if (/reauthentication_needed|reauthenticat/i.test(c)) return { t: 'Pour changer ton mot de passe, redemande un lien de connexion puis recommence.' };
    if (/at least|too short|minimum/i.test(c)) return { t: 'Au moins ' + PW_MIN + ' caractères.' };
    if (/weak_password|weak|pwned|compromised|known/i.test(c) || err.status === 422 && !isSamePwd(err)) {
      return { t: 'Ce mot de passe est trop faible ou connu. Choisis-en un autre.' };
    }
    if (isSamePwd(err)) return { t: 'Choisis un mot de passe différent de l\'ancien.' };
    if (err.status === 401 || err.status === 403 || /session/i.test(c)) {
      return { t: 'Session expirée. Redemande un lien de connexion.', expired: true };
    }
    return { t: 'L\'enregistrement a échoué. Réessaie.' };
  }
  // Règles du nouveau mot de passe (choix de Corentin) : aucune règle de force ni
  // de composition, seulement champ non vide, confirmation identique et les
  // limites techniques de Supabase (6 caractères minimum, 72 octets maximum).
  function codePoints(s) { return s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length; }
  function checkNewPassword(a, b) {
    if (codePoints(a) < PW_MIN) return 'Au moins ' + PW_MIN + ' caractères.';
    if (utf8Len(a) > PW_MAX_BYTES) return 'Mot de passe trop long (' + PW_MAX_BYTES + ' octets maximum).';
    if (a !== b) return 'Les deux mots de passe ne sont pas identiques.';
    return '';
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag), k;
    for (k in attrs) if (hasOwn(attrs, k)) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }

  // Bandeau bref (role=status) : confirmation lisible après la fermeture de l'écran (revue M9),
  // explication non bloquante d'un lien ignoré (revue I3).
  function toast(text, ms) {
    function show() {
      try {
        if (!document || !document.body) return;
        var t = el('div', { 'class': 'tyl-toast', role: 'status', 'aria-live': 'polite',
          style: 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483002;max-width:480px;margin:0 auto;padding:10px 14px;border-radius:8px;' +
            'background:var(--primary,#2E5B4E);color:var(--on-primary,#FFFFFF);text-align:center;font:inherit;box-shadow:var(--shadow,none)' });
        document.body.appendChild(t);
        t.textContent = text; // texte posé après l'insertion : annoncé par les lecteurs d'écran
        later(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 6000);
      } catch (e) { /* ignoré */ }
    }
    if (document && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  }

  // Couleurs : jetons de la charte (style.css, modes clair et sombre), valeurs claires en repli.
  var LOGIN_CSS =
    '#tyl-login{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:var(--bg,#F3F0E6);color:var(--ink,#1D2924);' +
    'display:flex;padding:16px;box-sizing:border-box;font:inherit;overflow:auto}' +
    '#tyl-login *{box-sizing:border-box;font:inherit}' +
    '#tyl-login .tyl-card{margin:auto;width:100%;max-width:380px;border:1px solid var(--line,#DAD5C1);border-radius:10px;padding:24px;background:var(--surface,#FBFAF4)}' +
    '#tyl-login h1{font-size:1.4em;font-weight:bold;margin:0 0 6px}' +
    '#tyl-login p{margin:0 0 16px;line-height:1.4}' +
    '#tyl-login p.tyl-who{font-weight:bold;word-break:break-all}' +
    '#tyl-login label{display:block;margin:0 0 6px;font-weight:bold}' +
    '#tyl-login input{width:100%;padding:10px 12px;border:1px solid var(--line-strong,#808878);border-radius:6px;background:var(--bg,#F3F0E6);color:var(--ink,#1D2924);margin:0 0 12px;font-size:16px}' +
    '#tyl-login input[aria-invalid=true]{border-color:var(--bad,#AE382C)}' +
    '#tyl-login input:focus,#tyl-login button:focus{outline:2px solid var(--primary,#2E5B4E);outline-offset:2px}' +
    '#tyl-login button{width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:6px;background:var(--primary,#2E5B4E);color:var(--on-primary,#FFFFFF);font-weight:bold;cursor:pointer}' +
    '#tyl-login button[disabled]{opacity:.6;cursor:default}' +
    '#tyl-login .tyl-pwrow{display:flex;gap:8px;align-items:flex-start;margin:0 0 12px}' +
    '#tyl-login .tyl-pwrow input{margin:0;flex:1 1 auto;min-width:0}' +
    '#tyl-login button.tyl-toggle{flex:0 0 auto;width:auto;min-width:6.2em;background:transparent;color:var(--primary,#2E5B4E);border:1px solid var(--primary,#2E5B4E)}' +
    '#tyl-login button.tyl-toggle[aria-pressed=true]{background:var(--primary,#2E5B4E);color:var(--on-primary,#FFFFFF)}' +
    '#tyl-login .tyl-keep{display:flex;align-items:center;gap:10px;margin:0 0 14px}' +
    '#tyl-login .tyl-keep input{width:22px;height:22px;margin:0;flex:0 0 auto}' +
    '#tyl-login .tyl-keep label{margin:0;font-weight:normal}' +
    '#tyl-login .tyl-sep{margin:16px 0 0;padding-top:8px;border-top:1px solid var(--line,#DAD5C1)}' +
    '#tyl-login button.tyl-link{background:transparent;color:var(--primary,#2E5B4E);font-weight:normal;text-decoration:underline;padding:8px 0}' +
    '#tyl-login .tyl-vh{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}' +
    '#tyl-login .tyl-msg{margin:14px 0 0;min-height:1.4em}' +
    '#tyl-login .tyl-msg.err{color:var(--bad,#AE382C)}' +
    '#tyl-login .tyl-msg.ok{color:var(--ok,#2F6A43)}';

  function normEmail(v) { return String(v || '').replace(/^\s+|\s+$/g, '').toLowerCase(); }

  // Bouton « Afficher » (revue M8) : libellé fixe, l'état passe par aria-pressed.
  function makeToggle(inputs) {
    var t = el('button', { type: 'button', id: 'tyl-login-pw-toggle', 'class': 'tyl-toggle', 'aria-pressed': 'false', 'aria-label': 'Afficher le mot de passe' }, 'Afficher');
    t.addEventListener('click', function () {
      var show = t.getAttribute('aria-pressed') !== 'true', i;
      for (i = 0; i < inputs.length; i++) inputs[i].setAttribute('type', show ? 'text' : 'password');
      t.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
    return t;
  }

  // Formulaire 1 : e-mail + mot de passe + « Rester connecté » + lien magique.
  function buildSigninForm(say) {
    var busy = false;
    var form = el('form', { novalidate: 'novalidate', 'aria-busy': 'false' });
    var logo = el('img', { src: 'logo.svg', alt: '', width: '56', height: '56', style: 'display:block;margin:0 auto .6rem' });
    var title = el('h1', { id: 'tyl-login-title' }, 'Table de combat');
    var intro = el('p', {}, 'Connecte-toi avec ton adresse e-mail et ton mot de passe.');
    var lEmail = el('label', { 'for': 'tyl-login-email' }, 'Adresse e-mail');
    var email = el('input', { id: 'tyl-login-email', type: 'email', name: 'email', autocomplete: 'email', required: 'required', autocapitalize: 'none', spellcheck: 'false' });
    var lPw = el('label', { 'for': 'tyl-login-pw' }, 'Mot de passe');
    var row = el('div', { 'class': 'tyl-pwrow' });
    var pw = el('input', { id: 'tyl-login-pw', type: 'password', name: 'password', autocomplete: 'current-password', required: 'required' });
    var toggle = makeToggle([pw]);
    var keepRow = el('div', { 'class': 'tyl-keep' });
    var keep = el('input', { id: 'tyl-login-keep', type: 'checkbox', name: 'keep' });
    var lKeep = el('label', { 'for': 'tyl-login-keep' }, 'Rester connecté');
    var btn = el('button', { type: 'submit' }, 'Se connecter');
    var sep = el('div', { 'class': 'tyl-sep' });
    var hint = el('p', {}, 'Première visite ou mot de passe perdu : reçois un lien de connexion par e-mail.');
    var link = el('button', { type: 'button', 'class': 'tyl-link' }, 'Première connexion / Mot de passe oublié ?');
    keep.checked = readKeep();
    if (keep.checked) keep.setAttribute('checked', 'checked');
    row.appendChild(pw); row.appendChild(toggle);
    keepRow.appendChild(keep); keepRow.appendChild(lKeep);
    sep.appendChild(hint); sep.appendChild(link);
    form.appendChild(logo); form.appendChild(title); form.appendChild(intro);
    form.appendChild(lEmail); form.appendChild(email);
    form.appendChild(lPw); form.appendChild(row);
    form.appendChild(keepRow); form.appendChild(btn); form.appendChild(sep);

    function setBusy(on, label) {
      busy = on;
      btn.disabled = on; link.disabled = on;
      btn.textContent = on && label ? label : 'Se connecter';
      form.setAttribute('aria-busy', on ? 'true' : 'false');
    }
    // La préférence n'est enregistrée qu'à la connexion ou à la demande de lien
    // (revue I2 : cocher la case seule ne change rien pour les autres onglets).

    form.addEventListener('submit', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busy) return;
      var mail = normEmail(email.value), pass = String(pw.value || '');
      if (!mail || !pass) { say('Saisis ton e-mail et ton mot de passe.', 'err', mail ? pw : email); return; }
      if (!EMAIL_RE.test(mail)) { say('Adresse e-mail invalide.', 'err', email); return; }
      saveKeep(!!keep.checked); markAlive();
      setBusy(true, 'Connexion…'); say('', '');
      signedByPwd = true; // la session qui va arriver vient du mot de passe : pas d'écran de choix
      Promise.resolve().then(function () {
        return client.auth.signInWithPassword({ email: mail, password: pass });
      }).then(function (r) {
        pass = ''; pw.value = '';
        if (r && r.error) { signedByPwd = false; setBusy(false); noteErr('signInWithPassword', { code: r.error.code, message: 'refusé (' + (r.error.status || 0) + ')' }); say(pwdMessage(r.error), 'err', pw); return; }
        setBusy(false);
        var ses = r && r.data && r.data.session, md = ses && ses.user && ses.user.user_metadata;
        route('SIGNED_IN', ses);
        // Revue M2 : mot de passe posé ailleurs (ex. MJ via le tableau de bord) => plus de porte au rechargement.
        if (ses && !(md && md.pwd_set === true)) {
          later(function () {
            try { Promise.resolve(client.auth.updateUser({ data: { pwd_set: true } })).then(null, function (e) { noteErr('updateUser', { code: e && e.code, message: 'pwd_set' }); }); } catch (e) { /* ignoré */ }
          });
        }
      }, function (e) {
        pass = ''; pw.value = ''; signedByPwd = false; setBusy(false);
        noteErr('signInWithPassword', { code: e && e.code, message: 'échec réseau' });
        say(pwdMessage(e), 'err');
      });
    });

    link.addEventListener('click', function () {
      if (busy) return;
      var mail = normEmail(email.value);
      if (!EMAIL_RE.test(mail)) { say('Adresse e-mail invalide.', 'err', email); return; }
      saveKeep(!!keep.checked); markAlive();
      setBusy(true); say('Envoi en cours…', '');
      Promise.resolve().then(function () {
        return client.auth.signInWithOtp({ email: mail, options: { emailRedirectTo: CFG.redirect, shouldCreateUser: CFG.signup !== false } });
      }).then(function (r) {
        setBusy(false);
        if (r && r.error) noteErr('signInWithOtp', { code: r.error.code, message: 'refusé (' + (r.error.status || 0) + ')' });
        // Revue M10 : code verifier resté en mémoire => le lien ne pourra pas aboutir.
        if (verifierInMemory()) { say(MSG_BLOCKED, 'err'); return; }
        var o = otpOutcome(r && r.error);
        say(o.t, o.k);
      }, function (e) {
        setBusy(false); noteErr('signInWithOtp', { code: e && e.code, message: 'échec réseau' });
        var o = otpOutcome(e || { status: 0 });
        say(o.t, o.k);
      });
    });
    return { form: form, focus: email };
  }

  // Formulaire 2 : « Choisis ton mot de passe » (obligatoire après un lien).
  function buildSetPwdForm(say) {
    var busy = false;
    var who = (gateSession && gateSession.user && gateSession.user.email) || userEmail || '';
    var form = el('form', { novalidate: 'novalidate', 'aria-busy': 'false' });
    var title = el('h1', { id: 'tyl-login-title' }, 'Choisis ton mot de passe');
    // Revue M3 : le compte concerné est affiché (textContent, sans HTML).
    var account = el('p', { 'class': 'tyl-who' }, who ? 'Compte : ' + who : '');
    var intro = el('p', {}, 'Choisis le mot de passe que tu veux. Au moins ' + PW_MIN + ' caractères. Tes autres appareils seront déconnectés.');
    var user = el('input', { type: 'text', name: 'username', autocomplete: 'username', tabindex: '-1', 'aria-hidden': 'true', readonly: 'readonly', 'class': 'tyl-vh' });
    user.value = who;
    var l1 = el('label', { 'for': 'tyl-login-newpw' }, 'Nouveau mot de passe');
    var row = el('div', { 'class': 'tyl-pwrow' });
    var p1 = el('input', { id: 'tyl-login-newpw', type: 'password', name: 'new-password', autocomplete: 'new-password', required: 'required', minlength: String(PW_MIN) });
    var l2 = el('label', { 'for': 'tyl-login-newpw2' }, 'Confirme le mot de passe');
    var p2 = el('input', { id: 'tyl-login-newpw2', type: 'password', name: 'confirm-password', autocomplete: 'new-password', required: 'required' });
    var toggle = makeToggle([p1, p2]);
    var btn = el('button', { type: 'submit' }, 'Enregistrer le mot de passe');
    var out = el('button', { type: 'button', 'class': 'tyl-link' }, 'Annuler et se déconnecter');
    row.appendChild(p1); row.appendChild(toggle);
    form.appendChild(title);
    if (who) form.appendChild(account);
    form.appendChild(intro); form.appendChild(user);
    form.appendChild(l1); form.appendChild(row); form.appendChild(l2); form.appendChild(p2);
    form.appendChild(btn); form.appendChild(out);

    function setBusy(on) {
      busy = on; gateBusy = on; btn.disabled = on; out.disabled = on;
      btn.textContent = on ? 'Enregistrement…' : 'Enregistrer le mot de passe';
      form.setAttribute('aria-busy', on ? 'true' : 'false');
    }
    function wipe() { p1.value = ''; p2.value = ''; }
    out.addEventListener('click', function () { if (!busy && window.tylSignOut) window.tylSignOut(); });
    form.addEventListener('submit', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busy) return;
      var a = String(p1.value || ''), b = String(p2.value || '');
      var bad = checkNewPassword(a, b);
      if (bad) { say(bad, 'err', bad.indexOf('identiques') >= 0 ? p2 : p1); return; }
      setBusy(true); say('', '');
      // Revue I6 : 1) mot de passe ; 2) reconnexion de contrôle avec ce mot de
      // passe (015 peut le vider en silence avec un 200) ; 3) pwd_set seulement
      // si le contrôle réussit. Le mot de passe ne vit que dans cette fonction.
      Promise.resolve().then(function () {
        return client.auth.updateUser({ password: a });
      }).then(function (r) {
        if (r && r.error && !isSamePwd(r.error)) return { stage: 'set', error: r.error };
        // same_password : un essai précédent l'a déjà enregistré, on vérifie.
        if (!who) return { stage: 'unverified' };
        return Promise.resolve(client.auth.signInWithPassword({ email: who, password: a })).then(function (v) {
          if (v && v.error) return { stage: 'verify', error: v.error };
          return Promise.resolve(client.auth.updateUser({ data: { pwd_set: true, pwd_at: Date.now() } })).then(function (m) {
            if (m && m.error) noteErr('updateUser', { code: m.error.code, message: 'pwd_set (' + (m.error.status || 0) + ')' });
            return { stage: 'ok', user: (m && !m.error && m.data && m.data.user) || (v && v.data && v.data.user) };
          }, function () { return { stage: 'ok', user: v && v.data && v.data.user }; });
        }, function (e) { return { stage: 'verify', error: e || { status: 0 } }; });
      }).then(function (res) {
        a = ''; b = ''; wipe(); setBusy(false);
        if (res.stage === 'set') {
          noteErr('updateUser', { code: res.error.code, message: 'refusé (' + (res.error.status || 0) + ')' });
          var m = setPwdMessage(res.error);
          if (m.expired) { gateExpired(m.t); return; }
          say(m.t, 'err', p1); return;
        }
        if (res.stage === 'verify') {
          noteErr('verifyPassword', { code: res.error.code, message: 'refusé (' + (res.error.status || 0) + ')' });
          if (isRate(res.error) || isNet(res.error)) say('Mot de passe envoyé, mais sa vérification a échoué (' + (isRate(res.error) ? 'trop de tentatives' : 'réseau') + '). Réessaie dans un instant avec le même mot de passe.', 'err');
          else say('Ce mot de passe n\'a pas pu être pris en compte pour ce compte (compte non activé ou retiré de la table). Préviens le MJ.', 'err');
          return;
        }
        if (res.stage === 'unverified') {
          finishGate(null);
          toast('Mot de passe envoyé, sans vérification possible. Si la prochaine connexion échoue, redemande un lien.', 9000);
          return;
        }
        finishGate(res.user);
        toast('Mot de passe enregistré.');
      }, function (e) {
        a = ''; b = ''; wipe(); setBusy(false);
        noteErr('updateUser', { code: e && e.code, message: 'échec réseau' });
        say(setPwdMessage(e || { status: 0 }).t, 'err');
      });
    });
    return { form: form, focus: p1 };
  }

  function setMode(mode) {
    if (!login) return;
    loginMode = mode; login.mode = mode;
    var built = mode === 'setpwd' ? buildSetPwdForm(login.say) : buildSigninForm(login.say), i;
    for (i = login.card.children.length - 1; i >= 0; i--) login.card.removeChild(login.card.children[i]);
    login.card.appendChild(built.form); login.card.appendChild(login.msgEl);
    login.input = built.focus; login.flagged = null;
    login.say(loginMsg, loginMsg ? 'err' : '');
    try { built.focus.focus(); } catch (e) { /* ignoré */ }
  }

  // Revue M6 : le reste de la page est rendu inerte tant que l'écran est ouvert.
  function hideOthers(root) {
    var kids = document.body.children || [], done = [], i, n;
    for (i = 0; i < kids.length; i++) {
      n = kids[i];
      if (n === root || !n.setAttribute || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue;
      if (n.getAttribute && (n.getAttribute('inert') !== null && n.getAttribute('inert') !== undefined)) continue;
      n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); done.push(n);
    }
    return done;
  }
  function buildLogin() {
    if (login || !document || !document.body) return;
    var style = el('style', { id: 'tyl-login-css' });
    style.textContent = LOGIN_CSS;
    var root = el('div', { id: 'tyl-login', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tyl-login-title' });
    var card = el('div', { 'class': 'tyl-card' });
    var msg = el('p', { id: 'tyl-login-msg', 'class': 'tyl-msg', role: 'status', 'aria-live': 'polite' });
    root.appendChild(card);
    // Revue M7 : une erreur liée à un champ le marque (aria-invalid, aria-describedby) et y ramène le focus.
    function say(text, kind, field) {
      msg.textContent = text || ''; msg.setAttribute('class', 'tyl-msg' + (kind ? ' ' + kind : ''));
      if (login && login.flagged && login.flagged !== field) {
        try { login.flagged.removeAttribute('aria-invalid'); login.flagged.removeAttribute('aria-describedby'); } catch (e) { /* ignoré */ }
        login.flagged = null;
      }
      if (field && kind === 'err') {
        field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', 'tyl-login-msg');
        if (login) login.flagged = field;
        try { field.focus(); } catch (e) { /* ignoré */ }
      }
    }
    (document.head || document.body).appendChild(style);
    document.body.appendChild(root);
    login = { root: root, style: style, card: card, msgEl: msg, say: say, input: null, flagged: null, hidden: hideOthers(root) };
    setMode(loginMode);
  }
  function openLogin(mode, message) {
    loginWanted = true; loginMsg = message || ''; loginMode = mode;
    if (login) {
      if (login.mode === mode) login.say(loginMsg, loginMsg ? 'err' : '');
      else setMode(mode);
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { if (loginWanted) buildLogin(); });
    } else buildLogin();
  }
  function showLogin(message) {
    if (pwdGate) return; // l'écran de choix du mot de passe ne se ferme pas
    openLogin('signin', message);
  }
  function showSetPwd() { openLogin('setpwd', ''); }
  function hideLogin() {
    loginWanted = false;
    if (!login) return;
    var i, h = login.hidden || [];
    for (i = 0; i < h.length; i++) { try { h[i].removeAttribute('inert'); h[i].removeAttribute('aria-hidden'); } catch (e) { /* ignoré */ } }
    try { if (login.root.parentNode) login.root.parentNode.removeChild(login.root); } catch (e) { /* ignoré */ }
    try { if (login.style.parentNode) login.style.parentNode.removeChild(login.style); } catch (e) { /* ignoré */ }
    login = null;
  }

  // ---------------------------------------------------------------------
  // Choix obligatoire du mot de passe (après un vrai lien, une récupération,
  // ou une session sans mot de passe choisi). Tant que la porte est fermée
  // (pwdGate), l'appli n'est pas servie : use() reste en attente. La preuve de
  // l'identité vient de Supabase Auth (updateUser exige le jeton de session) ;
  // l'écran n'est qu'un cadre. La porte est notée dans sessionStorage
  // (tyl.gate = uid, revue M1) : un F5 ne la contourne pas.
  // ---------------------------------------------------------------------
  var pwdGate = false, gateSession = null, signedByPwd = false, gateBusy = false, gateAt = 0;
  function needsPwd(ev, s, byPwd) {
    if (byPwd) return false;                                      // session ouverte par mot de passe
    if (ev === 'PASSWORD_RECOVERY' || fromLink) return true;      // vrai retour de lien : on choisit
    if (stoGet('sessionStorage', GATE_KEY) === s.user.id) return true; // porte ouverte avant un rechargement
    var md = s.user.user_metadata;
    return !(md && md.pwd_set === true);                          // jamais choisi (ex. MJ existant)
  }
  function openGate(s) {
    pwdGate = true; gateSession = s; gateAt = Date.now();
    stoSet('sessionStorage', GATE_KEY, s.user.id);
    showSetPwd();
  }
  function closeGateState() {
    pwdGate = false; gateSession = null; fromLink = false;
    stoDel('sessionStorage', GATE_KEY);
  }
  function route(ev, s) {
    if (!s || !s.user) return;
    var byPwd = signedByPwd; signedByPwd = false; // revue M2 : lu une seule fois
    if (pwdGate) {
      gateSession = s;
      // Revue I1-B : mot de passe choisi et vérifié dans un autre onglet (pwd_at postérieur à l'ouverture).
      var md = s.user.user_metadata;
      if (ev === 'USER_UPDATED' && !gateBusy && md && md.pwd_set === true && typeof md.pwd_at === 'number' && md.pwd_at >= gateAt - 1000) {
        finishGate(s.user);
        toast('Mot de passe enregistré.');
      }
      return;
    }
    if (uid) {
      if (ev === 'PASSWORD_RECOVERY' && s.user.id === uid) { openGate(s); return; }
      onSession(s);
      return;
    }
    if (needsPwd(ev, s, byPwd)) { fromLink = false; openGate(s); return; }
    onSession(s);
  }
  function finishGate(user) {
    var s = gateSession;
    closeGateState();
    if (s && user) s.user = user;
    if (uid) hideLogin();
    else if (s) onSession(s);
  }
  // Session invalide pendant le choix : retour à l'écran de connexion.
  function gateExpired(text) {
    closeGateState();
    try { Promise.resolve(client.auth.signOut()).then(null, function () { /* ignoré */ }); } catch (e) { /* ignoré */ }
    openLogin('signin', text);
  }

  // =====================================================================
  // Espace compte : fenêtre « Mon compte » (MJ et joueuses), ouverte par
  // window.tylAccountOpen() (boutons posés par app.js seulement si cette
  // fonction existe). Tout texte passe par textContent (aucun balisage injecté) ;
  // aucun mot de passe n'est lu au-delà de l'appel, journalisé, stocké ni
  // affiché ; aucun jeton n'est lu. Voir tasks/spec-compte.md.
  // =====================================================================
  var ACCT_CSS =
    '#tyl-acct{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147482000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto;box-sizing:border-box}' +
    '#tyl-acct .rl-ovbox{max-width:560px;margin:0 auto}' +
    '#tyl-acct h2,#tyl-acct h3{margin:0}' +
    '#tyl-acct section{margin:0 0 16px;padding-top:12px;border-top:1px solid var(--line,#DAD5C1)}' +
    '#tyl-acct section.tyl-first{border-top:0;padding-top:0}' +
    '#tyl-acct dl{margin:8px 0 0;display:grid;grid-template-columns:max-content 1fr;gap:6px 14px}' +
    '#tyl-acct dt{font-weight:bold}' +
    '#tyl-acct dd{margin:0;word-break:break-word;min-width:0}' +
    '#tyl-acct dd.tyl-small{font-size:.75rem}' +
    '#tyl-acct p{margin:8px 0}' +
    '#tyl-acct label{display:block;margin:10px 0 4px;font-weight:bold}' +
    '#tyl-acct input[type=password],#tyl-acct input[type=email],#tyl-acct input[type=text]{display:block;width:100%;min-height:44px;padding:8px 10px;border:1px solid var(--line-strong,#808878);border-radius:8px;background:var(--surface,#FBFAF4);color:var(--ink,#1D2924);font-size:16px;box-sizing:border-box}' +
    '#tyl-acct input[aria-invalid=true]{border-color:var(--bad,#AE382C)}' +
    '#tyl-acct .tyl-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}' +
    '#tyl-acct .btn{min-height:44px}' +
    '#tyl-acct .tyl-msg{min-height:1.3em;margin:8px 0 0}' +
    '#tyl-acct .tyl-msg.err{color:var(--bad,#AE382C)}' +
    '#tyl-acct .tyl-msg.ok{color:var(--ok,#2F6A43)}' +
    '@media (max-width:520px){#tyl-acct dl{grid-template-columns:1fr}#tyl-acct dt{margin-top:6px}}';
  var MSG_NAME_BAD = 'Saisis un nom (40 caractères maximum).';
  var MSG_NAME_NO016 = 'Le changement de nom n\'est pas encore disponible sur le serveur.';
  var MSG_SAVE_FAIL = 'L\'enregistrement a échoué. Réessaie.';
  var MSG_REAUTH = 'Pour des raisons de sécurité, reconnecte-toi puis réessaie.';
  var MSG_NOPW = 'Le mot de passe actuel ne peut pas être affiché : il n\'est jamais conservé en clair, personne ne peut le relire (même pas le MJ). Si tu l\'as oublié, change-le ci-dessous ; l\'ancien n\'est pas demandé.';
  var MSG_FORGOT = 'Mot de passe oublié ? Sur l\'écran de connexion, choisis « Première connexion / Mot de passe oublié ? » : un lien magique t\'est envoyé par e-mail, puis tu choisis un nouveau mot de passe.';
  var NAME_MAX = 40;
  var acct = null;

  function fmtDate(iso) {
    try {
      if (!iso) return 'inconnue';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return 'inconnue';
      return d.toLocaleString('fr-FR');
    } catch (e) { return 'inconnue'; }
  }
  function cleanName(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, ''); }
  function shown(node, on) { if (on) node.removeAttribute('hidden'); else node.setAttribute('hidden', 'hidden'); }
  function focusFirst(list) { var i; for (i = 0; i < list.length; i++) { try { list[i].focus(); return; } catch (e) { /* ignoré */ } } }

  function emailMessage(err) {
    var c = errText(err);
    if (isRate(err)) return MSG_MANY;
    if (isNet(err)) return MSG_NET;
    if (err.status >= 500) return MSG_SAVE_FAIL;
    if (err.status === 401 || /session_not_found|session missing/i.test(c)) return 'Session expirée. Reconnecte-toi puis réessaie.';
    return 'Cette adresse ne peut pas être utilisée. Essaie-en une autre.'; // déjà prise, refusée : un seul texte
  }
  function passwordMessage(err) {
    var c = errText(err);
    if (/reauthentication_needed|reauthenticat/i.test(c)) return { t: MSG_REAUTH, relog: true };
    if (isRate(err)) return { t: MSG_MANY };
    if (isNet(err)) return { t: MSG_NET };
    if (/at least|too short|minimum/i.test(c)) return { t: 'Au moins ' + PW_MIN + ' caractères.' };
    if (isSamePwd(err)) return { t: 'Choisis un mot de passe différent de l\'ancien.' };
    if (/weak_password|weak|pwned|compromised|known/i.test(c) || err.status === 422) return { t: 'Ce mot de passe est trop faible ou connu. Choisis-en un autre.' };
    if (err.status === 401 || /session/i.test(c)) return { t: 'Session expirée. Reconnecte-toi puis réessaie.', relog: true };
    return { t: MSG_SAVE_FAIL };
  }

  function closeAccount() {
    if (!acct) return;
    var a = acct, i, h = a.hidden || [];
    acct = null;
    for (i = 0; i < h.length; i++) { try { h[i].removeAttribute('inert'); h[i].removeAttribute('aria-hidden'); } catch (e) { /* ignoré */ } }
    try { if (a.root.parentNode) a.root.parentNode.removeChild(a.root); } catch (e) { /* ignoré */ }
    try { if (a.style.parentNode) a.style.parentNode.removeChild(a.style); } catch (e) { /* ignoré */ }
    try { if (a.opener && a.opener.focus) a.opener.focus(); } catch (e) { /* ignoré */ }
  }

  function buildAccount() {
    var refs = {}, ctl = [];
    function E(tag, attrs, text) { var n = el(tag, attrs, text); if (attrs && attrs.id) refs[attrs.id] = n; if (tag === 'button' || tag === 'input') ctl.push(n); return n; }
    var style = E('style', { id: 'tyl-acct-css' });
    style.textContent = ACCT_CSS;
    var root = E('div', { id: 'tyl-acct', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acct-title' });
    var box = E('div', { 'class': 'rl-ovbox' });
    var head = E('div', { 'class': 'rl-ovhead' });
    var closeBtn = E('button', { type: 'button', 'class': 'btn', id: 'acct-close' }, 'Fermer');
    var busy = { pw: false, email: false, name: false, all: false };
    var self = { root: root, style: style, opener: null, hidden: [], closeBtn: closeBtn };
    var cur = { email: userEmail || '', name: '' };
    function say(id, text, kind) { var m = refs[id]; if (m) { m.textContent = text || ''; m.setAttribute('class', 'tyl-msg' + (kind ? ' ' + kind : '')); } return m; }
    function mark(input, on) { if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    function field(form, id, label, attrs) {
      var a = { id: id, name: id }, k;
      for (k in attrs) if (hasOwn(attrs, k)) a[k] = attrs[k];
      var l = E('label', { 'for': id }, label), inp = E('input', a);
      form.appendChild(l); form.appendChild(inp);
      return inp;
    }
    function row(dl, label, id, small) {
      var dt = E('dt', {}, label), dd = E('dd', { id: id, 'class': small ? 'tyl-small' : '' }, '…');
      dl.appendChild(dt); dl.appendChild(dd);
      return { dt: dt, dd: dd };
    }
    head.appendChild(E('h2', { id: 'acct-title' }, 'Mon compte')); head.appendChild(closeBtn);
    box.appendChild(head);

    // -- Informations (lecture)
    var s1 = E('section', { 'class': 'tyl-first', 'aria-label': 'Informations du compte' });
    var dl = E('dl');
    row(dl, 'E-mail', 'acct-email'); row(dl, 'Rôle', 'acct-role'); row(dl, 'Nom affiché', 'acct-name');
    row(dl, 'Personnage', 'acct-char'); row(dl, 'Dernière connexion', 'acct-last');
    var pend = row(dl, 'Changement d\'e-mail', 'acct-pending'); shown(pend.dt, false); shown(pend.dd, false);
    var uidRow = row(dl, 'Identifiant (support)', 'acct-uid', true); shown(uidRow.dt, false); shown(uidRow.dd, false);
    s1.appendChild(dl); box.appendChild(s1);

    // -- Mot de passe
    var s2 = E('section', { 'aria-labelledby': 'acct-h-pw' });
    s2.appendChild(E('h3', { id: 'acct-h-pw' }, 'Mot de passe'));
    s2.appendChild(E('p', { id: 'acct-nopw' }, MSG_NOPW));
    var fPw = E('form', { id: 'acct-pw-form', novalidate: 'novalidate' });
    var p1 = field(fPw, 'acct-pw1', 'Nouveau mot de passe', { type: 'password', autocomplete: 'new-password' });
    var p2 = field(fPw, 'acct-pw2', 'Nouveau mot de passe (encore une fois)', { type: 'password', autocomplete: 'new-password' });
    var pwActs = E('div', { 'class': 'tyl-actions' });
    var pwSave = E('button', { type: 'submit', id: 'acct-pw-save', 'class': 'btn' }, 'Changer mon mot de passe');
    var pwToggle = E('button', { type: 'button', 'class': 'btn', 'aria-pressed': 'false', 'aria-label': 'Afficher les mots de passe saisis' }, 'Afficher');
    pwToggle.addEventListener('click', function () {
      var on = pwToggle.getAttribute('aria-pressed') !== 'true';
      p1.setAttribute('type', on ? 'text' : 'password'); p2.setAttribute('type', on ? 'text' : 'password');
      pwToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    pwActs.appendChild(pwSave); pwActs.appendChild(pwToggle); fPw.appendChild(pwActs);
    var pwMsg = E('p', { id: 'acct-pw-msg', 'class': 'tyl-msg', role: 'status', 'aria-live': 'polite' });
    var pwRelog = E('div', { 'class': 'tyl-actions' });
    fPw.appendChild(pwMsg); fPw.appendChild(pwRelog);
    s2.appendChild(fPw); box.appendChild(s2);
    function wipePw() { p1.value = ''; p2.value = ''; p1.setAttribute('type', 'password'); p2.setAttribute('type', 'password'); pwToggle.setAttribute('aria-pressed', 'false'); }
    fPw.addEventListener('submit', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var a = p1.value, b = p2.value, bad;
      if (busy.pw) { wipePw(); return; }
      bad = checkNewPassword(a, b);
      if (bad) { say('acct-pw-msg', bad, 'err'); mark(p1, true); mark(p2, true); try { p1.focus(); } catch (e) { /* ignoré */ } return; }
      mark(p1, false); mark(p2, false);
      busy.pw = true; pwSave.disabled = true; say('acct-pw-msg', 'Enregistrement…', '');
      while (pwRelog.children.length) pwRelog.removeChild(pwRelog.children[0]);
      Promise.resolve().then(function () {
        return client.auth.updateUser({ password: a, data: { pwd_set: true, pwd_at: Date.now() } });
      }).then(function (r) {
        wipePw(); a = b = '';
        if (r && r.error) throw r.error;
        say('acct-pw-msg', 'Mot de passe changé.', 'ok');
      }).then(null, function (e) {
        wipePw(); a = b = '';
        noteErr('account.password', { code: e && e.code, status: e && e.status }); // jamais le message ni la valeur
        var m = passwordMessage(e || { status: 0 });
        say('acct-pw-msg', m.t, 'err');
        if (m.relog) {
          var rb = E('button', { type: 'button', 'class': 'btn' }, 'Me reconnecter');
          rb.addEventListener('click', function () { rb.disabled = true; if (window.tylSignOut) window.tylSignOut(); });
          pwRelog.appendChild(rb);
        }
      }).then(function () { busy.pw = false; pwSave.disabled = false; });
    });

    // -- E-mail
    var s3 = E('section', { 'aria-labelledby': 'acct-h-mail' });
    s3.appendChild(E('h3', { id: 'acct-h-mail' }, 'Adresse e-mail'));
    s3.appendChild(E('p', {}, 'Un lien de confirmation est envoyé à la nouvelle adresse. Tant que tu ne l\'as pas ouvert, l\'ancienne adresse reste valable.'));
    var fMail = E('form', { id: 'acct-email-form', novalidate: 'novalidate' });
    var mIn = field(fMail, 'acct-email-new', 'Nouvelle adresse e-mail', { type: 'email', autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false' });
    var mActs = E('div', { 'class': 'tyl-actions' });
    var mSave = E('button', { type: 'submit', id: 'acct-email-save', 'class': 'btn' }, 'Changer mon e-mail');
    mActs.appendChild(mSave); fMail.appendChild(mActs);
    fMail.appendChild(E('p', { id: 'acct-email-msg', 'class': 'tyl-msg', role: 'status', 'aria-live': 'polite' }));
    s3.appendChild(fMail); box.appendChild(s3);
    fMail.addEventListener('submit', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busy.email) return;
      var mail = normEmail(mIn.value);
      if (!EMAIL_RE.test(mail)) { say('acct-email-msg', 'Adresse e-mail invalide.', 'err'); mark(mIn, true); return; }
      if (mail === normEmail(cur.email)) { say('acct-email-msg', 'C\'est déjà l\'adresse de ce compte.', 'err'); mark(mIn, true); return; }
      mark(mIn, false);
      busy.email = true; mSave.disabled = true; say('acct-email-msg', 'Envoi…', '');
      Promise.resolve().then(function () {
        return client.auth.updateUser({ email: mail }, { emailRedirectTo: CFG.redirect });
      }).then(function (r) {
        if (r && r.error) throw r.error;
        var u = r && r.data && r.data.user;
        say('acct-email-msg', 'Un message de confirmation a été envoyé à ' + mail + '. Ouvre le lien de confirmation qu\'il contient, dans le même navigateur que celui-ci. ' +
          'Selon le réglage du serveur, un second lien arrive aussi sur ton ancienne adresse : il faut alors confirmer les deux. ' +
          'Tant que ce n\'est pas fait, ton ancienne adresse (' + cur.email + ') reste toujours valable : continue de te connecter avec elle.', 'ok');
        pend.dd.textContent = 'En attente de confirmation : ' + ((u && u.new_email) || mail);
        shown(pend.dt, true); shown(pend.dd, true);
        mIn.value = '';
      }).then(null, function (e) {
        noteErr('account.email', { code: e && e.code, status: e && e.status });
        say('acct-email-msg', emailMessage(e || { status: 0 }), 'err');
      }).then(function () { busy.email = false; mSave.disabled = false; });
    });

    // -- Nom affiché
    var s4 = E('section', { 'aria-labelledby': 'acct-h-name' });
    s4.appendChild(E('h3', { id: 'acct-h-name' }, 'Nom affiché'));
    s4.appendChild(E('p', {}, 'C\'est le nom que voient les autres à la table. Tu ne peux modifier que le tien.'));
    var fName = E('form', { id: 'acct-name-form', novalidate: 'novalidate' });
    var nIn = field(fName, 'acct-name-new', 'Nom affiché', { type: 'text', autocomplete: 'nickname', maxlength: String(NAME_MAX) });
    var nActs = E('div', { 'class': 'tyl-actions' });
    var nSave = E('button', { type: 'submit', id: 'acct-name-save', 'class': 'btn' }, 'Changer mon nom');
    nActs.appendChild(nSave); fName.appendChild(nActs);
    fName.appendChild(E('p', { id: 'acct-name-msg', 'class': 'tyl-msg', role: 'status', 'aria-live': 'polite' }));
    s4.appendChild(fName); box.appendChild(s4);
    fName.addEventListener('submit', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busy.name) return;
      var nm = cleanName(nIn.value), n = codePoints(nm);
      if (n < 1 || n > NAME_MAX) { say('acct-name-msg', MSG_NAME_BAD, 'err'); mark(nIn, true); return; }
      mark(nIn, false);
      busy.name = true; nSave.disabled = true; say('acct-name-msg', 'Enregistrement…', '');
      Promise.resolve().then(function () { return client.rpc('set_my_display_name', { p_name: nm }); }).then(function (r) {
        if (r && r.error) throw r.error;
        var saved = r && typeof r.data === 'string' && r.data ? r.data : nm;
        if (profile) profile.display_name = saved;
        if (profCache[uid] && profCache[uid].row) profCache[uid].row.display_name = saved;
        cur.name = saved;
        refs['acct-name'].textContent = saved;
        nIn.value = saved;
        say('acct-name-msg', 'Nom enregistré.', 'ok');
      }).then(null, function (e) {
        e = e || { status: 0 };
        noteErr('account.name', { code: e.code, status: e.status });
        var c = errText(e), t;
        if (e.code === 'PGRST202' || e.status === 404 || /could not find the function/i.test(c)) t = MSG_NAME_NO016;
        else if (e.code === '22023' || e.status === 400) t = MSG_NAME_BAD;
        else if (isRate(e)) t = MSG_MANY;
        else if (isNet(e)) t = MSG_NET;
        else t = MSG_SAVE_FAIL;
        say('acct-name-msg', t, 'err');
      }).then(function () { busy.name = false; nSave.disabled = false; });
    });

    // -- Session
    var s5 = E('section', { 'aria-labelledby': 'acct-h-sess' });
    s5.appendChild(E('h3', { id: 'acct-h-sess' }, 'Session'));
    var forgot = E('p', { id: 'acct-forgot' }, MSG_FORGOT); shown(forgot, false); s5.appendChild(forgot);
    var sActs = E('div', { 'class': 'tyl-actions' });
    var outBtn = E('button', { type: 'button', 'class': 'btn' }, 'Se déconnecter');
    var allBtn = E('button', { type: 'button', 'class': 'btn' }, 'Me déconnecter de tous les appareils');
    sActs.appendChild(outBtn); sActs.appendChild(allBtn); s5.appendChild(sActs);
    s5.appendChild(E('p', { id: 'acct-all-msg', 'class': 'tyl-msg', role: 'status', 'aria-live': 'polite' }));
    var confirmBox = E('div', { 'class': 'tyl-actions' });
    s5.appendChild(confirmBox); box.appendChild(s5);
    outBtn.addEventListener('click', function () { outBtn.disabled = true; if (window.tylSignOut) window.tylSignOut(); });
    function clearConfirm() { while (confirmBox.children.length) confirmBox.removeChild(confirmBox.children[0]); say('acct-all-msg', '', ''); allBtn.disabled = false; }
    allBtn.addEventListener('click', function () {
      if (busy.all || confirmBox.children.length) return;
      allBtn.disabled = true;
      say('acct-all-msg', 'Cela te déconnecte de tous tes appareils, y compris celui-ci : tu devras te reconnecter partout.', '');
      var yes = E('button', { type: 'button', 'class': 'btn' }, 'Oui, tout déconnecter');
      var no = E('button', { type: 'button', 'class': 'btn' }, 'Annuler');
      no.addEventListener('click', function () { if (!busy.all) { clearConfirm(); try { allBtn.focus(); } catch (e) { /* ignoré */ } } });
      yes.addEventListener('click', function () {
        if (busy.all) return;
        busy.all = true; yes.disabled = true; no.disabled = true; leaving = true;
        stoDel('sessionStorage', GATE_KEY);
        Promise.resolve().then(function () { return client.auth.signOut({ scope: 'global' }); }).then(function (r) {
          if (r && r.error) throw r.error;
          reload();
        }).then(null, function (e) {
          leaving = false; busy.all = false; no.disabled = false; yes.disabled = false;
          noteErr('account.signOutAll', { code: e && e.code, status: e && e.status });
          say('acct-all-msg', isNet(e || {}) ? MSG_NET : 'La déconnexion de tous les appareils a échoué. Réessaie.', 'err');
        });
      });
      confirmBox.appendChild(yes); confirmBox.appendChild(no);
      try { no.focus(); } catch (e) { /* ignoré */ }
    });

    root.appendChild(box);
    closeBtn.addEventListener('click', closeAccount);
    root.addEventListener('click', function (ev) { if (ev && ev.target === root) closeAccount(); });
    root.addEventListener('keydown', function (ev) {
      if (!ev) return;
      if (ev.key === 'Escape' || ev.key === 'Esc') { if (ev.preventDefault) ev.preventDefault(); closeAccount(); return; }
      if (ev.key !== 'Tab') return;
      var f = [], active = document.activeElement, k;
      for (k = 0; k < ctl.length; k++) if (!ctl[k].disabled && ctl[k].getAttribute('hidden') == null && ctl[k].getAttribute('type') !== 'hidden') f.push(ctl[k]);
      if (!f.length) return;
      if (ev.shiftKey && (active === f[0] || !active)) { if (ev.preventDefault) ev.preventDefault(); try { f[f.length - 1].focus(); } catch (e) { /* ignoré */ } }
      else if (!ev.shiftKey && active === f[f.length - 1]) { if (ev.preventDefault) ev.preventDefault(); try { f[0].focus(); } catch (e) { /* ignoré */ } }
    });

    // -- Données (lecture seule), remplies au fur et à mesure
    self.fill = function () {
      function put(id, text) { var n = refs[id]; if (n) n.textContent = text; }
      Promise.resolve().then(function () { return client.auth.getSession(); }).then(function (r) {
        var u = r && r.data && r.data.session && r.data.session.user;
        cur.email = (u && u.email) || userEmail || '';
        put('acct-email', cur.email || 'inconnu');
        put('acct-last', fmtDate(u && u.last_sign_in_at));
        if (u && u.new_email) { put('acct-pending', 'En attente de confirmation : ' + u.new_email); shown(pend.dt, true); shown(pend.dd, true); }
      }, function () { put('acct-email', userEmail || 'inconnu'); put('acct-last', 'inconnue'); });
      profileRetry().then(function (p) {
        var mj = isMj();
        cur.name = p ? String(p.display_name || '') : '';
        put('acct-role', p ? (mj ? 'MJ' : 'Joueuse') : 'inconnu');
        put('acct-name', cur.name || '(aucun)');
        nIn.value = cur.name;
        shown(forgot, mj);
        if (mj) {
          put('acct-uid', uid || ''); shown(uidRow.dt, true); shown(uidRow.dd, true);
          put('acct-char', 'Tous (MJ)');
          return null;
        }
        return selectOne('assign', uid).then(function (row) {
          var d = row ? rowJson(row) : null, pid = d ? (JSON.parse(d).pid || '') : '';
          if (!pid) { put('acct-char', 'Aucun personnage attribué'); return null; }
          return selectOne('library', String(pid)).then(function (lr) {
            var ld = lr ? rowJson(lr) : null, nm = ld ? JSON.parse(ld).name : '';
            put('acct-char', nm ? String(nm) : String(pid));
          });
        });
      }).then(null, function (e) { noteErr('account.read', e); put('acct-char', 'Indisponible'); });
    };
    box.setAttribute('aria-live', 'off');
    return self;
  }

  window.tylAccountOpen = function () {
    if (!uid || pwdGate || !document || !document.body) return false;
    if (acct) { focusFirst([acct.closeBtn]); return true; }
    acct = buildAccount();
    try { acct.opener = document.activeElement || null; } catch (e) { acct.opener = null; }
    (document.head || document.body).appendChild(acct.style);
    document.body.appendChild(acct.root);
    acct.hidden = hideOthers(acct.root);
    acct.fill();
    focusFirst([acct.closeBtn]);
    return true;
  };

  // =====================================================================
  // DB : documents « collection/id » dans public.docs
  // =====================================================================
  var SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;
  function parsePath(path, wantDoc) {
    if (typeof path !== 'string') throw new TypeError('db : le chemin doit être une chaîne');
    var segs = path.split('/'), i;
    if (segs.length > 16 || utf8Len(path) > 1000) throw new TypeError('db : chemin trop long (' + segs.length + ' segments)');
    for (i = 0; i < segs.length; i++) {
      if (!segs[i] || !SEG_RE.test(segs[i]) || segs[i] === '.' || segs[i] === '..' || utf8Len(segs[i]) > 200) {
        throw new TypeError('db : segment invalide « ' + segs[i] + ' » dans « ' + path + ' »');
      }
    }
    if ((segs.length % 2 === 0) !== wantDoc) {
      throw new TypeError('db : « ' + path + ' » a ' + segs.length + ' segments (' + (wantDoc ? 'pair attendu pour un document' : 'impair attendu pour une collection') + ')');
    }
    return segs;
  }

  // ---------------- Ordre des versions et écho des écritures locales -------
  // Chaque ligne de public.docs porte une version serveur « rev » (migration
  // 012 : séquence globale strictement croissante, posée par le trigger
  // docs_touch APRÈS verrouillage de la ligne, donc croissante dans l'ordre des
  // validations pour un même document). Le cache garde, par document, la plus
  // haute rev appliquée (C.rev) : tout événement Realtime ou toute relecture
  // dont la rev est inférieure ou égale est ignoré (revue C1, I1, I2). Une
  // suppression garde la rev en « pierre tombale » : un vieil UPDATE arrivé
  // après ne ressuscite pas le document.
  // hasPendingWrites : nos écritures sont appliquées au cache dès la réponse
  // du serveur (avec leur rev) et livrées avec hasPendingWrites = true ; leur
  // écho Realtime, de même rev, est alors ignoré. Si l'écho arrive AVANT la
  // réponse HTTP, on le reconnaît à son contenu (liste « recent » des
  // contenus attendus, 10 s) et il est livré avec hasPendingWrites = true.
  // Un autre appareil du même compte n'a pas cette entrée : false.
  // Sans colonne rev (migration 012 absente) : repli sur le seul contenu,
  // comme avant (moins robuste, signalé dans tylDebug().rev = false).
  // Pas de compensation de latence (revue M3) : l'écriture locale n'est
  // livrée qu'après la réponse du serveur, jamais avant.
  var ECHO_TTL = 10000, ECHO_MAX = 200;
  var recent = [];
  var HAS_REV = true; // passe à false si la colonne rev n'existe pas (42703)
  function cols3() { return HAS_REV ? 'id,data,rev' : 'id,data'; }
  function noRevErr(r) {
    var e = r && r.error;
    return !!(HAS_REV && e && (String(e.code) === '42703' || /column .*rev/i.test(String(e.message || ''))));
  }
  function remember(col, id, json) {
    recent.push({ col: col, id: id, json: json, t: Date.now() });
    while (recent.length > ECHO_MAX) recent.shift();
  }
  function matchEcho(col, id, json) {
    var now = Date.now(), i, r;
    for (i = recent.length - 1; i >= 0; i--) {
      r = recent[i];
      if (now - r.t > ECHO_TTL) continue;
      if (r.col === col && r.id === id && r.json === json) { recent.splice(i, 1); stats.echoes++; return true; }
    }
    return false;
  }
  function revOf(row) {
    var v = row && row.rev;
    if (typeof v === 'string' && /^\d+$/.test(v)) v = parseInt(v, 10);
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  // ---------------- Cache et canaux par collection ----------------------
  // cols[name] = { name, docs: {id: json canonique}, rev: {id: rev}, at: {id: tick},
  //   loaded: {id: true}, full, subs: [], channel, status, reading, again, timers }
  var cols = {};
  var POLL_MS = 30000, INIT_WAIT = 1500;
  var tick = 0; // compteur d'applications au cache (relectures concurrentes)

  function getCol(name) {
    var C = cols[name];
    if (C) return C;
    C = cols[name] = {
      name: name, docs: {}, rev: {}, at: {}, loaded: {}, full: false, subs: [], channel: null, status: 'idle',
      reading: false, again: false, initTimer: null, pollTimer: null, retryTimer: null, retryMs: 2000, dead: false
    };
    openChannel(C);
    return C;
  }

  // Canal privé (revue I3, point G) : avec « Allow public access » désactivé,
  // Realtime refuse tout canal public (erreur PrivateOnly) ; un canal privé
  // exige au moins un droit de lecture sur realtime.messages pour son sujet
  // (migration 011 : sujets tyl-docs-*, comptes avec profil). Les données
  // restent filtrées par la RLS de public.docs.
  var DENIED_RE = /unauthori[sz]ed|permission|PrivateOnly/i;
  function openChannel(C) {
    var ch;
    var onEvt = function (p) { try { onChange(C, p); } catch (e) { noteErr('realtime.' + C.name, e); } };
    try {
      ch = client.channel('tyl-docs-' + C.name, { config: { private: true } });
      // INSERT/UPDATE filtrés côté serveur. DELETE : Realtime ne sait pas
      // filtrer les suppressions (seule la clé arrive, RLS) : abonnement sans
      // filtre et tri côté client sur old.collection.
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'docs', filter: 'collection=eq.' + C.name }, onEvt)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'docs', filter: 'collection=eq.' + C.name }, onEvt)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'docs' }, onEvt);
      C.channel = ch;
      authSync().then(function () {
        if (C.dead || C.channel !== ch) return;
        try { ch.subscribe(function (status, err) { if (C.channel === ch) onStatus(C, status, err); }); } catch (e) { noteErr('channel.' + C.name, e); }
      });
    } catch (e) { noteErr('channel.' + C.name, e); C.channel = null; }
    // Première lecture : dès que le canal est prêt (pour ne rien rater entre
    // la lecture et l'abonnement), ou au bout de 1,5 s s'il tarde.
    C.initTimer = later(function () { C.initTimer = null; refresh(C); }, INIT_WAIT);
    // Repli tant que le canal n'est pas prêt : relecture toutes les 30 s
    // (lecture seule, arrêtée dès que Realtime répond).
    startPoll(C);
  }
  function startPoll(C) {
    if (C.pollTimer || C.dead) return;
    C.pollTimer = setInterval(function () { refresh(C); }, POLL_MS);
  }
  function stopPoll(C) { if (C.pollTimer) { clearInterval(C.pollTimer); C.pollTimer = null; } }

  function onStatus(C, status, err) {
    if (C.dead || C.status === 'denied') return;
    C.status = String(status || '');
    if (status === 'SUBSCRIBED') {
      stopPoll(C);
      if (C.initTimer) { clearTimeout(C.initTimer); C.initTimer = null; }
      refresh(C); // première lecture, ou relecture après reconnexion
    } else {
      if (err) noteErr('channel.' + C.name + '.' + status, err);
      if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && err && DENIED_RE.test(String(err.message || err))) {
        // Refus d'autorisation : inutile de réessayer (realtime-js le ferait
        // sans fin). Relecture périodique seulement, jusqu'au rechargement.
        C.status = 'denied';
        var c = C.channel; C.channel = null;
        try { if (c) Promise.resolve(client.removeChannel(c)).then(null, function () {}); } catch (e) { /* ignoré */ }
      }
      startPoll(C); // realtime-js retente seul la connexion (sauf refus)
    }
  }

  function closeCol(C) {
    C.dead = true;
    stopPoll(C);
    if (C.initTimer) clearTimeout(C.initTimer);
    if (C.retryTimer) clearTimeout(C.retryTimer);
    try { if (C.channel) client.removeChannel(C.channel); } catch (e) { /* ignoré */ }
    if (cols[C.name] === C) delete cols[C.name];
  }

  function hasColSubs(C) { for (var i = 0; i < C.subs.length; i++) if (C.subs[i].kind === 'col') return true; return false; }

  // Lecture avec repli si la colonne rev n'existe pas encore.
  function runSel(fn, op) {
    return run(function () { return fn(cols3()); }, op).then(null, function (e) {
      if (noRevErr({ error: e.cause })) { HAS_REV = false; return run(function () { return fn(cols3()); }, op); }
      throw e;
    });
  }
  // Lecture paginée d'une collection entière (PostgREST plafonne à 1000 lignes).
  function selectAll(name) {
    var rows = [], PAGE = 1000;
    function page(from) {
      stats.reads++;
      return runSel(function (c) {
        return client.from('docs').select(c).eq('collection', name).order('id', { ascending: true }).range(from, from + PAGE - 1);
      }, 'get').then(function (r) {
        var d = r.data || [];
        rows = rows.concat(d);
        return d.length < PAGE ? rows : page(from + PAGE);
      });
    }
    return page(0);
  }
  function selectOne(name, id) {
    stats.reads++;
    return runSel(function (c) {
      return client.from('docs').select(c).eq('collection', name).eq('id', id).maybeSingle();
    }, 'get').then(function (r) { return r.data || null; });
  }
  function rowJson(row) {
    var d = row && row.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
    return isPlainObject(d) ? canon(d) : null;
  }

  // Application au cache, ordonnée par rev. Renvoie true si le contenu a changé.
  // rev null (suppression, ou serveur sans colonne rev) : appliqué tel quel.
  function accept(C, id, json, rev) {
    var cur = hasOwn(C.rev, id) ? C.rev[id] : null;
    if (rev !== null && cur !== null && rev <= cur) return null; // ancien ou déjà vu
    if (rev !== null) C.rev[id] = rev;
    C.at[id] = ++tick;
    C.loaded[id] = true;
    return setEntry(C, id, json);
  }

  // Relecture serveur (premier snapshot, reconnexion, repli). Une seule à la fois.
  // Une relecture partie AVANT une écriture locale ou un événement ne doit pas
  // ramener l'état antérieur (revue I2) : rev plus ancienne => ignorée ; sans
  // rev, tout doc touché depuis le départ de la lecture est laissé tel quel.
  function refresh(C) {
    if (C.dead || !C.subs.length) return;
    if (C.reading) { C.again = true; return; }
    C.reading = true;
    var wantFull = hasColSubs(C), p, ids = [], seen = {}, i, start = tick;
    if (wantFull) p = selectAll(C.name);
    else {
      for (i = 0; i < C.subs.length; i++) if (!seen[C.subs[i].id]) { seen[C.subs[i].id] = 1; ids.push(C.subs[i].id); }
      p = Promise.all(ids.map(function (id) {
        return selectOne(C.name, id).then(function (row) { return { id: id, row: row }; });
      }));
    }
    p.then(function (res) {
      if (C.dead) return;
      var changed = [], pend = false, got = {};
      var take = function (id, json, rev) {
        var fresh = (C.at[id] || 0) > start || !!queues[C.name + '\u0000' + id];
        if (fresh && (rev === null || json === null)) { C.loaded[id] = true; return; }
        var mine = json !== null && matchEcho(C.name, id, json);
        if (accept(C, id, json, rev)) { changed.push(id); if (mine) pend = true; }
        C.loaded[id] = true;
      };
      if (wantFull) {
        res.forEach(function (row) { got[row.id] = 1; take(row.id, rowJson(row), revOf(row)); });
        Object.keys(C.docs).forEach(function (id) { if (!got[id]) take(id, null, null); });
        C.full = true;
      } else {
        res.forEach(function (x) { take(x.id, x.row ? rowJson(x.row) : null, x.row ? revOf(x.row) : null); });
      }
      C.retryMs = 2000;
      notify(C, changed, pend);
      deliverInitial(C);
    }, function (e) {
      noteErr('refresh.' + C.name, e);
      // Réseau : nouvelle tentative (2 s, 4 s… 30 s). Jamais d'erreur
      // transmise aux abonnés (la plateforme gère « unavailable » en interne).
      if (!C.retryTimer && !C.dead) {
        C.retryTimer = later(function () { C.retryTimer = null; refresh(C); }, C.retryMs);
        C.retryMs = Math.min(30000, C.retryMs * 2);
      }
    }).then(function () {
      C.reading = false;
      if (C.again) { C.again = false; refresh(C); }
    });
  }

  function setEntry(C, id, json) {
    var cur = hasOwn(C.docs, id) ? C.docs[id] : null;
    if (cur === json) return false;
    if (json === null) delete C.docs[id]; else C.docs[id] = json;
    return true;
  }

  // Événement Realtime postgres_changes.
  function onChange(C, p) {
    if (C.dead || !p) return;
    stats.events++;
    var t = p.eventType || p.type, row;
    if (t === 'DELETE') {
      row = p.old || p.old_record || {};
      if (row.collection !== C.name || row.id == null) return;
      var did = String(row.id), pd = matchEcho(C.name, did, null);
      if (accept(C, did, null, null)) notify(C, [did], pd);
      return;
    }
    row = p['new'] || p.record || {};
    if (row.collection !== C.name || row.id == null) return;
    var id = String(row.id), json = rowJson(row), rev = revOf(row);
    if (rev !== null && hasOwn(C.rev, id) && rev <= C.rev[id]) { stats.stale = (stats.stale || 0) + 1; return; }
    if (json === null || (p.errors && p.errors.length)) {
      // Charge utile tronquée (document trop gros pour Realtime) : relecture.
      selectOne(C.name, id).then(function (r) {
        var j = r ? rowJson(r) : null, pend = j !== null && matchEcho(C.name, id, j);
        if (accept(C, id, j, r ? revOf(r) : null)) notify(C, [id], pend);
        C.loaded[id] = true;
        deliverInitial(C);
      }, function (e) { noteErr('refetch.' + C.name, e); });
      return;
    }
    var pending = matchEcho(C.name, id, json);
    if (accept(C, id, json, rev)) notify(C, [id], pending);
    deliverInitial(C);
  }

  // Écriture confirmée par le serveur : appliquée tout de suite au cache
  // (hasPendingWrites = true), même si Realtime est coupé. Si l'écho est déjà
  // arrivé (même rev), rien n'est relivré ; sinon l'entrée d'écho devient
  // inutile (l'écho, de rev égale, sera ignoré) et est retirée.
  // pending = false quand le résultat contient autre chose que ce que cet
  // onglet attendait (update fusionné avec une écriture d'ailleurs) : les
  // handlers qui ignorent nos échos doivent quand même le voir.
  function localApply(col, id, json, rev, pending) {
    if (rev !== null && rev !== undefined) matchEcho(col, id, json);
    var C = cols[col];
    if (!C || C.dead) return;
    if (accept(C, id, json, rev === undefined ? null : rev)) notify(C, [id], pending !== false);
    deliverInitial(C);
  }

  // ---------------- Snapshots ------------------------------------------
  function meta(pending) { return Object.freeze({ fromCache: false, hasPendingWrites: !!pending }); }
  function docSnap(id, json, pending) {
    return Object.freeze({
      id: id,
      exists: json !== null && json !== undefined,
      // Copie neuve à chaque appel : l'appelant peut la modifier sans risque.
      data: function () { return json === null || json === undefined ? undefined : JSON.parse(json); },
      metadata: meta(pending)
    });
  }
  function querySnap(entries, pending, prev) {
    // entries : [{id, json}] triés par id ; prev : {id: json} de la livraison précédente
    var docs = entries.map(function (e) { return docSnap(e.id, e.json, pending); });
    var changes = null;
    var snap = {
      docs: docs, size: docs.length, empty: docs.length === 0, metadata: meta(pending),
      docChanges: function () {
        if (changes) return changes;
        changes = [];
        var now = {}, oldIdx = {}, k;
        if (prev) Object.keys(prev).sort().forEach(function (id, n) { oldIdx[id] = n; });
        docs.forEach(function (d, n) {
          now[d.id] = 1;
          if (!prev || !hasOwn(prev, d.id)) changes.push({ type: 'added', doc: d, oldIndex: -1, newIndex: n });
          else if (prev[d.id] !== entries[n].json) changes.push({ type: 'modified', doc: d, oldIndex: oldIdx[d.id], newIndex: n });
        });
        if (prev) for (k in prev) if (hasOwn(prev, k) && !now[k]) changes.push({ type: 'removed', doc: docSnap(k, prev[k], pending), oldIndex: oldIdx[k], newIndex: -1 });
        return changes;
      }
    };
    return Object.freeze(snap);
  }
  function sortedEntries(map) {
    return Object.keys(map).sort().map(function (id) { return { id: id, json: map[id] }; });
  }

  function deliver(sub, C, pending) {
    if (!sub.active) return;
    var snap;
    if (sub.kind === 'doc') {
      snap = docSnap(sub.id, hasOwn(C.docs, sub.id) ? C.docs[sub.id] : null, pending);
    } else {
      var es = sortedEntries(C.docs), prev = sub.prev, cur = {};
      es.forEach(function (e) { cur[e.id] = e.json; });
      sub.prev = cur;
      snap = querySnap(es, pending, prev);
    }
    sub.delivered = true;
    stats.deliveries++;
    try { sub.next(snap); } catch (e) {
      noteErr('onSnapshot.callback', e);
      try { if (window.console) window.console.error(e); } catch (x) { /* ignoré */ }
    }
  }
  function notify(C, ids, pending) {
    if (!ids.length) return;
    var set = {}, subs = C.subs.slice(), i;
    for (i = 0; i < ids.length; i++) set[ids[i]] = 1;
    for (i = 0; i < subs.length; i++) {
      var s = subs[i];
      if (!s.active || !s.delivered) continue;
      if (s.kind === 'doc' ? set[s.id] : C.full) deliver(s, C, pending);
    }
  }
  function deliverInitial(C) {
    var subs = C.subs.slice(), i;
    for (i = 0; i < subs.length; i++) {
      var s = subs[i];
      if (!s.active || s.delivered) continue;
      if (s.kind === 'col' ? C.full : (C.full || C.loaded[s.id])) deliver(s, C, false);
    }
  }

  function subscribe(kind, colName, id, next, error) {
    if (typeof next !== 'function') throw new TypeError('onSnapshot : next doit être une fonction');
    var C = getCol(colName);
    var sub = { kind: kind, id: id, next: next, error: error, active: true, delivered: false, prev: null };
    C.subs.push(sub);
    // Déjà en cache : premier snapshot tout de suite (asynchrone).
    // Sinon : lecture (immédiate si le canal est prêt, sinon à l'ouverture).
    // Canal jamais prêt (refusé, WebSocket bloquée) et première lecture déjà
    // faite : lecture immédiate, sans attendre la relecture de 30 s (revue M2).
    if (kind === 'col' ? C.full : (C.full || C.loaded[id])) later(function () { deliverInitial(C); });
    else if (C.status === 'SUBSCRIBED' || !C.initTimer) refresh(C);
    return function unsubscribe() {
      if (!sub.active) return;
      sub.active = false;
      var i = C.subs.indexOf(sub);
      if (i >= 0) C.subs.splice(i, 1);
      if (!C.subs.length) closeCol(C);
    };
  }

  // ---------------- Écritures : une à la fois par document ----------------
  var queues = {};
  function enqueue(key, fn) {
    var prev = queues[key] || Promise.resolve();
    var p = prev.then(fn, fn);
    var tail = p.then(function () {}, function () {});
    queues[key] = tail;
    tail.then(function () { if (queues[key] === tail) delete queues[key]; });
    return p;
  }

  function bodyOf(data, op) {
    if (!isPlainObject(data)) return { err: dbErr('invalid_argument', op + ' : le document doit être un objet JSON') };
    try { return { body: plain(data) }; } catch (e) { return { err: dbErr('invalid_argument', op + ' : contenu non sérialisable') }; }
  }

  // Session expirée (revue I6) : écriture refusée en « unavailable »,
  // l'appli la retente ; elle passera après reconnexion du même compte.
  function offline(op) {
    if (!signedOut) return null;
    var e = dbErr('unavailable', op + ' : session expirée, reconnexion nécessaire');
    noteErr('db.' + op, e);
    return Promise.reject(e);
  }
  // Audit E2 : une action porte l'uid authentifié de son autrice, jamais une
  // valeur choisie par la page (le serveur l'impose aussi : migration 013).
  function stampFrom(col, body) { if (col === 'actions' && uid) body.from = uid; return body; }

  function doSet(col, id, data) {
    var b = bodyOf(data, 'set');
    if (b.err) { noteErr('db.set', b.err); return Promise.reject(b.err); }
    var off = offline('set'); if (off) return off;
    stampFrom(col, b.body);
    return enqueue(col + '\u0000' + id, function () {
      var json = canon(b.body);
      remember(col, id, json);
      stats.writes++;
      var up = function (withRev) {
        return run(function () {
          var q = client.from('docs').upsert({ collection: col, id: id, data: b.body }, { onConflict: 'collection,id' });
          return withRev ? q.select('rev') : q;
        }, 'set');
      };
      return up(HAS_REV).then(null, function (e) {
        if (noRevErr({ error: e.cause })) { HAS_REV = false; return up(false); }
        throw e;
      }).then(function (r) {
        var d = r && r.data;
        if (d && Object.prototype.toString.call(d) === '[object Array]') d = d[0];
        localApply(col, id, json, revOf(d));
      });
    });
  }

  function doUpdate(col, id, data) {
    var b = bodyOf(data, 'update');
    if (b.err) { noteErr('db.update', b.err); return Promise.reject(b.err); }
    var off = offline('update'); if (off) return off;
    if (col === 'actions' && hasOwn(b.body, 'from')) stampFrom(col, b.body);
    return enqueue(col + '\u0000' + id, function () {
      var C = cols[col], pre = null;
      if (C && hasOwn(C.docs, id)) {
        pre = canon(deepMerge(JSON.parse(C.docs[id]), plain(b.body)));
        remember(col, id, pre);
      }
      stats.writes++;
      return run(function () {
        return client.rpc('doc_update', { p_collection: col, p_id: id, p_patch: b.body });
      }, 'update').then(function (r) {
        var row = r.data, json;
        if (row && Object.prototype.toString.call(row) === '[object Array]') row = row[0];
        json = rowJson(row);
        if (json === null) return; // forme de retour inattendue : Realtime suivra
        if (json !== pre) remember(col, id, json);
        localApply(col, id, json, revOf(row), pre === null || json === pre);
      });
    });
  }

  // delete : si 0 ligne supprimée, on regarde si le doc existe (et nous est
  // visible). Oui => la RLS a refusé => invalid_argument. Non => idempotent
  // (comme la plateforme : un doc absent ou invisible se supprime sans erreur).
  function doDelete(col, id) {
    var off = offline('delete'); if (off) return off;
    return enqueue(col + '\u0000' + id, function () {
      remember(col, id, null);
      stats.writes++;
      return run(function () {
        return client.from('docs').delete({ count: 'exact' }).eq('collection', col).eq('id', id);
      }, 'delete').then(function (r) {
        if (r.count !== 0) { localApply(col, id, null); return; }
        return selectOne(col, id).then(function (row) {
          if (row) {
            var e = dbErr('invalid_argument', 'delete : écriture refusée (0 ligne supprimée)');
            noteErr('db.delete', e);
            throw e;
          }
          localApply(col, id, null);
        });
      });
    });
  }

  // ---------------- Références ----------------------------------------
  function docRef(segs) {
    var path = segs.join('/'), id = segs[segs.length - 1], col = segs.slice(0, -1).join('/');
    return Object.freeze({
      id: id,
      path: path,
      get: function () {
        return selectOne(col, id).then(function (row) { return docSnap(id, row ? rowJson(row) : null, false); });
      },
      set: function (data) { return doSet(col, id, data); },
      update: function (data) { return doUpdate(col, id, data); },
      'delete': function () { return doDelete(col, id); },
      acquire: function () { return Promise.reject(dbErr('capability_removed', 'acquire non pris en charge')); },
      onSnapshot: function (next, error) { return subscribe('doc', col, id, next, error); },
      collection: function (sub) { return colRef(parsePath(path + '/' + sub, false)); }
    });
  }
  function unsupportedQuery(name) {
    return function () { throw new TypeError('db : ' + name + '() non pris en charge par le shim'); };
  }
  function colRef(segs) {
    var path = segs.join('/');
    return Object.freeze({
      path: path,
      id: segs[segs.length - 1],
      doc: function (id) {
        if (id === undefined) id = randomId(20);
        return docRef(parsePath(path + '/' + id, true));
      },
      add: function (data) {
        var ref = docRef(parsePath(path + '/' + randomId(20), true));
        return ref.set(data).then(function () { return ref; });
      },
      get: function () {
        return selectAll(path).then(function (rows) {
          var es = rows.map(function (r) { return { id: r.id, json: rowJson(r) }; })
            .filter(function (e) { return e.json !== null; })
            .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
          return querySnap(es, false, null);
        });
      },
      onSnapshot: function (next, error) { return subscribe('col', path, null, next, error); },
      where: unsupportedQuery('where'),
      orderBy: unsupportedQuery('orderBy'),
      limit: unsupportedQuery('limit')
    });
  }

  var dbNs = Object.freeze({
    doc: function (path) { return docRef(parsePath(path, true)); },
    collection: function (path) { return colRef(parsePath(path, false)); }
  });

  // =====================================================================
  // USER
  // =====================================================================
  var PALETTE = ['#3c6b4f', '#8a5a2b', '#4a5d8a', '#8a3c4f', '#6b5b3c', '#3c6b6b', '#6b3c6b', '#5b6b3c'];
  function colorOf(id) {
    var h = 0, s = String(id || ''), i;
    for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }
  function avatarOf(id, name) {
    var ini = String(name || '').replace(/^\s+/, '').split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
    ini = ini.replace(/[<>&"']/g, '');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="' + colorOf(id) +
      '"/><text x="32" y="41" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">' + ini + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function mkProfile(id, row) {
    var name = row ? String(row.display_name || '') : '';
    return Object.freeze({
      id: id, name: name, avatarUrl: avatarOf(id, name), color: colorOf(id),
      email: row && row.email ? String(row.email) : null, isMe: id === uid, guest: false
    });
  }
  var profCache = {}; // id -> {row|null, at}
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var PROF_MISS_TTL = 60000;

  function profiles(ids) {
    var list = typeof ids === 'string' ? [ids] : (ids && ids.length ? Array.prototype.slice.call(ids) : []);
    var uniq = [], seen = {}, need = [], now = Date.now();
    list.forEach(function (i) { i = String(i); if (!seen[i]) { seen[i] = 1; uniq.push(i); } });
    uniq.forEach(function (i) {
      var c = profCache[i];
      if (UUID_RE.test(i) && (!c || (!c.row && now - c.at > PROF_MISS_TTL))) need.push(i);
    });
    var build = function () {
      var out = {};
      uniq.forEach(function (i) { out[i] = mkProfile(i, profCache[i] ? profCache[i].row : null); });
      return out;
    };
    if (!need.length) return Promise.resolve(build());
    return run(function () {
      return client.from('profiles').select('id,display_name,email').in('id', need);
    }, 'profiles').then(function (r) {
      var t = Date.now();
      need.forEach(function (i) { profCache[i] = { row: null, at: t }; });
      (r.data || []).forEach(function (row) { profCache[row.id] = { row: row, at: t }; });
      return build();
    }, function () { return build(); });
  }

  function me() {
    return profileRetry().then(function (p) {
      var name = p ? String(p.display_name || '') : '';
      return Object.freeze({
        id: uid, name: name, avatarUrl: avatarOf(uid, name), color: colorOf(uid),
        email: (p && p.email) || userEmail || null, isOwner: isMj(), canEdit: isMj()
      });
    });
  }

  var userNs = Object.freeze({
    isOwner: function () { return profileRetry().then(function () { return isMj(); }); },
    canEdit: function () { return profileRetry().then(function () { return isMj(); }); },
    // MJ : tout. Joueuse : écriture partielle (RLS) => null pour data.write
    // (« laisse une écriture refusée trancher »), comme le prévoit user.d.ts.
    can: function (name) {
      return profileRetry().then(function () {
        if (isMj()) return name === 'data.write' || name === 'files.write' || name === 'assets.write';
        if (!profile) return false;
        return name === 'data.write' ? null : false;
      });
    },
    id: function () { return Promise.resolve(uid); },
    me: me,
    profiles: profiles,
    name: function () { return me().then(function (m) { return m.name; }); },
    avatarUrl: function () { return me().then(function (m) { return m.avatarUrl; }); },
    email: function () { return me().then(function (m) { return m.email; }); },
    search: function () { return Promise.resolve([]); }
  });

  // =====================================================================
  // ROOM : canal Broadcast 'tyl-room'
  // =====================================================================
  var roomNs = null, roomState = { up: false, status: 'idle', sent: 0, received: 0 };
  var TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;

  function roomErr(code, message) { var e = dbErr(code, message); return e; }

  // Canal privé (Realtime Authorization, migration 008) : jeton transmis par
  // authSync() avant la jonction et à chaque TOKEN_REFRESHED.
  // Refus d'autorisation (policy realtime.messages) : inutile de réessayer.
  var ROOM_DENIED_RE = DENIED_RE;
  var ROOM_MAX_ERRORS = 5; // erreurs consécutives avant de suspendre le canal
  var ROOM_RETRY = [30000, 60000, 300000]; // reprise après suspension (revue I4)

  // `by` est posé par le shim de l'émettrice (son uid de session) mais n'est
  // PAS authentifié par Realtime : une joueuse peut le falsifier. Il ne sert
  // donc qu'à l'affichage et au filtrage d'échos ; aucune décision de
  // sécurité n'en dépend (les actions passent par la base : audit E2).
  function makeRoom() {
    var peer = randomId(16).toLowerCase();
    var listeners = {}; // topic -> [{h, active}]
    var connL = [];
    var ch = null;

    function dispatch(topic, msg) {
      var ls = (listeners[topic] || []).slice(), i;
      for (i = 0; i < ls.length; i++) {
        if (!ls[i].active) continue;
        try { ls[i].h(msg); } catch (e) { noteErr('room.on.' + topic, e); }
      }
    }
    function setUp(up) {
      if (up === roomState.up) return;
      roomState.up = up;
      connL.slice().forEach(function (l) { if (l.active) { try { l.h(up); } catch (e) { noteErr('room.onConnection', e); } } });
    }
    var nErr = 0, stopped = false, denied = false, retryN = 0, retryTimer = null;
    // Suspension du canal : refus (définitif) ou trop d'erreurs transitoires
    // (reprise programmée : 30 s, 60 s puis 5 min, ou dès le retour du réseau
    // ou de l'onglet). L'appli continue sans temps réel pendant ce temps ;
    // removeChannel coupe les nouvelles tentatives de realtime-js.
    function stopRoom(status) {
      stopped = true;
      roomState.status = status;
      setUp(false);
      var c = ch; ch = null;
      if (c) {
        try { Promise.resolve(client.removeChannel(c)).then(null, function (e) { noteErr('room.remove', e); }); } catch (e) { noteErr('room.remove', e); }
      }
      if (status === 'denied') { denied = true; return; }
      if (!retryTimer) {
        retryTimer = later(function () { retryTimer = null; resume(); }, ROOM_RETRY[Math.min(retryN, ROOM_RETRY.length - 1)]);
        retryN++;
      }
    }
    function resume() {
      if (denied || !stopped || signedOut) return;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      connect();
    }
    function onStatus(c, status, err) {
      if (stopped || c !== ch) return;
      roomState.status = String(status || '');
      if (status === 'SUBSCRIBED') { nErr = 0; retryN = 0; setUp(true); return; }
      if (err) noteErr('room.' + status, err);
      setUp(false);
      if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') return;
      if (err && ROOM_DENIED_RE.test(String(err.message || err))) stopRoom('denied');
      else if (++nErr >= ROOM_MAX_ERRORS) stopRoom('stopped');
    }
    function connect() {
      stopped = false; nErr = 0;
      var c;
      try {
        c = ch = client.channel('tyl-room', { config: { private: true, broadcast: { self: false } } });
        c.on('broadcast', { event: 'tyl' }, function (m) {
          var p = m && m.payload;
          if (!p || typeof p.topic !== 'string' || !TOPIC_RE.test(p.topic)) return;
          roomState.received++;
          var by = typeof p.by === 'string' ? p.by : null;
          dispatch(p.topic, Object.freeze({
            topic: p.topic, data: p.data, peer: String(p.peer || ''), by: by,
            isMe: !!(by && by === uid), sameTab: false, kind: 'viewer', guest: false
          }));
        });
        authSync().then(function () {
          if (stopped || ch !== c) return;
          try { c.subscribe(function (st, er) { onStatus(c, st, er); }); } catch (e) { noteErr('room.subscribe', e); }
        });
      } catch (e) { noteErr('room.channel', e); }
    }
    connect();
    try {
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('online', function () { if (stopped) resume(); });
        var onVis = function () { if (stopped && (!document || document.visibilityState !== 'hidden')) resume(); };
        if (document && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVis);
        else window.addEventListener('visibilitychange', onVis);
      }
    } catch (e) { noteErr('room.listeners', e); }

    function emit(topic, data) {
      if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) return Promise.reject(roomErr('invalid_argument', 'room.emit : sujet invalide'));
      var txt;
      try { txt = data === undefined ? '' : JSON.stringify(data); } catch (e) { return Promise.reject(roomErr('invalid_argument', 'room.emit : données non JSON')); }
      if (txt === undefined || utf8Len(txt || '') > 4096) return Promise.reject(roomErr('invalid_argument', 'room.emit : données > 4 Kio'));
      if (!roomState.up || !ch) return Promise.resolve(); // déconnecté : le moment est perdu (spec)
      var payload = { topic: topic, data: data === undefined ? undefined : JSON.parse(txt), peer: peer, by: uid };
      roomState.sent++;
      try {
        Promise.resolve(ch.send({ type: 'broadcast', event: 'tyl', payload: payload })).then(null, function (e) { noteErr('room.send', e); });
      } catch (e) { noteErr('room.send', e); }
      // Écho local (isMe && sameTab), comme la plateforme.
      later(function () {
        dispatch(topic, Object.freeze({
          topic: topic, data: payload.data, peer: peer, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: false
        }));
      });
      return Promise.resolve();
    }
    function on(topic, handler, onError) {
      if (typeof handler !== 'function') throw new TypeError('room.on : handler doit être une fonction');
      if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) {
        if (typeof onError === 'function') Promise.resolve().then(function () { onError({ code: 'invalid_argument', message: 'room.on : sujet invalide' }); });
        return function () {};
      }
      var l = { h: handler, active: true };
      (listeners[topic] = listeners[topic] || []).push(l);
      return function () {
        l.active = false;
        var a = listeners[topic] || [], i = a.indexOf(l);
        if (i >= 0) a.splice(i, 1);
      };
    }
    function onConnection(handler, onError) {
      if (typeof handler !== 'function') throw new TypeError('room.onConnection : handler doit être une fonction');
      var l = { h: handler, active: true };
      connL.push(l);
      Promise.resolve().then(function () { if (l.active) { try { handler(roomState.up); } catch (e) { noteErr('room.onConnection', e); } } });
      return function () { l.active = false; var i = connL.indexOf(l); if (i >= 0) connL.splice(i, 1); };
    }
    function selfPeer() {
      return Object.freeze({ peer: peer, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({}), updatedAt: Date.now() });
    }
    // Inutilisés par l'appli (inventaire §2) : stubs sûrs.
    var me1 = null;
    function peers() { if (!me1) me1 = Object.freeze([selfPeer()]); return me1; }
    return Object.freeze({
      __resume: function () { if (stopped) resume(); },
      emit: emit,
      on: on,
      connected: function () { return roomState.up; },
      onConnection: onConnection,
      presence: function (patch) {
        if (!isPlainObject(patch)) return Promise.reject(roomErr('invalid_argument', 'room.presence : objet attendu'));
        return Promise.resolve();
      },
      peers: peers,
      onPeers: function (handler) {
        if (typeof handler !== 'function') throw new TypeError('room.onPeers : handler doit être une fonction');
        var active = true;
        Promise.resolve().then(function () {
          if (active) { var p = peers(); try { handler({ peers: p, joined: p, left: [], updated: [] }); } catch (e) { noteErr('room.onPeers', e); } }
        });
        return function () { active = false; };
      },
      join: function () { return Promise.reject(roomErr('not_permitted', 'room.join non pris en charge')); },
      canSendToClaudeSession: function () { return Promise.resolve('off'); },
      sendToClaudeSession: function () { return Promise.reject(roomErr('claude_unavailable', 'IA désactivée')); }
    });
  }

  // =====================================================================
  // claude.use
  // =====================================================================
  var memo = {};
  function build(name) {
    switch (name) {
      case 'db': return dbNs;
      case 'user': return userNs;
      case 'room':
        if (!roomNs) roomNs = makeRoom();
        return roomNs;
      case 'assets':
        // Comme la plateforme : null pour qui ne peut pas éditer (revue M11).
        return profileRetry().then(function () {
          try {
            if (!isMj()) return null;
            return typeof window.__tylAssets === 'function' ? (window.__tylAssets(client, { uid: uid, isMj: true }) || null) : null;
          } catch (e) { noteErr('assets', e); return null; }
        });
      default: return null; // 'sample' (IA désactivée) et noms inconnus
    }
  }
  function use(name) {
    name = String(name);
    if (name !== 'db' && name !== 'user' && name !== 'room' && name !== 'assets') {
      // Inconnu ou désactivé : null, sans attendre la connexion.
      return Promise.resolve(null);
    }
    if (!memo[name]) memo[name] = readyP.then(function () { return build(name); });
    return memo[name];
  }

  window.claude = { use: use };

  window.tylDebug = function () {
    var chans = {}, nSubs = 0;
    Object.keys(cols).forEach(function (k) {
      var C = cols[k];
      nSubs += C.subs.length;
      chans[k] = { status: C.status, subs: C.subs.length, docs: Object.keys(C.docs).length, full: C.full, polling: !!C.pollTimer };
    });
    return {
      version: VERSION, configured: true, ready: isReady, uid: uid,
      role: profile ? profile.role : null, name: profile ? profile.display_name : null,
      subscriptions: nSubs, channels: chans,
      room: roomNs ? { connected: roomState.up, status: roomState.status, sent: roomState.sent, received: roomState.received } : null,
      rev: HAS_REV, pendingEchoes: recent.length, writeQueues: Object.keys(queues).length,
      stats: JSON.parse(JSON.stringify(stats)), lastErrors: lastErrors.slice()
    };
  };
})(typeof window !== 'undefined' ? window : this);
