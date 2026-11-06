/* combat-simple.js : « Combat simplifié » (tranches T0, T1, T2). ES5, sans bibliothèque.
   1. Modèle pur (testé sous Node) : simple(S), bucket, viewOf(S) = document « vue joueuse » dérivé de l'état de combat,
      sigOf, makePublisher (écriture temporisée, une seule en vol, >= 1 s entre deux écritures).
   2. Interface MJ (navigateur seulement) : ajout rapide d'ennemis, bouton « caché », réglage du mode, gros bouton
      « Tour suivant ». Branchée par app.js avec window.tylCS.bind({...}) ; aucun HTML construit sans esc().
   Le MJ est la seule autorité : la vue ne contient jamais d'ennemi caché, de PV exact d'ennemi, de journal, de notes,
   de carte (voir tasks/spec-combat-simple.md §5). */
(function (root) {
  'use strict';

  var api = {};
  var WORDS = ['À terre', 'Presque mort', 'Sanglant', 'Blessé', 'Indemne'];
  var VIEW_MAX = 55000;   /* le serveur refuse > 60 000 octets */

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function int(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }
  function str(v, n) { return String(v == null ? '' : v).slice(0, n); }

  /* ---------- drapeau central : Simplifié par défaut (H9), Complet seulement si mode === 'full' ---------- */
  function simple(S) { return !(S && S.mode === 'full'); }

  /* ---------- paliers de PV : 0 à terre, 1 <= 25 %, 2 <= 50 %, 3 < 100 %, 4 indemne (même échelle que healthWord) ---------- */
  function bucket(hp, max) {
    var h = int(hp, 0), m = Math.max(1, int(max, 1));
    if (h <= 0) return 0;
    var r = h / m;
    return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r < 1 ? 3 : 4;
  }

  /* ---------- projection : état de combat -> vue joueuse ---------- */
  function chainOf(c, byId) {
    var out = [], seen = {}, x = c, k = 0;
    while (x && k++ < 8 && !seen[x.id]) { out.push(x); seen[x.id] = 1; x = x.owner && x.owner !== x.id ? byId[x.owner] : null; }
    return out;
  }
  function party(c, byId) { return chainOf(c, byId).some(function (x) { return x.kind === 'pj'; }); }
  function hidden(c, byId) { return !party(c, byId) && chainOf(c, byId).some(function (x) { return !!x.hid; }); }
  function plain(o) { return isObj(o) ? o : {}; }

  function viewParty(c) {
    var e = plain(c.eco), d = plain(c.ds);
    var o = {
      id: str(c.id, 40), name: str(c.name, 60), base: str(c.base, 60), libId: str(c.libId, 60), owner: str(c.owner, 40), kind: c.kind === 'pj' ? 'pj' : 'mj',
      ac: int(c.ac, 10), hp: int(c.hp, 0), max: Math.max(1, int(c.max, 1)), temp: Math.max(0, int(c.temp, 0)), b: int(c.b, 0), init: int(c.init, 0), ex: Math.max(0, int(c.ex, 0)),
      conds: (Array.isArray(c.conds) ? c.conds : []).slice(0, 20).map(function (x) { return str(x, 30); }),
      eco: { g: int(e.g, 0), a: int(e.a, 0) ? 1 : 0, n: int(e.n, 0), b: int(e.b, 0) ? 1 : 0, r: int(e.r, 0) ? 1 : 0, bs: int(e.bs, 0) },
      ds: { s: int(d.s, 0), f: int(d.f, 0) }, dsv: c.dsv ? 1 : 0, pw: plain(c.pw)
    };
    if (isObj(c.lg)) o.lg = { max: Math.max(1, int(c.lg.max, 3)), used: Math.max(0, int(c.lg.used, 0)) };
    if (c.atk) o.atk = str(c.atk, 200);   /* attaques notées par le MJ sur la carte du PJ : armes de la page joueuse (C2) */
    if (c.cid) o.cid = str(c.cid, 40);
    return o;
  }
  function viewFoe(c) {
    return {
      id: str(c.id, 40), name: str(c.name, 60), kind: 'mj', init: int(c.init, 0),
      conds: (Array.isArray(c.conds) ? c.conds : []).slice(0, 20).map(function (x) { return str(x, 30); }),
      hp: bucket(c.hp, c.max), max: 4
    };
  }

  /* taille en octets UTF-8 (le trigger compte des octets, pas des caractères UTF-16) */
  function bytes(o) { var s = JSON.stringify(o); try { return unescape(encodeURIComponent(s)).length; } catch (e) { return s.length * 3; } }

  function viewOf(S) {
    S = isObj(S) ? S : {};
    if (!simple(S)) return { v: 1, mode: 'full' };
    var list = (Array.isArray(S.combatants) ? S.combatants : []).filter(function (c) { return isObj(c) && c.id != null; });
    var byId = {};
    list.forEach(function (c) { byId[c.id] = c; });
    var shown = [];
    list.forEach(function (c) {
      if (hidden(c, byId)) return;
      shown.push(party(c, byId) ? viewParty(c) : viewFoe(c));
    });
    var act = '', foe = 0, a = S.activeId != null ? byId[S.activeId] : null;
    if (a) { if (hidden(a, byId)) foe = 1; else act = str(a.id, 40); }
    var v = { v: 1, mode: 'simple', round: Math.max(1, int(S.round, 1)), act: act };
    if (foe) v.foe = 1;
    if (S.won) v.won = 1;
    if (S.example) v.example = 1;   /* combat d'exemple : sert au bouton « Rejoindre » de la joueuse (canJoin) */
    v.combatants = shown;
    /* garde-fou de taille (octets) : ressources détaillées, puis petits champs, puis ennemis en fin de liste, puis le reste */
    if (bytes(v) > VIEW_MAX) shown.forEach(function (c) { if (c.pw) c.pw = {}; });
    if (bytes(v) > VIEW_MAX) shown.forEach(function (c) { delete c.pw; delete c.eco; delete c.ds; });
    var i;
    for (i = shown.length - 1; i >= 0 && bytes(v) > VIEW_MAX; i--) if (shown[i].ac == null) shown.splice(i, 1);
    while (shown.length && bytes(v) > VIEW_MAX) shown.pop();
    return v;
  }
  function sigOf(view) { return JSON.stringify(view); }

  /* ---------- publication temporisée de combatview/live (MJ seulement, jamais plus d'une écriture en vol) ---------- */
  function makePublisher(o) {
    o = o || {};
    var gap = o.gap || 1000, coalesce = o.coalesce || 200, retry = o.retry || 3000;
    var now = o.now || function () { return Date.now(); };
    var setT = o.setT || function (f, ms) { return setTimeout(f, ms); };
    var st = { sig: null, flySig: null, want: null, wantSig: null, last: -1e12, retryAt: 0, timer: 0, busy: false, writes: 0 };
    function schedule() {
      if (st.timer || st.busy || !st.want) return;
      var t = now(), delay = Math.max(coalesce, st.last + gap - t, st.retryAt - t);
      st.timer = setT(flush, delay);
    }
    function flush() {
      st.timer = 0;
      if (!st.want || st.wantSig === st.sig) { st.want = null; return; }
      var v = st.want, sg = st.wantSig, doc = {}, k;
      for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) doc[k] = v[k];
      doc.at = now();
      st.busy = true; st.flySig = sg; st.last = now(); st.writes++;
      var pr;
      try { pr = o.write(doc); } catch (e) { pr = Promise.reject(e); }
      Promise.resolve(pr).then(function () {
        st.busy = false; st.flySig = null; st.last = now(); st.sig = sg;
        if (st.wantSig === sg) { st.want = null; st.wantSig = null; }
        schedule();
      }, function () {
        st.busy = false; st.flySig = null; st.last = now(); st.retryAt = now() + retry;
        if (!st.want) { st.want = v; st.wantSig = sg; }   /* rien de plus récent demandé : on retentera cette vue */
        schedule();
      });
    }
    return {
      touch: function (S) {
        var v = viewOf(S), sg = sigOf(v), cur = st.busy ? st.flySig : st.sig;
        /* comparer à la vue EN VOL quand une écriture est en cours (I3 : révéler puis recacher pendant l'écriture) */
        if (sg === cur) { st.want = null; st.wantSig = null; return; }
        if (sg === st.wantSig) return;
        st.want = v; st.wantSig = sg;
        schedule();
      },
      forget: function () { st.sig = null; },
      stats: function () { return { writes: st.writes, busy: st.busy, pending: !!st.want }; }
    };
  }

  /* actions de joueuse refusées en Simplifié (spec §5/§7.9) : carte, déplacement, attaques/sorts automatisés, invocations */
  var FORBID = { atk: 1, spell: 1, dmg: 1, move: 1, prop: 1, summon: 1 };
  function forbidden(t) { return Object.prototype.hasOwnProperty.call(FORBID, t); }
  /* vrai si le combattant fait partie du groupe (PJ ou dépendant d'un PJ) : jamais cachable */
  function isParty(c, S) {
    var byId = {};
    ((S && Array.isArray(S.combatants)) ? S.combatants : []).forEach(function (x) { if (isObj(x)) byId[x.id] = x; });
    return !!c && party(c, byId);
  }

  /* ids des combattants cachés aux joueuses (ennemi caché + ses dépendants), même règle que viewOf : sert à la projection du tableau */
  function hiddenIds(S) {
    var list = (S && Array.isArray(S.combatants)) ? S.combatants.filter(isObj) : [], byId = {}, out = {};
    list.forEach(function (c) { byId[c.id] = c; });
    list.forEach(function (c) { if (hidden(c, byId)) out[c.id] = 1; });
    return out;
  }

  api.WORDS = WORDS;
  api.hiddenIds = hiddenIds;
  api.forbidden = forbidden;
  api.isParty = isParty;
  api.simple = simple;
  api.bucket = bucket;
  api.viewOf = viewOf;
  api.sigOf = sigOf;
  api.makePublisher = makePublisher;

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.tylCS = api;
  if (!root || !root.document) return;

  /* =================== Interface MJ (navigateur) =================== */
  var doc = root.document;
  var H = null, pub = null, ui = { built: false, sug: [], free: false };
  var LS_REC = 'tylchronicle-cs-recent-v1';
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return H && H.esc ? H.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; }); }
  function getS() { return H ? H.S() : null; }
  function isMj() { return !!H && H.role() !== 'joueur'; }

  function recents() {
    try { var a = JSON.parse(localStorage.getItem(LS_REC) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return x && typeof x.n === 'string'; }).slice(0, 6) : []; } catch (e) { return []; }
  }
  function pushRecent(o) {
    var a = recents().filter(function (x) { return x.n !== o.n; });
    a.unshift({ n: String(o.n).slice(0, 60), ac: o.ac, hp: o.hp, b: o.b, libId: o.libId || '', cid: o.cid || '' });
    try { localStorage.setItem(LS_REC, JSON.stringify(a.slice(0, 6))); } catch (e) { /* stockage indisponible */ }
  }

  function build() {
    if (ui.built || !doc.body) return;
    var ops = doc.querySelector('#viewCombat .mj-ops'), now = $('now');
    if (!ops || !now) return;
    ui.built = true;
    var q = doc.createElement('section');
    q.id = 'csQuick'; q.className = 'cs-quick'; q.hidden = true; q.setAttribute('aria-label', 'Ajout rapide au combat');
    q.innerHTML =
      '<div class="cs-row"><input id="csName" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="Monstre ou nom libre (gobelin, bandit…)" aria-label="Monstre ou nom libre à ajouter"></div>' +
      '<div class="cs-row cs-opts"><label class="cs-qty"><span>Nombre</span><input id="csQty" type="number" inputmode="numeric" min="1" max="20" value="1" aria-label="Nombre de créatures"></label>' +
      '<label class="cs-chk"><input id="csHid" type="checkbox"><span>Caché</span></label>' +
      '<button type="button" class="btn primary cs-add" id="csAdd">Ajouter</button></div>' +
      '<div class="cs-row cs-free" id="csFree" hidden><label><span>PV</span><input id="csHp" type="number" inputmode="numeric" min="1" value="10" aria-label="PV du nom libre"></label>' +
      '<label><span>CA</span><input id="csAc" type="number" inputmode="numeric" min="1" value="12" aria-label="CA du nom libre"></label><span class="cs-hint">Nom libre : PV et CA à régler.</span></div>' +
      '<div class="cs-sug" id="csSug" role="group" aria-label="Suggestions du bestiaire"></div>' +
      '<div class="cs-rec" id="csRec" role="group" aria-label="Derniers ajoutés"></div>' +
      '<div class="cs-row cs-act"><button type="button" class="btn" id="csGroup">Tout le groupe</button><button type="button" class="btn" id="csNew">Nouveau combat</button><button type="button" class="btn" id="csFull">Mode Complet</button></div>';
    now.parentNode.insertBefore(q, now);
    var nb = doc.createElement('div');
    nb.id = 'csNextBar'; nb.hidden = true;
    nb.innerHTML = '<button type="button" class="btn primary" id="csNext">Démarrer le combat</button>';
    doc.body.appendChild(nb);
    var menu = doc.querySelector('#barMore .bmenu'), hint = menu && menu.querySelector('.bmh');
    if (menu) {
      var mb = doc.createElement('button');
      mb.type = 'button'; mb.className = 'btn'; mb.id = 'csMode'; mb.setAttribute('aria-pressed', 'true');
      menu.insertBefore(mb, hint || null);
    }
    /* évènements */
    $('csName').addEventListener('input', function () { renderSug(); });
    $('csName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } });
    $('csAdd').addEventListener('click', addTyped);
    $('csSug').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-cs-i]') : null; if (b) addFromList(ui.sug, +b.getAttribute('data-cs-i')); });
    $('csRec').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-cs-r]') : null; if (b) addFromList(recents(), +b.getAttribute('data-cs-r')); });
    $('csGroup').addEventListener('click', function () { H.addGroup(); });
    $('csNew').addEventListener('click', function () { var w = $('wipe'); if (w) w.click(); });
    $('csNext').addEventListener('click', function () { var n = $('next'); if (n && !n.disabled) n.click(); });
    $('csFull').addEventListener('click', toggleMode);
    if (mb) mb.addEventListener('click', toggleMode);
    var le = $('list');
    if (le) le.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-cs="hid"]') : null;
      if (!b) return;
      var li = b.closest('[data-id]'), c = li && H.byId(li.getAttribute('data-id'));
      if (!c || isParty(c, getS())) return;
      H.mutate(function () { if (c.hid) delete c.hid; else c.hid = 1; }, function () { return c.name + (c.hid ? ' est caché aux joueuses' : ' est révélé aux joueuses'); });
    });
  }

  function toggleMode() {
    var S = getS();
    if (!S) return;
    S.mode = simple(S) ? 'full' : 'simple';
    H.save(); H.render();
  }

  /* suggestions du bestiaire pour le texte tapé */
  function matches(qtxt) {
    var qf = H.fold(qtxt.trim());
    if (!qf) return [];
    var B = H.best() || [], out = [], i, r, nf;
    for (i = 0; i < B.length && out.length < 40; i++) {
      r = B[i]; nf = H.fold(r.n);
      if (nf.indexOf(qf) >= 0) out.push({ r: r, s: nf.indexOf(qf) === 0 ? 0 : 1 });
    }
    out.sort(function (a, b) { return a.s - b.s || String(a.r.n).length - String(b.r.n).length; });
    return out.slice(0, 5).map(function (x) {
      var r = x.r;
      return { n: r.n, ac: r.c, hp: r.h, b: r.b == null ? 0 : r.b, libId: r.custom ? r.lid : '', cid: r.custom ? '' : r.i };
    });
  }
  function renderSug() {
    var t = $('csName').value;
    ui.sug = matches(t);
    ui.free = !!t.trim() && !ui.sug.length;
    $('csFree').hidden = !ui.free;
    $('csSug').innerHTML = ui.sug.map(function (o, i) {
      return '<button type="button" class="btn cs-s" data-cs-i="' + i + '"><b>' + esc(o.n) + '</b><span>CA ' + esc(o.ac) + ' · PV ' + esc(o.hp) + '</span></button>';
    }).join('');
  }
  function renderRec() {
    var r = recents();
    $('csRec').hidden = !r.length;
    $('csRec').innerHTML = r.map(function (o, i) { return '<button type="button" class="btn cs-r" data-cs-r="' + i + '" aria-label="Ajouter ' + esc(o.n) + '">+ ' + esc(o.n) + '</button>'; }).join('');
  }
  function qty() { var n = parseInt($('csQty').value, 10); return isNaN(n) ? 1 : Math.max(1, Math.min(20, n)); }
  function addCreature(o) {
    var q = qty(), hid = $('csHid').checked;
    var spec = { n: o.n, ac: o.ac, hp: o.hp, b: o.b, libId: o.libId || '', cid: o.cid || '', hid: hid ? 1 : 0 };
    H.addCreatures(spec, 'mj', q, null);
    pushRecent(o);
    $('csName').value = ''; $('csQty').value = '1'; $('csHid').checked = false;
    renderSug(); renderRec();
  }
  function addFromList(list, i) { var o = list && list[i]; if (o) addCreature(o); }
  function addTyped() {
    var t = $('csName').value.trim();
    if (!t) { $('csName').focus(); return; }
    if (ui.sug.length) { addCreature(ui.sug[0]); return; }
    var hp = Math.max(1, parseInt($('csHp').value, 10) || 10), ac = Math.max(1, parseInt($('csAc').value, 10) || 12);
    addCreature({ n: t.slice(0, 60), ac: ac, hp: hp, b: 0, libId: '', cid: '' });
  }

  /* synchronisation après chaque rendu : classe, visibilité, libellés, publication */
  function sync() {
    if (!H) return;
    build();
    var S = getS(), s = simple(S), mj = isMj();
    doc.body.classList.toggle('cs-simple', s);
    doc.body.classList.toggle('cs-mj', mj);
    if (s && (!H.loaded || H.loaded())) {   /* scène rendue avant le chargement du mode : vidée (la clé de cache est remise à zéro pour que Complet la redessine) */
      ['mjScene', 'pvScene'].forEach(function (id) { var h = $(id); if (h && h.innerHTML) { h.innerHTML = ''; h.__key = ''; } });
    }
    if (!ui.built) return;
    var inCombat = !!$('viewCombat') && !$('viewCombat').hidden;
    $('csQuick').hidden = !(s && mj);
    $('csNextBar').hidden = !(s && mj && inCombat);
    var nx = $('next');
    if (nx) { $('csNext').textContent = nx.textContent; $('csNext').disabled = !!nx.disabled; }
    var mb = $('csMode');
    if (mb) { mb.textContent = 'Mode de combat : ' + (s ? 'Simplifié' : 'Complet'); mb.setAttribute('aria-pressed', s ? 'true' : 'false'); mb.title = s ? 'Touche pour revenir au mode Complet (carte, déplacements, scène)' : 'Touche pour passer au mode Simplifié (sans carte)'; }
    var w = $('wipe'), nw = $('csNew');
    if (nw) { var has = !!(S && S.combatants && S.combatants.length); nw.hidden = !has; var armedW = !!(w && w.classList.contains('armed')); nw.textContent = armedW ? 'Confirmer : tout vider ?' : 'Nouveau combat'; nw.classList.toggle('armed', armedW); }
    if (!ui.rec) { ui.rec = 1; renderRec(); }
    if (pub && H.canPublish()) pub.touch(S);
  }

  /* cartes de la liste : bouton « Cacher / Révéler » pour les ennemis (Simplifié seulement) */
  function decorate(listEl) {
    var S = getS();
    if (!listEl || !S || !simple(S) || !isMj()) return;
    Array.prototype.forEach.call(listEl.querySelectorAll('li.card[data-id]'), function (li) {
      var c = H.byId(li.getAttribute('data-id'));
      if (!c || c.kind !== 'mj' || isParty(c, S)) return;
      var tools = li.querySelector('.tools');
      if (tools) {
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'btn sm cs-hidbtn'; b.setAttribute('data-cs', 'hid'); b.setAttribute('aria-pressed', c.hid ? 'true' : 'false');
        b.textContent = c.hid ? 'Révéler' : 'Cacher';
        b.title = c.hid ? 'Cet ennemi est invisible pour les joueuses : touche pour le révéler' : 'Touche pour le cacher aux joueuses';
        tools.insertBefore(b, tools.firstChild);
      }
      if (c.hid) {
        li.classList.add('cs-hid');
        var nm = li.querySelector('.head .name');
        if (nm) { var t = doc.createElement('span'); t.className = 'state cs-tag'; t.textContent = 'Caché'; nm.parentNode.insertBefore(t, nm.nextSibling); }
      }
    });
  }

  /* bandeau « tour en cours » réduit (remplace le menu complet du tour d'un monstre) */
  function nowHTML(a) {
    var S = getS(), cs = (a.conds || []).map(function (x) { return '<span class="chip on">' + esc(x) + '</span>'; }).join('');
    return '<div class="cs-now"><span class="cs-round">Round ' + esc(S.round) + '</span> Au tour de <b>' + esc(a.name) + '</b><span class="muted"> · PV ' + esc(a.hp) + '/' + esc(a.max) + ' · CA ' + esc(a.ac) + '</span>' + (a.hid ? ' <span class="state cs-tag">Caché</span>' : '') + (cs ? '<div class="chips">' + cs + '</div>' : '') + '</div>';
  }

  api.bind = function (h) { H = h; if (doc.readyState !== 'loading') build(); };
  api.attachDb = function (db) {
    try { pub = makePublisher({ write: function (d) { return db.doc('combatview/live').set(d); } }); } catch (e) { pub = null; }
  };
  api.sync = sync;
  api.decorate = decorate;
  api.nowHTML = nowHTML;
  api._pub = function () { return pub; };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' && globalThis.document ? globalThis : null));
