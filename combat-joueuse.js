/* combat-joueuse.js : page de combat PERSONNELLE de la joueuse en mode Simplifié (tranche T3b). ES5, sans bibliothèque.
   1. Modèle pur (testé sous Node) : validation des actions hp / roll / eco, limiteur de débit, dés, état « lavé » (scrub),
      choix de la source de données (document combatview/live, repli sur l'état), ma fiche, ordre de jeu, application côté MJ.
   2. Interface (navigateur seulement) : section #csPj dans la page joueuse, abonnement à combatview/live (lecture seule).
   Le MJ reste l'autorité : tout ce qui est envoyé passe par la file « actions » existante et est revalidé par le MJ (actAllowed + check).
   La joueuse n'écrit jamais ailleurs que dans « actions » (et dans sa propre fiche pour ses emplacements, via tk* existant).
   Rien d'un ennemi caché n'arrive jamais dans la page : l'état reçu est lavé avant d'être utilisé (scrub). */
(function (root) {
  'use strict';

  var CS = (root && root.tylCS) || (typeof require === 'function' ? require('./combat-simple.js') : null);
  var api = {};
  var WORDS = CS ? CS.WORDS : ['À terre', 'Presque mort', 'Sanglant', 'Blessé', 'Indemne'];

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function inRange(v, lo, hi) { return isInt(v) && v >= lo && v <= hi; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------- validation (MJ : revérifie tout ; joueuse : prévérifie avant d'envoyer) ---------- */
  var KEYS = {
    hp: { t: 1, actor: 1, hp: 1, temp: 1, base: 1, bt: 1 },
    roll: { t: 1, actor: 1, title: 1, expr: 1, total: 1, nat: 1 },
    eco: { t: 1, actor: 1, k: 1, v: 1 }
  };
  var COMMON = { ts: 1, from: 1, id: 1 };
  var EXPR_RE = /^[0-9d+\- ]+$/;

  /* retourne '' si l'action est acceptable, sinon la raison (courte, pour le journal du MJ) */
  function check(a, c, S) {
    if (!isObj(a)) return 'action illisible';
    var t = a.t;
    if (!has(KEYS, t)) return 'type inconnu';
    if (!S || !CS || !CS.simple(S)) return 'réservé au mode Simplifié';
    if (!c || c.kind !== 'pj') return 'seul son propre personnage est modifiable';
    var k, ks = KEYS[t];
    for (k in a) if (has(a, k) && !ks[k] && !COMMON[k]) return 'champ non permis (' + String(k).slice(0, 12) + ')';
    if (t === 'hp') {
      if (!inRange(a.hp, 0, isInt(c.max) ? c.max : 0)) return 'PV hors bornes';
      if (!inRange(a.temp, 0, 999)) return 'PV temporaires hors bornes';
      if (has(a, 'base') && !inRange(a.base, 0, 99999)) return 'PV vus invalides';
      if (has(a, 'bt') && !inRange(a.bt, 0, 999)) return 'PV temporaires vus invalides';
      return '';
    }
    if (t === 'roll') {
      if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 60) return 'titre invalide';
      if (typeof a.expr !== 'string' || !a.expr.trim() || a.expr.length > 40 || !EXPR_RE.test(a.expr)) return 'expression invalide';
      if (!inRange(a.total, -999, 9999)) return 'total invalide';
      if (!inRange(a.nat, 0, 20)) return 'dé naturel invalide';
      return '';
    }
    /* eco */
    if (a.k !== 'a' && a.k !== 'b' && a.k !== 'r') return 'case inconnue';
    if (a.v !== 0 && a.v !== 1) return 'valeur invalide';
    if (a.v === 1) {
      if (!S.activeId) return 'pas de combat en cours';
      if (a.k !== 'r' && S.activeId !== c.id) return 'ce n\'est pas son tour';
    }
    return '';
  }

  /* ---------- débit : au plus max événements par fenêtre, par expéditrice ---------- */
  function makeLimiter(max, ms) {
    var seen = {};
    return {
      take: function (who, now) {
        var k = String(who || '?'), list = (seen[k] || []).filter(function (t) { return now - t < ms; });
        if (list.length >= max) { seen[k] = list; return false; }
        list.push(now); seen[k] = list; return true;
      }
    };
  }
  var mjLimiter = makeLimiter(5, 10000);
  function take(from) { return mjLimiter.take(from, Date.now()); }

  /* ---------- dés : « 2d6+3 », « d20-1 », « 1d4 + 1d6 » ; critique = nombre de dés doublé ---------- */
  function rollDice(expr, crit, rnd) {
    var s = String(expr == null ? '' : expr).replace(/\s+/g, '').replace(/−/g, '-');
    if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(s)) return null;
    var re = /([+-]?)(?:(\d*)d(\d+)|(\d+))/g, m, total = 0, dice = 0, parts = [], det = [];
    rnd = rnd || function (n) { return Math.floor(Math.random() * n) + 1; };
    while ((m = re.exec(s))) {
      var neg = m[1] === '-', sign = neg ? -1 : 1;
      if (m[3] != null) {
        var cnt = (m[2] === '' ? 1 : parseInt(m[2], 10)) * (crit ? 2 : 1), sides = parseInt(m[3], 10), i, sum = 0, faces = [];
        if (!(cnt >= 1) || cnt > 50 || sides < 2 || sides > 100) return null;
        dice += cnt; if (dice > 50) return null;
        for (i = 0; i < cnt; i++) { var f = rnd(sides); faces.push(f); sum += f; }
        total += sign * sum;
        parts.push((parts.length ? (neg ? '-' : '+') : (neg ? '-' : '')) + cnt + 'd' + sides);
        det.push((neg ? '-' : (det.length ? '+' : '')) + cnt + 'd' + sides + ' [' + faces.join(', ') + ']');
      } else {
        var fl = parseInt(m[4], 10);
        if (fl > 999) return null;
        total += sign * fl;
        parts.push((parts.length ? (neg ? '-' : '+') : (neg ? '-' : '')) + fl);
        det.push((neg ? '-' : '+') + fl);
      }
    }
    return { total: total, expr: parts.join(''), detail: det.join(' ') };
  }
  function attackRoll(bonus, rnd) {
    rnd = rnd || function (n) { return Math.floor(Math.random() * n) + 1; };
    var b = isInt(bonus) ? Math.max(-50, Math.min(50, bonus)) : 0, nat = rnd(20);
    return { nat: nat, total: nat + b, expr: '1d20' + (b < 0 ? '-' : '+') + Math.abs(b), detail: '1d20 [' + nat + '] ' + (b < 0 ? '-' : '+') + Math.abs(b) };
  }

  /* ---------- état lavé : ce que la page joueuse (et tout le code existant côté joueuse) a le droit de voir ---------- */
  function scrub(st) {
    if (!isObj(st) || !CS || !CS.simple(st)) return st;
    var v = CS.viewOf(st), keep = {}, out = {}, k;
    (v.combatants || []).forEach(function (c) { keep[c.id] = c; });
    for (k in st) if (has(st, k)) out[k] = st[k];
    out.combatants = (Array.isArray(st.combatants) ? st.combatants : []).filter(function (c) { return isObj(c) && keep[c.id]; }).map(function (c) {
      return CS.isParty(c, st) ? c : keep[c.id];
    });
    out.log = [];
    delete out.map; delete out.oa; delete out.fx; delete out.env; delete out.notes;
    out.activeId = v.act || null;
    if (v.foe) out.foe = 1; else delete out.foe;
    return out;
  }

  /* ---------- Complet : on retire quand même les ennemis cachés (I5) : combattants, journal, cibles, animation ---------- */
  function hideFull(st) {
    if (!isObj(st) || !CS || CS.simple(st) || !CS.hiddenIds) return st;
    var hid = CS.hiddenIds(st), ids = Object.keys(hid), names = [], out = {}, k;
    if (!ids.length) return st;
    var list = Array.isArray(st.combatants) ? st.combatants : [];
    list.forEach(function (c) { if (isObj(c) && hid[c.id]) { if (c.name) names.push(String(c.name)); if (c.base && c.base !== c.name) names.push(String(c.base)); } });
    function leaks(x) { var t = String(x == null ? '' : x); return ids.some(function (i) { return t.indexOf(i) >= 0; }) || names.some(function (n) { return t.indexOf(n) >= 0; }); }
    for (k in st) if (has(st, k)) out[k] = st[k];
    out.combatants = list.filter(function (c) { return !(isObj(c) && hid[c.id]); }).map(function (c) {
      if (!isObj(c) || !isObj(c.pa) || !hid[c.pa.tgt]) return c;
      var o = {}, j; for (j in c) if (has(c, j)) o[j] = c[j]; o.pa = null; return o;
    });
    out.log = (Array.isArray(st.log) ? st.log : []).filter(function (l) { return !leaks(l); });
    if (Array.isArray(st.oa)) out.oa = st.oa.filter(function (o) { return !(isObj(o) && (hid[o.m] || hid[o.h])); });
    if (Array.isArray(st.done)) out.done = st.done.filter(function (x) { return !hid[x]; });
    if (out.activeId && hid[out.activeId]) out.activeId = null;
    if (out.gapN && hid[out.gapN]) out.gapN = '';
    if (isObj(st.fx) && leaks(JSON.stringify(st.fx))) out.fx = { n: st.fx.n | 0, k: '', src: '', dst: '', v: 0, txt: '', cap: '' };
    return out;
  }
  /* ce que la joueuse a le droit de voir de combat/state, dans les deux modes */
  function lave(st) { return isObj(st) && CS && !CS.simple(st) ? hideFull(st) : scrub(st); }

  /* ---------- source de données : la vue publiée (combatview/live) d'abord, sinon l'état lavé ---------- */
  /* vue utilisable : Simplifié, bien formée, et pas plus ancienne de 5 s que le dernier combat/state reçu (I6 : vieil onglet MJ qui ne publie plus) */
  function usable(viewDoc, stAt) {
    if (!(isObj(viewDoc) && viewDoc.v === 1 && viewDoc.mode === 'simple' && Array.isArray(viewDoc.combatants))) return null;
    if (stAt && typeof viewDoc.at === 'number' && stAt - viewDoc.at > 5000) return null;
    return viewDoc;
  }
  /* « S partiel » construit à partir de la vue (T3a) : tout le code existant de la page joueuse lit S (armes, jetons, bandeau, Rejoindre) */
  function fromView(v) {
    var st = { round: Math.max(1, v.round | 0), activeId: v.act || null, example: !!v.example, mode: 'simple', map: null, oa: [], log: [], done: [],
      won: v.won ? { n: 1, r: Math.max(1, v.round | 0) } : null, combatants: [] };
    v.combatants.forEach(function (c) { if (isObj(c) && c.id != null) st.combatants.push(c); });
    return st;
  }
  function pick(viewDoc, S, stAt) {
    if (usable(viewDoc, stAt)) return viewDoc;
    if (!CS) return null;
    var v = CS.viewOf(S);
    return v && v.mode === 'simple' ? v : null;
  }
  function mineOf(view, pid) {
    var list = view && Array.isArray(view.combatants) ? view.combatants : [], i;
    for (i = 0; i < list.length; i++) if (list[i].kind === 'pj' && list[i].libId && list[i].libId === pid) return list[i];
    return null;
  }
  function kidsOf(view, me) {
    return (view && Array.isArray(view.combatants) ? view.combatants : []).filter(function (c) { return me && c.owner === me.id && c.id !== me.id; });
  }
  function orderOf(view) {
    var list = (view && Array.isArray(view.combatants) ? view.combatants : []).map(function (c, i) { return { c: c, i: i }; });
    list.sort(function (a, b) { return (b.c.init | 0) - (a.c.init | 0) || a.i - b.i; });
    return list.map(function (x) { return x.c; });
  }
  function wordOf(c) {
    var h = c.hp | 0, m = Math.max(1, c.max | 0);
    return WORDS[CS ? CS.bucket(h, m) : (h <= 0 ? 0 : h >= m ? 4 : 3)];
  }

  /* ---------- application côté MJ (après check) ---------- */
  function clean1(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
  /* retourne '' ou la raison d'un refus (journal du MJ) */
  function apply(a, c, H) {
    if (!c || !H) return '';
    if (a.t === 'hp') {
      var h0 = c.hp | 0, t0 = c.temp | 0;
      if (h0 === a.hp && t0 === a.temp) return '';
      /* I1 : la joueuse envoie les PV qu'elle voyait ; si le MJ les a changés entre-temps, on refuse au lieu d'écraser */
      if ((has(a, 'base') && a.base !== h0) || (has(a, 'bt') && a.bt !== t0)) return 'PV changés entre-temps';
      H.mutate(function () {
        var was = c.hp <= 0;
        c.hp = a.hp; c.temp = a.temp;
        if (was && c.hp > 0) c.ds = { s: 0, f: 0 };
      }, function () {
        return c.name + ' corrige ses PV : ' + h0 + ' → ' + c.hp + '/' + c.max + (t0 !== c.temp ? ' (PV temp. ' + t0 + ' → ' + c.temp + ')' : '') + (c.hp <= 0 && h0 > 0 ? ', tombe à 0' : '');
      });
    } else if (a.t === 'eco') {
      var setEco = function (x) {
        var e = H.ecoOf(x);
        e[a.k] = a.v;
        if (a.k === 'a' && !a.v) e.n = 0;
        x.eco = e;
      };
      /* I2 : hors de la pile « Annuler » du MJ (H.quiet), sinon comportement d'avant */
      if (H.quiet) H.quiet(c, setEco); else H.mutate(function () { setEco(c); }, null);
    } else if (a.t === 'roll') {
      H.logLine(c.name + ' lance ' + clean1(a.title, 60) + ' (' + clean1(a.expr, 40) + ') : ' + a.total + (a.nat === 20 ? ' · critique !' : a.nat === 1 ? ' · échec critique' : ''));
    }
    return '';
  }

  api.check = check;
  api.makeLimiter = makeLimiter;
  api.take = take;
  api.rollDice = rollDice;
  api.attackRoll = attackRoll;
  api.scrub = scrub;
  api.hideFull = hideFull;
  api.lave = lave;
  api.usable = usable;
  api.fromView = fromView;
  api.pick = pick;
  api.mineOf = mineOf;
  api.kidsOf = kidsOf;
  api.orderOf = orderOf;
  api.wordOf = wordOf;
  api.apply = apply;

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.tylPJ = api;
  if (!root || !root.document) return;

  /* =================== Interface joueuse (navigateur) =================== */
  var doc = root.document;
  var H = null, dbh = null, viewRef = null, vdoc = null, vloaded = false, vbusy = false, vlast = 0, vErrAt = 0;
  var edit = null, ecoEdit = {}, rolls = [], note = '', noteT = 0, hpT = 0, lastHtml = '', lastNat = {}, scrubbed = false;
  var mine = makeLimiter(5, 10000);
  /* onglets (combat-onglets.js) : onglet courant (mémoire locale), niveau d'emplacement choisi par sort, dégâts du dernier sort à attaque, attaques faites ce tour */
  var TB = root.tylTabs, TAB_LS = 'tylchronicle-cs-tab', curTab = '', slotSel = {}, pend = null, atkMem = { key: '', n: 0 }, trkMark = null;

  function $(id) { return doc.getElementById(id); }
  function esc(s) { return H && H.esc ? H.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; }); }
  function now() { return Date.now(); }
  function isPlayer() { return !!H && H.role() === 'joueur'; }
  function active() { return isPlayer() && !!H.simple(); }

  function onView(snap) {
    var d = snap && snap.exists ? snap.data() : null;
    vdoc = isObj(d) ? d : null; vloaded = true; vlast = now();
    if (H && H.viewChanged) { try { H.viewChanged(); } catch (e) { paint(); } } else paint();
  }
  function stAt() { return H && H.stateAt ? H.stateAt() : 0; }
  function cur() { return H ? pick(vdoc, H.S(), stAt()) : null; }
  function subscribe() {
    if (viewRef || !dbh || !isPlayer() || now() - vErrAt < 30000) return;   /* M3 : 30 s entre deux essais après un refus */
    try {
      viewRef = dbh.doc('combatview/live');
      viewRef.onSnapshot(onView, function () { viewRef = null; vloaded = true; vErrAt = now(); });
    } catch (e) { viewRef = null; vErrAt = now(); }
  }
  /* relecture de secours (le temps réel peut être coupé) : au plus une lecture toutes les 2,5 s */
  function poll() {
    if (!viewRef || vbusy || now() - vlast < 2500 || !isPlayer()) return;
    vbusy = true; vlast = now();
    var p;
    try { p = viewRef.get(); } catch (e) { vbusy = false; return; }
    Promise.resolve(p).then(function (snap) { vbusy = false; onView(snap); }, function () { vbusy = false; });
  }

  function build() {
    var host = $('csPj');
    if (host) return host;
    var main = $('pvMain');
    if (!main) return null;
    host = doc.createElement('section');
    host.id = 'csPj'; host.className = 'box cs-pj'; host.hidden = true;
    host.setAttribute('data-pvt', 'jouer'); host.setAttribute('aria-label', 'Mon combat');
    host.innerHTML = '<div id="csPjIn" class="cs-in"></div><div id="csPark" hidden></div>';
    main.insertBefore(host, main.firstChild);
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
    host.addEventListener('change', onChange);
    var trk = $('pvTrack');
    if (trk && trk.parentNode && !trkMark) { trkMark = doc.createComment('cs-trk'); trk.parentNode.insertBefore(trkMark, trk); }
    return host;
  }

  function flash(t) {
    note = t || '';
    clearTimeout(noteT);
    if (note) noteT = setTimeout(function () { note = ''; paint(); }, 4500);
  }

  /* ----- envoi ----- */
  /* I4 : pendant le tour d'un ennemi caché (foe), il y a bien un combat en cours (la Réaction reste possible) */
  function ctxOf(view) { return { mode: 'simple', activeId: view && view.act ? view.act : (view && view.foe ? '_foe' : null) }; }
  function send(o, me, view) {
    var why = check(o, me, ctxOf(view));
    if (why) { flash('Impossible : ' + why + '.'); paint(); return false; }
    H.send(o);
    return true;
  }
  function flushHp() {
    hpT = 0;
    var view = cur(), me = view && H.entry() ? mineOf(view, H.entry().id) : null;
    if (!me || !edit || edit.sent) return;
    if (edit.hp === me.hp && edit.temp === me.temp) { edit = null; paint(); return; }
    if (send({ t: 'hp', actor: me.id, hp: edit.hp, temp: edit.temp, base: edit.base, bt: edit.bt }, me, view)) { edit.sent = true; edit.at = now(); } else edit = null;
    paint();
  }
  function bumpHp(me, dh, dt) {
    var live = edit && now() - edit.at < 9000 ? edit : null, c0 = live || { hp: me.hp, temp: me.temp, base: me.hp, bt: me.temp };
    /* base = PV que le MJ est censé avoir : ceux vus, ou ceux du dernier envoi pas encore confirmé (I1) */
    var base = live && live.sent ? live.hp : c0.base, bt = live && live.sent ? live.temp : c0.bt;
    var hp = Math.max(0, Math.min(me.max, c0.hp + dh)), temp = Math.max(0, Math.min(999, c0.temp + dt));
    edit = { hp: hp, temp: temp, base: base, bt: bt, at: now(), sent: false };
    clearTimeout(hpT); hpT = setTimeout(flushHp, 700);
    paint();
  }
  /* ----- économie d'action : une pastille (a / b / r) par type ; tout contrôle porte un type (combat-onglets.js : gate) ----- */
  function usedOf(me) {
    var eco = me.eco || {}, o = {};
    ['a', 'b', 'r'].forEach(function (k) { o[k] = ecoEdit[k] && now() - ecoEdit[k].at < 6000 ? ecoEdit[k].v : (eco[k] ? 1 : 0); });
    return o;
  }
  /* attaques faites ce tour (pour l'attaque supplémentaire) : mémoire locale, remise à zéro au changement de tour ou quand l'Action est décochée */
  function atkCount(me, view, used) {
    var k = view.round + ':' + view.act + ':' + me.id;
    if (atkMem.key !== k || !used.a) atkMem = { key: k, n: 0 };
    return atkMem.n;
  }
  function stOf(me, view, extra) {
    var used = usedOf(me), mx = H.extra ? H.extra() | 0 : 1;
    return { used: used, fight: !!(view.act || view.foe), myTurn: !!(view.act && view.act === me.id), atkN: atkCount(me, view, used), atkMax: Math.max(1, mx), weapon: !!(extra && extra.weapon) };
  }
  /* seul endroit qui envoie l'action existante eco */
  function setEco(me, view, k, v) {
    var was = ecoEdit[k];
    ecoEdit[k] = { v: v, at: now() };   /* avant l'envoi : le rendu déclenché par l'envoi doit déjà voir la case cochée */
    if (send({ t: 'eco', actor: me.id, k: k, v: v }, me, view)) return true;
    if (was) ecoEdit[k] = was; else delete ecoEdit[k];
    return false;
  }
  function toggleEco(me, view, k) {
    setEco(me, view, k, usedOf(me)[k] ? 0 : 1);
    paint();
  }
  /* utiliser un élément de type ty : refuse s'il est grisé (message court), sinon renvoie { tick } (cocher la pastille APRÈS avoir réussi) */
  function allow(me, view, ty, extra) {
    var g = TB.gate(ty, stOf(me, view, extra));
    if (g.off) { flash(TB.denyMsg(ty, g.why)); paint(); return null; }
    return g;
  }
  function budget(n) {
    if (!n) return true;
    if (mine.take('me', now())) return true;
    flash('Doucement : 5 jets au plus par 10 secondes.'); paint();
    return false;
  }
  /* seul endroit qui envoie l'action existante roll */
  function sendRoll(me, view, title, r, nat) {
    var o = { t: 'roll', actor: me.id, title: clean1(title, 60), expr: r.expr, total: r.total, nat: nat | 0 };
    if (!send(o, me, view)) return false;
    rolls.unshift({ title: o.title, total: r.total, detail: r.detail, nat: o.nat });
    rolls = rolls.slice(0, 5);
    return true;
  }
  function doRoll(me, view, i, kind) {
    var w = (H.weapons(me) || [])[i];
    if (!w) return;
    var g = kind === 'atk' ? allow(me, view, 'a', { weapon: true }) : { tick: false };
    if (!g) return;
    if (!budget(1)) return;
    var title, r, nat = 0;
    if (kind === 'atk') {
      r = attackRoll(w.b);
      nat = r.nat; lastNat[i] = nat; title = clean1(w.n, 44) + ' (toucher)';
    } else {
      var crit = lastNat[i] === 20, ex = (w.parts || []).map(function (p) { return p.d; }).join('+');
      r = rollDice(ex, crit);
      if (!r) { flash('Dégâts illisibles pour cette arme.'); paint(); return; }
      lastNat[i] = 0; title = clean1(w.n, 40) + (crit ? ' (dégâts critiques)' : ' (dégâts)');
    }
    if (sendRoll(me, view, title, r, nat) && kind === 'atk') {
      var n0 = atkCount(me, view, { a: 1 });
      atkMem.n = n0 + 1;
      if (g.tick) setEco(me, view, 'a', 1);
    }
    paint();
  }

  /* ----- sorts : liste de la fiche (app.js : pvMySpells), emplacements via tkCast (app.js), jets via roll ----- */
  function spellRows() { return H.spells ? H.spells() || [] : []; }   /* tous les sorts de la fiche : sert à retrouver un sort à lancer, même hors du deck affiché */
  /* decks de sorts (decks.js) : sorts affichés + puces « Deck actif / Tous » ; sans deck actif, liste et rendu inchangés */
  function deckOf(rows) { try { return root.tylDK && root.tylDK.deckView ? root.tylDK.deckView(rows) : null; } catch (er) { return null; } }
  function findSpell(e) { var l = spellRows(), i; for (i = 0; i < l.length; i++) if (l[i].e === e) return l[i]; return null; }
  /* niveaux d'emplacement possibles pour ce sort (vide = plus d'emplacement) */
  function levelsOf(r, memo) {
    var key = r.e;
    if (memo && memo[key]) return memo[key];
    var out = [], c = [r.l], inf = H.slotInfo ? H.slotInfo() : null, lv;
    if (r.l === 0) out = H.castCheck(r, 0) ? [] : [0];
    else {
      if (inf) { for (lv = r.l + 1; lv <= inf.n; lv++) c.push(lv); if (inf.pact > r.l) c.push(inf.pact); }
      c.sort(function (a, b) { return a - b; });
      c.forEach(function (x, ix) { if (c.indexOf(x) === ix && !H.castCheck(r, x)) out.push(x); });
    }
    if (memo) memo[key] = out;
    return out;
  }
  function noSlotText(r) {
    var err = r.l > 0 ? H.castCheck(r, r.l) : '';
    return /^Plus d'utilisation/.test(err) ? 'Plus d\'utilisation' : 'Plus d\'emplacement';
  }
  function partsExpr(info) { return (info && info.parts ? info.parts : []).map(function (p) { return p.d; }).join('+'); }
  function castSpell(me, view, e) {
    var row = findSpell(e);
    if (!row) return;
    var ty = TB.spellType(row), g = allow(me, view, ty);
    if (!g) return;
    var lv = levelsOf(row), slot = row.l > 0 ? (lv.indexOf(slotSel[row.e]) >= 0 ? slotSel[row.e] : lv[0]) : 0;
    if (!lv.length) { flash(noSlotText(row) + '.'); paint(); return; }
    var pre = H.castCheck(row, slot);
    if (pre) { flash(pre); paint(); return; }
    var info = H.castInfo ? H.castInfo(row, slot) : null, rr = null, nat = 0, title = '';
    if (row.at) { rr = attackRoll(info ? info.atk : 0); nat = rr.nat; title = row.n + ' (toucher)'; }
    else if (partsExpr(info)) {
      rr = rollDice(partsExpr(info), false);
      if (!rr) { flash('Dégâts illisibles pour ce sort.'); paint(); return; }
      title = row.n + (info.heal ? ' (soin)' : ' (dégâts)') + (row.sv && info.dc ? ' · DD ' + info.dc + ' ' + row.sv : '');
    }
    if (!budget(rr ? 1 : 0)) return;
    var res = H.cast(row, slot);
    if (!res || res.err) { flash(res && res.err ? res.err : 'Sort impossible.'); paint(); return; }
    if (g.tick) setEco(me, view, ty, 1);
    if (rr) sendRoll(me, view, title, rr, nat);
    pend = row.at && partsExpr(info) ? { e: row.e, slot: slot, nat: nat } : null;
    flash(row.n + ' lancé' + (row.l > 0 && slot > row.l ? ' (emplacement niv. ' + slot + ')' : '') + (res.replaced ? ' ; tu perds la concentration sur ' + res.replaced : '') + '.');
    paint();
  }
  function spellDmg(me, view, e) {
    var row = findSpell(e), p = pend;
    if (!row || !p || p.e !== e) return;
    var info = H.castInfo ? H.castInfo(row, p.slot) : null, crit = p.nat === 20, rr = rollDice(partsExpr(info), crit);
    if (!rr) { flash('Dégâts illisibles pour ce sort.'); paint(); return; }
    if (!budget(1)) return;
    if (sendRoll(me, view, row.n + (crit ? ' (dégâts critiques)' : ' (dégâts)'), rr, 0)) pend = null;
    paint();
  }

  /* ----- sac : équipement de la fiche (texte), quantité réécrite par app.js (libSave) ----- */
  function bagNow() { var b = H.bag ? H.bag() : { text: '', over: {} }; return { text: b.text, over: b.over, items: TB.parseBag(b.text) }; }
  function useItem(me, view, key) {
    var bag = bagNow(), it = null, i;
    for (i = 0; i < bag.items.length; i++) if (bag.items[i].key === key) it = bag.items[i];
    if (!it || !it.usable || it.qty < 1) return;
    var ty = TB.bagType(it, bag.over), g = allow(me, view, ty);
    if (!g) return;
    var rr = it.dice ? rollDice(it.dice, false) : null;
    if (it.heal && !rr) { flash('Soin illisible pour cet objet.'); paint(); return; }
    if (!budget(rr ? 1 : 0)) return;
    if (!H.bagSet(TB.setQty(bag.text, key, it.qty - 1), null)) return;
    if (g.tick) setEco(me, view, ty, 1);
    if (rr) sendRoll(me, view, it.name + (it.heal ? ' (soin)' : ''), rr, 0);
    if (it.heal && rr) bumpHp(me, rr.total, 0);
    flash(it.name + ' utilisé' + (it.heal && rr ? ' : +' + rr.total + ' PV (au plus ton maximum)' : '') + '.');
    paint();
  }
  function toggleBagType(key) {
    var bag = bagNow(), it = null, i;
    for (i = 0; i < bag.items.length; i++) if (bag.items[i].key === key) it = bag.items[i];
    if (!it) return;
    var over = {}, k;
    for (k in bag.over) if (has(bag.over, k) && (bag.over[k] === 'a' || bag.over[k] === 'b')) over[k] = bag.over[k];
    over[key] = TB.bagType(it, bag.over) === 'b' ? 'a' : 'b';
    H.bagSet(null, over);
    paint();
  }

  /* ----- onglets ----- */
  function tabGet() {
    if (curTab) return curTab;
    var v = '';
    try { v = root.localStorage.getItem(TAB_LS) || ''; } catch (e) { v = ''; }
    curTab = TB.validTab(v);
    return curTab;
  }
  function selectTab(id, focus) {
    curTab = TB.validTab(id);
    try { root.localStorage.setItem(TAB_LS, curTab); } catch (e) { /* stockage indisponible : l'onglet marche quand même */ }
    paint();
    if (focus) { var b = $('csPj') ? $('csPj').querySelector('[data-cs-tab="' + curTab + '"]') : null; if (b) { try { b.focus(); } catch (er) { /* ignoré */ } } }
  }
  function onKey(ev) {
    var t = ev.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-cs-tab')) return;
    var nx = TB.nextTab(t.getAttribute('data-cs-tab'), ev.key);
    if (!nx) return;
    ev.preventDefault();
    selectTab(nx, true);
  }
  function onChange(ev) {
    var t = ev.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-cs-slot')) return;
    slotSel[t.getAttribute('data-cs-slot')] = parseInt(t.value, 10) || 0;
    paint();
  }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-cs-hp],[data-cs-tmp],[data-cs-eco],[data-cs-roll],[data-cs-tab],[data-cs-cast],[data-cs-sdmg],[data-cs-use],[data-cs-bt],[data-cs-dk]') : null;
    if (!t) return;
    if (t.hasAttribute('data-cs-tab')) { selectTab(t.getAttribute('data-cs-tab'), false); return; }
    if (t.hasAttribute('data-cs-dk')) { try { root.tylDK.setFilter(t.getAttribute('data-cs-dk') === 'on'); } catch (er) { /* ignoré */ } paint(); return; }
    var view = cur(), e = H.entry(), me = view && e ? mineOf(view, e.id) : null;
    if (!me) return;
    /* contrôle grisé atteint quand même (clavier, lecteur d'écran) : message court, rien n'est envoyé ni consommé */
    if (t.getAttribute('aria-disabled') === 'true') { flash(TB.denyMsg(t.getAttribute('data-cs-ty'), t.getAttribute('data-cs-why'))); paint(); return; }
    if (t.disabled) return;
    if (t.hasAttribute('data-cs-hp')) bumpHp(me, parseInt(t.getAttribute('data-cs-hp'), 10) || 0, 0);
    else if (t.hasAttribute('data-cs-tmp')) bumpHp(me, 0, parseInt(t.getAttribute('data-cs-tmp'), 10) || 0);
    else if (t.hasAttribute('data-cs-eco')) toggleEco(me, view, t.getAttribute('data-cs-eco'));
    else if (t.hasAttribute('data-cs-cast')) castSpell(me, view, t.getAttribute('data-cs-cast'));
    else if (t.hasAttribute('data-cs-sdmg')) spellDmg(me, view, t.getAttribute('data-cs-sdmg'));
    else if (t.hasAttribute('data-cs-use')) useItem(me, view, t.getAttribute('data-cs-use'));
    else if (t.hasAttribute('data-cs-bt')) toggleBagType(t.getAttribute('data-cs-bt'));
    else if (t.hasAttribute('data-cs-roll')) {
      var row = t.closest('[data-cs-w]');
      doRoll(me, view, row ? parseInt(row.getAttribute('data-cs-w'), 10) || 0 : 0, t.getAttribute('data-cs-roll'));
    }
  }

  /* ----- affichage ----- */
  function pct(hp, max) { return Math.max(0, Math.min(100, Math.round(hp / Math.max(1, max) * 100))); }
  function html(view, e, me) {
    var S = H.S(), st = H.status(), h = '', act = null, i;
    var byId = {};
    view.combatants.forEach(function (c) { byId[c.id] = c; });
    act = view.act ? byId[view.act] : null;
    var kids = kidsOf(view, me), kid = act && me && act.owner === me.id ? act : null, myTurn = !!(me && act && (act.id === me.id || kid));
    var msg;
    if (view.won) msg = 'Combat terminé';
    else if (myTurn) msg = kid ? 'Ton compagnon joue : ' + kid.name : 'C\'est ton tour, ' + (me ? me.name : '') + ' !';
    else if (view.foe) msg = 'Au tour des ennemis';
    else if (act) msg = 'Au tour de ' + act.name;
    else msg = me ? 'En attente du premier tour du MJ' : 'Le combat n\'a pas commencé';
    h += '<div class="cs-pj-turn' + (myTurn ? ' me' : '') + '" role="status" aria-live="polite"><span class="cs-pj-round">Round ' + esc(view.round) + '</span> <span>' + esc(msg) + '</span></div>';
    if (st && (st.pending || st.msg)) h += '<p class="cs-pj-msg' + (st.err ? ' err' : '') + '" role="status">' + esc(st.msg || st.pending) + '</p>';
    if (!me) {
      h += '<h2>Combat</h2>';
      if (H.canJoin()) h += '<p class="muted">Un combat est préparé. Touche le bouton : ton initiative est lancée (d20 + ton bonus) et tu es ajouté à l\'ordre de jeu.</p><div class="cs-pj-row"><button type="button" class="btn primary cs-pj-big" data-pa="join">Rejoindre le combat</button></div>';
      else h += '<p class="muted">Pas de combat pour toi pour l\'instant. Cette page se met à jour toute seule.</p>';
      return h + orderHTML(view, null);
    }
    var ed = edit && now() - edit.at < 9000 ? edit : null;
    /* envoi confirmé, ou PV changés par le MJ depuis l'envoi : on affiche les PV reçus */
    if (ed && ed.sent && ((ed.hp === me.hp && ed.temp === me.temp) || me.hp !== ed.base || me.temp !== ed.bt)) { edit = null; ed = null; }
    var hp = ed ? ed.hp : me.hp, temp = ed ? ed.temp : me.temp, p = pct(hp, me.max), tab = tabGet(), body = '';
    var end = myTurn ? '<div class="cs-pj-row"><button type="button" class="btn primary cs-pj-big" data-pa="end">Terminer mon tour</button></div>' : '';
    if (tab === 'infos') {
      body += '<div class="cs-pj-me"><h2>' + esc(me.name) + '</h2><span class="muted">CA ' + esc(me.ac) + ' · Init. ' + esc(me.init) + '</span></div>';
      body += '<div class="cs-pj-hp"><div class="hpbar ' + (p <= 25 ? 'bad' : p <= 50 ? 'warn' : '') + '" role="img" aria-label="PV ' + esc(hp) + ' sur ' + esc(me.max) + '"><i style="width:' + p + '%"></i></div>' +
        '<b class="cs-hpv">' + esc(hp) + ' / ' + esc(me.max) + '</b>' + (temp ? '<span class="cs-hpt">(+' + esc(temp) + ' temp.)</span>' : '') + '</div>';
      body += '<div class="cs-pj-row" role="group" aria-label="Corriger mes PV">' + [-5, -1, 1, 5].map(function (n) {
        return '<button type="button" class="btn cs-pj-b" data-cs-hp="' + n + '" aria-label="' + (n < 0 ? 'Retirer ' + (-n) : 'Ajouter ' + n) + ' PV">' + (n < 0 ? '−' + (-n) : '+' + n) + '</button>';
      }).join('') + '</div>';
      body += '<div class="cs-pj-row" role="group" aria-label="Mes PV temporaires"><span class="cs-pj-lbl">PV temp. : ' + esc(temp) + '</span>' + [-1, 1, 5].map(function (n) {
        return '<button type="button" class="btn cs-pj-b" data-cs-tmp="' + n + '" aria-label="' + (n < 0 ? 'Retirer ' + (-n) : 'Ajouter ' + n) + ' PV temporaire' + (Math.abs(n) > 1 ? 's' : '') + '">' + (n < 0 ? '−' + (-n) : '+' + n) + '</button>';
      }).join('') + '</div>';
      if (me.conds && me.conds.length) {
        body += '<ul class="cs-pj-conds" aria-label="Mes états">' + me.conds.map(function (x) { var d = H.cdesc(x); return '<li><b>' + esc(x) + '</b>' + (d ? ' : ' + esc(d) : '') + '</li>'; }).join('') + '</ul>';
      }
      if (me.hp <= 0) {
        body += '<div class="cs-pj-ds"><b>Jets contre la mort</b> : ' + esc((me.ds || {}).s | 0) + ' réussite(s), ' + esc((me.ds || {}).f | 0) + ' échec(s) <button type="button" class="btn primary cs-pj-b" data-pa="death">Jet contre la mort</button></div>';
      }
      body += '<div class="cs-trk" data-cs-trk></div>' + end;
      if (rolls.length) {
        body += '<h3>Mes derniers jets</h3><ol class="cs-pj-rolls">' + rolls.map(function (r) { return '<li><b>' + esc(r.title) + '</b> : ' + esc(r.total) + ' <span class="muted">(' + esc(r.detail) + ')' + (r.nat === 20 ? ' · critique !' : r.nat === 1 ? ' · échec critique' : '') + '</span></li>'; }).join('') + '</ol>';
      }
      if (kids.length) body += '<ul class="cs-pj-kids" aria-label="Mes compagnons">' + kids.map(function (k) { return '<li><b>' + esc(k.name) + '</b> (compagnon) : ' + esc(k.hp) + ' / ' + esc(k.max) + ' PV</li>'; }).join('') + '</ul>';
      body += orderHTML(view, me);
    } else if (tab === 'armes') {
      var ws = H.weapons(me) || [], cx0 = cxOf(view, me), nMax = cx0.st().atkMax;
      body += '<h3>Mes armes</h3>' + (nMax > 1 ? '<p class="muted cs-note">Attaque supplémentaire : ' + esc(Math.min(cx0.st().atkN, nMax)) + ' / ' + esc(nMax) + ' attaques ce tour.</p>' : '');
      if (!ws.length) body += '<p class="muted">Aucune arme sur ta fiche.</p>';
      else body += '<ul class="cs-pj-weap">' + ws.map(function (w, j) {
        var dm = (w.parts || []).map(function (z) { return z.d + (z.t ? ' ' + z.t : ''); }).join(' + ');
        var a = TB.actBtn(cx0, { attrs: 'data-cs-roll="atk"', ty: 'a', label: 'Lancer', aria: 'Lancer l\'attaque : ' + w.n, primary: true, extra: { weapon: true } });
        var d = (w.parts || []).length ? TB.actBtn(cx0, { attrs: 'data-cs-roll="dmg"', ty: 'g', label: lastNat[j] === 20 ? 'Dégâts critiques' : 'Dégâts', aria: 'Lancer les dégâts : ' + w.n }).html : '<button type="button" class="btn cs-pj-b" data-cs-ty="g" disabled aria-disabled="true" aria-label="Pas de dégâts pour ' + esc(w.n) + '">Dégâts</button>';
        return '<li data-cs-w="' + j + '"><div class="cs-pj-wn"><b>' + esc(w.n) + '</b> <span class="cs-ty cs-ty-a" data-ty="a">Action</span><span>' + (w.b >= 0 ? '+' : '−') + Math.abs(w.b | 0) + (dm ? ' · ' + esc(dm) : '') + '</span></div>' +
          '<div class="cs-pj-wb">' + a.html + d + '</div></li>';
      }).join('') + '</ul>';
      body += end;
    } else if (tab === 'sorts') {
      body += dkBtn() + TB.spellsHTML(cxOf(view, me)) + end;
    } else {
      body += '<h3>Mon sac</h3>' + TB.bagHTML(cxOf(view, me)) + end;
    }
    var used = usedOf(me);
    var band = '<div class="cs-sticky"><div class="cs-pj-row cs-pj-eco" role="group" aria-label="Actions du tour">' + [['a', 'Action'], ['b', 'Bonus'], ['r', 'Réaction']].map(function (x) {
      var u = used[x[0]];
      return '<button type="button" class="btn cs-pj-b cs-eco' + (u ? ' used' : '') + '" data-cs-eco="' + x[0] + '" aria-pressed="' + (u ? 'true' : 'false') + '"><span>' + x[1] + '</span><small>' + (u ? 'utilisée' : 'libre') + '</small></button>';
    }).join('') + '</div>' + TB.tabsHTML(tab) + '<p class="cs-status" role="status" aria-live="polite">' + statusHTML() + '</p></div>';
    h += band;
    TB.TABS.forEach(function (t) {
      h += '<div class="cs-panel" role="tabpanel" id="csp-' + t[0] + '" aria-labelledby="cst-' + t[0] + '" tabindex="0"' + (t[0] === tab ? '' : ' hidden') + '>' + (t[0] === tab ? body : '') + '</div>';
    });
    return h;
  }
  /* ligne d'état fixe : message court (refus, sort lancé, potion) puis dernier jet */
  function statusHTML() {
    var s = note ? '<span class="cs-note-t">' + esc(note) + '</span> ' : '';
    if (rolls.length) s += '<span class="cs-last">Dernier jet : <b>' + esc(rolls[0].title) + '</b> : ' + esc(rolls[0].total) + '</span>';
    return s;
  }
  /* contexte fourni aux constructeurs d'onglets (combat-onglets.js) */
  function cxOf(view, me) {
    var memo = {}, b = bagNow(), slots = H.slotInfo ? H.slotInfo() : null, allSp = spellRows(), dv = deckOf(allSp);
    return {
      esc: esc, pend: pend, bag: { items: b.items, over: b.over }, spells: dv ? dv.rows : allSp, deck: dv ? { nom: dv.nom, on: dv.on, set: dv.set, fav: dv.fav } : null,
      st: function (extra) { return stOf(me, view, extra); },
      levels: function (r) { return levelsOf(r, memo); },
      slotPick: function (r, lv) { return lv.indexOf(slotSel[r.e]) >= 0 ? slotSel[r.e] : lv[0]; },
      noSlot: function (r) { return noSlotText(r); },
      slotsLine: slots && slots.max ? function (L) { var m = slots.max[L - 1]; return m ? '(' + slots.left[L - 1] + '/' + m + ' emplacements)' : ''; } : null
    };
  }
  function orderHTML(view, me) {
    var o = orderOf(view);
    if (!o.length) return '';
    return '<details class="cs-pj-ord"' + (view.act ? ' open' : '') + '><summary><h3>Ordre de jeu (' + o.length + ')</h3></summary><ol class="ini">' + o.map(function (x) {
      var party = typeof x.ac === 'number', st = party ? x.hp + '/' + x.max + ' PV' : wordOf(x);
      return '<li class="' + (view.act === x.id ? 'act ' : '') + (me && x.id === me.id ? 'me ' : '') + (x.hp <= 0 ? 'down' : '') + '"><span class="nm">' + esc(x.name) + (x.conds && x.conds.length ? ' <span class="muted">· ' + x.conds.map(esc).join(', ') + '</span>' : '') + '</span><span class="st">' + esc(st) + '</span></li>';
    }).join('') + '</ol></details>';
  }

  /* bouton « Mes decks » (decks.js) : vide tant que decks/cfg n'est pas actif => rendu inchangé */
  function dkBtn() { try { return root.tylDK && root.tylDK.btnHTML ? root.tylDK.btnHTML('cs') : ''; } catch (er) { return ''; } }

  function focusKey(el) {
    if (!el || !el.getAttribute) return '';
    var k = ['data-cs-hp', 'data-cs-tmp', 'data-cs-eco', 'data-pa', 'data-cs-tab', 'data-cs-cast', 'data-cs-sdmg', 'data-cs-use', 'data-cs-bt', 'data-cs-slot', 'data-cs-dk'].filter(function (a) { return el.hasAttribute(a); })[0];
    if (k) return k + '=' + el.getAttribute(k);
    if (el.hasAttribute('data-cs-roll')) { var r = el.closest('[data-cs-w]'); return 'roll=' + el.getAttribute('data-cs-roll') + '@' + (r ? r.getAttribute('data-cs-w') : ''); }
    return '';
  }
  /* le suivi des ressources (#pvTrack, app.js) vit dans l'onglet Infos quand les onglets sont là, sinon à sa place d'origine ; une seule instance */
  function trackPlace(host, tabsOn) {
    var trk = $('pvTrack'), park = $('csPark'), slot = host.querySelector('[data-cs-trk]');
    if (!trk || !park) return;
    if (!tabsOn) {
      if (host.contains(trk) && trkMark && trkMark.parentNode) trkMark.parentNode.insertBefore(trk, trkMark.nextSibling);
      return;
    }
    if (slot) { if (trk.parentNode !== slot) slot.appendChild(trk); }
    else if (trk.parentNode !== park) park.appendChild(trk);
  }
  function paint() {
    var host = $('csPj');
    if (!host || !H) return;
    var on = active(), e = on ? H.entry() : null, view = on ? cur() : null;
    doc.body.classList.toggle('cs-pj-on', !!(on && e && view));
    pbAvail(!!(on && e && view));
    if (!on || !e || !view) { trackPlace(host, false); doc.body.classList.remove('cs-pj-tabs'); host.hidden = true; return; }
    var me = mineOf(view, e.id), out = html(view, e, me), inner = $('csPjIn'), tabsOn = !!me;
    host.hidden = false;
    doc.body.classList.toggle('cs-pj-tabs', tabsOn);
    if (out !== lastHtml) {
      var key = host.contains(doc.activeElement) ? focusKey(doc.activeElement) : '';
      var trk = $('pvTrack'), park = $('csPark');
      if (trk && park && inner.contains(trk)) park.appendChild(trk);   /* le suivi ne doit pas être effacé avec l'onglet Infos */
      lastHtml = out; inner.innerHTML = out;
      if (key) {
        var cand = host.querySelectorAll('button, select'), j;
        for (j = 0; j < cand.length; j++) if (focusKey(cand[j]) === key) { try { cand[j].focus(); } catch (er) { /* ignoré */ } break; }
      }
    }
    trackPlace(host, tabsOn);
    if (tabsOn && TB && TB.decorateTrack) TB.decorateTrack($('pvTrack'), stOf(me, view));
  }

  function sync() {
    if (!H) return;
    build();
    if (isPlayer()) {
      subscribe();
      if (!scrubbed && H.loaded()) { scrubbed = true; try { H.rescrub(); } catch (e) { /* ignoré */ } }
    }
    paint();
  }


  /* =================== Panneau « Mon combat » dans le tableau plein écran ===================
     Même contenu que la page de combat : on DÉPLACE #csPj (PV, cases, armes, conditions, tour) et #pvTrack (emplacements, capacités,
     concentration) dans le panneau, puis on les remet à leur place au repli ou à la fermeture du tableau. Une seule instance, aucun
     doublon, mêmes actions (hp / roll / eco / data-pa) et mêmes validations. Le tableau n'est jamais modifié. */
  var pb = { ov: null, fab: null, panel: null, body: null, close: null, open: false, ph: null, built: false };

  function pbBuild() {
    if (pb.built) return;
    var fab = doc.createElement('button'), pan = doc.createElement('section'), head = doc.createElement('div'), h = doc.createElement('h2'), cl = doc.createElement('button'), body = doc.createElement('div');
    fab.id = 'csTbFab'; fab.type = 'button'; fab.hidden = true; fab.className = 'cs-tb-fab'; fab.textContent = 'Mon combat';
    fab.setAttribute('aria-controls', 'csTbPanel'); fab.setAttribute('aria-expanded', 'false');
    pan.id = 'csTbPanel'; pan.hidden = true; pan.className = 'cs-tb-panel'; pan.setAttribute('role', 'region'); pan.setAttribute('aria-label', 'Mon combat');
    head.className = 'cs-tb-head'; h.textContent = 'Mon combat';
    cl.id = 'csTbClose'; cl.type = 'button'; cl.className = 'cs-tb-close'; cl.textContent = 'Replier'; cl.setAttribute('aria-label', 'Replier Mon combat');
    body.id = 'csTbBody'; body.className = 'cs-tb-body';
    head.appendChild(h); head.appendChild(cl); pan.appendChild(head); pan.appendChild(body);
    fab.addEventListener('click', function () { pbSet(!pb.open, false); });
    cl.addEventListener('click', function () { pbSet(false, true); });
    /* les boutons data-pa (Terminer mon tour, Rejoindre, jet contre la mort) sont écoutés par la page joueuse : même chemin, sans le recopier */
    pan.addEventListener('click', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('[data-pa]') && H && H.pa) H.pa(ev); });
    /* Échap replie le panneau avant de fermer le tableau (écouteur posé avant celui du tableau, en capture) */
    root.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && pb.open) { ev.preventDefault(); ev.stopImmediatePropagation(); pbSet(false, true); }
    }, true);
    root.addEventListener('resize', pbPlace);
    pb.fab = fab; pb.panel = pan; pb.body = body; pb.close = cl; pb.built = true;
  }
  /* repères de mise en page : sous la barre du haut, au-dessus de la barre d'outils du tableau (mesurés, car la barre peut se replier sur 2 lignes) */
  function pbPlace() {
    if (!pb.ov) return;
    var o = pb.ov.getBoundingClientRect(), t = pb.ov.querySelector('.pb-top'), b = pb.ov.querySelector('.pb-bar');
    pb.ov.style.setProperty('--cs-tb-top', (t ? Math.max(0, t.getBoundingClientRect().bottom - o.top) : 0) + 'px');
    pb.ov.style.setProperty('--cs-tb-bot', (b ? Math.max(0, o.bottom - b.getBoundingClientRect().top) : 0) + 'px');
  }
  function pbMount() {
    if (pb.ph) return;
    pb.ph = [];
    [$('csPj'), $('pvTrack')].forEach(function (el) {
      if (!el || !el.parentNode) return;
      if (el.id === 'pvTrack' && el.closest && el.closest('#csPj')) return;   /* déjà dans l'onglet Infos : il voyage avec #csPj */
      var mark = doc.createComment('cs-tb');
      el.parentNode.insertBefore(mark, el);
      pb.ph.push({ el: el, mark: mark });
      pb.body.appendChild(el);
    });
  }
  function pbUnmount() {
    if (!pb.ph) return;
    pb.ph.forEach(function (p) {
      if (p.mark.parentNode) {
        if (!(p.el.id === 'pvTrack' && p.el.closest && p.el.closest('#csPj'))) p.mark.parentNode.insertBefore(p.el, p.mark);
        p.mark.parentNode.removeChild(p.mark);
      }
    });
    pb.ph = null;
    paint();
  }
  function pbSet(open, focusBack) {
    if (!pb.built) return;
    open = !!open && !pb.fab.hidden && !!pb.ov;
    if (open === pb.open) return;
    pb.open = open;
    pb.fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      pbPlace(); pb.panel.hidden = false; pbMount();
      try { pb.close.focus(); } catch (e) { /* ignoré */ }
    } else {
      pb.panel.hidden = true; pbUnmount();
      if (focusBack && !pb.fab.hidden) { try { pb.fab.focus(); } catch (e2) { /* ignoré */ } }
    }
  }
  /* le bouton n'existe que si la page de combat existe (joueuse, Simplifié, dans un combat) */
  function pbAvail(ok) {
    if (!pb.built || !pb.ov) return;
    pb.fab.hidden = !ok;
    if (ok) pbPlace(); else pbSet(false, false);
  }
  /* point d'entrée de tableau-joueuse.js : board(overlay) à l'ouverture, board(null) à la fermeture */
  function board(ov) {
    if (ov) {
      pbBuild();
      if (pb.ov !== ov) { pb.ov = ov; ov.appendChild(pb.fab); ov.appendChild(pb.panel); }
      if (H) { build(); paint(); }
      pbPlace();
    } else if (pb.built) {
      pbSet(false, false);
      pb.fab.hidden = true; pb.ov = null;
    }
  }

  api.bind = function (h) { H = h; };
  api.board = board;
  api.attachDb = function (db) { dbh = db; };
  api.sync = sync;
  api.poll = poll;
  api.hasView = function () { return vloaded && isObj(vdoc) && vdoc.mode === 'simple'; };
  /* vue publiée utilisable maintenant (ou null) : app.js en construit S côté joueuse */
  api.view = function () { return usable(vdoc, stAt()); };
  api._dbg = function () { return { player: isPlayer(), simple: H && H.simple(), entry: H && !!H.entry(), view: !!(H && cur()), nComb: H && H.S().combatants.length }; };
  api._state = function () { return { vdoc: vdoc, edit: edit, rolls: rolls }; };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' && globalThis.document ? globalThis : null));
