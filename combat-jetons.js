/* combat-jetons.js : jetons liés au tableau blanc (tranche T4 du Combat simplifié). ES5, sans bibliothèque.
   1. Modèle pur (testé sous Node) : un jeton = un combattant du tracker (champ cid) ; le jeton ne garde que position, couleur et lien.
      PV, états et initiative restent dans l'état de combat : le jeton les LIT (pastille, anneau, états, tour actif).
   2. Interface (navigateur) : « Placer sur le tableau » (MJ), sélection jeton <-> combattant, retrait synchronisé,
      pastilles dessinées sur le canvas (MJ et joueuse), texte équivalent pour les lecteurs d'écran.
   Secret : un jeton lié à un combattant caché (c.hid) n'est jamais projeté vers board/live (tableau-modele.project + ctx).
   Aucun texte de combattant n'est injecté en HTML sans esc() ; le canvas dessine par fillText. */
(function (root) {
  'use strict';

  var CS = (typeof module === 'object' && module && module.exports && typeof require === 'function') ? require('./combat-simple.js') : root.tylCS;
  var api = {};
  var SZ = 0.065, MAX_TOK = 60, CID_RE = /^[\w-]{1,40}$/;
  var COL_PJ = 6, COL_ALLY = 5, COL_FOE = 1;                       /* indices de la palette du tableau : bleu, turquoise, rouge */
  var RING = ['#6f6f6f', '#c0392b', '#e07b1f', '#d4a00a', '#3fa34d'];   /* anneau : à terre, presque mort, sanglant, blessé, indemne */
  var PI2 = 6.2832;

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function int(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }
  function str(v, n) { return String(v == null ? '' : v).slice(0, n); }
  function list(S) { return (S && Array.isArray(S.combatants)) ? S.combatants.filter(isObj) : []; }
  function activeOf(S) { return S ? (S.activeId != null ? S.activeId : (S.act != null ? S.act : null)) : null; }
  function bucket(hp, max) { return CS && CS.bucket ? CS.bucket(hp, max) : 4; }
  function words() { return (CS && CS.WORDS) || ['À terre', 'Presque mort', 'Sanglant', 'Blessé', 'Indemne']; }

  /* ---------- placement ---------- */
  function party(c, S) { return !!(CS && CS.isParty && CS.isParty(c, S)); }
  function tokenFor(c, S, pos) {
    if (!isObj(c) || typeof c.id !== 'string' || !CID_RE.test(c.id)) return null;
    var pj = c.kind === 'pj', pa = party(c, S), hid = !!(CS && CS.hiddenIds && CS.hiddenIds(S)[c.id]);
    var t = { t: 'token', k: pj ? 'pc' : (pa ? 'npc' : 'mob'), x: pos ? pos.x : 0.5, y: pos ? pos.y : 0.3, sz: SZ, c: pj ? COL_PJ : (pa ? COL_ALLY : COL_FOE), lb: str(c.name, 24), cid: c.id };
    if (hid) t.hid = true;
    return t;
  }
  /* Première case libre : ennemis et alliés en haut, joueuses en bas ; ar = largeur / hauteur de la feuille ; y en fraction de la hauteur. */
  function slot(cur, ar, bottom) {
    var stepX = 0.085, stepY = SZ * ar * 1.3, r, cc, x, y, i, ok, e, dx, dy;
    for (r = 0; r < 12; r++) {
      y = bottom ? 0.9 - r * stepY : 0.1 + r * stepY;
      if (y < 0.04 || y > 0.96) break;
      for (cc = 0; cc < 11; cc++) {
        x = 0.08 + cc * stepX; if (x > 0.93) break;
        ok = true;
        for (i = 0; i < cur.length; i++) {
          e = cur[i]; if (!e || e.t !== 'token') continue;
          dx = e.x - x; dy = (e.y - y) / ar;
          if (Math.sqrt(dx * dx + dy * dy) < SZ * 1.02) { ok = false; break; }
        }
        if (ok) return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
      }
    }
    return { x: 0.5, y: 0.5 };
  }
  /* Jetons à créer pour les combattants qui n'en ont pas (only = liste d'ids, ou null pour tous). Ne modifie pas els. */
  function place(els, ar, S, only) {
    var have = {}, nTok = 0, want = {}, add = [], cur = [], full = false, i, c, t, n = 0, haveN = 0, all = list(S);
    (els || []).forEach(function (e) { if (e && e.t === 'token') { nTok++; if (e.cid) have[e.cid] = 1; } cur.push(e); });
    if (only) only.forEach(function (id) { want[id] = 1; });
    for (i = 0; i < all.length; i++) {
      c = all[i];
      if (only && !want[c.id]) continue;
      if (have[c.id]) { haveN++; continue; }
      if (nTok + add.length >= MAX_TOK) { full = true; break; }
      t = tokenFor(c, S, null); if (!t) continue;
      var p = slot(cur, ar, c.kind === 'pj'); t.x = p.x; t.y = p.y;
      add.push(t); cur.push(t); n++;
    }
    return { add: add, have: haveN, full: full };
  }
  function idsToRemove(els, gone) {
    var out = [];
    (els || []).forEach(function (e) { if (e && e.t === 'token' && e.cid && Object.prototype.hasOwnProperty.call(gone, e.cid)) out.push(e.id); });
    return out;
  }
  /* Changement de visibilité d'un combattant -> jeton hid (l'état du combattant fait foi). */
  function hidChanges(els, now, before) {
    var out = [], has = Object.prototype.hasOwnProperty;
    (els || []).forEach(function (e) {
      if (!e || e.t !== 'token' || !e.cid) return;
      var a = has.call(now, e.cid), b = has.call(before || {}, e.cid);
      if (a && !b) out.push({ id: e.id, cid: e.cid, hid: true });
      else if (!a && b) out.push({ id: e.id, cid: e.cid, hid: false });
    });
    return out;
  }

  /* ---------- lecture d'un combattant pour la pastille ---------- */
  function info(c, S, mj, mineId) {
    var b = bucket(c.hp, c.max), w = words()[b], conds = (Array.isArray(c.conds) ? c.conds : []).slice(0, 20).map(function (x) { return str(x, 30); });
    var o = { id: str(c.id, 40), name: str(c.name, 60), b: b, w: w, label: mj ? int(c.hp, 0) + '/' + Math.max(1, int(c.max, 1)) : w, conds: conds,
      act: activeOf(S) === c.id, mine: !!mineId && c.id === mineId, down: int(c.hp, 0) <= 0 };
    if (mj) { o.hp = int(c.hp, 0); o.max = Math.max(1, int(c.max, 1)); o.hid = !!c.hid; }
    return o;
  }
  function altText(inf) {
    var a = [];
    if (inf.mine) a.push('ton jeton');
    a.push(inf.w);
    inf.conds.forEach(function (x) { a.push(x); });
    if (inf.act) a.push(inf.mine ? 'c\'est ton tour' : 'son tour');
    return a.join(', ');
  }
  /* Signature de ce qui se dessine sur les jetons : change seulement avec PV, états, tour, caché, sélection. */
  function sigOf(S, mineId, selId) {
    var a = list(S).map(function (c) { return [c.id, int(c.hp, 0), int(c.max, 1), c.hid ? 1 : 0, Array.isArray(c.conds) ? c.conds.join('|') : '']; });
    return JSON.stringify([a, activeOf(S), mineId || '', selId || '']);
  }

  /* ---------- dessin des pastilles (appelé par tableau-rendu.js après le jeton) ---------- */
  function drawDeco(g, e, cx, cy, r, C, inf) {
    var th = C.theme, s = C.s, dpr = C.dpr || 1, u = 1 / s, ring = Math.max(2.2 * dpr * u, r * 0.2), col = RING[inf.b] || RING[4], i, n, px, w, lx, ly, ang, bx, by, br, tx;
    g.save();
    g.lineWidth = ring; g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, r + ring / 2, 0, PI2); g.stroke();
    if (inf.down) { g.lineWidth = Math.max(2 * dpr * u, r * 0.12); g.strokeStyle = col; g.beginPath(); g.moveTo(cx - r * 0.55, cy - r * 0.55); g.lineTo(cx + r * 0.55, cy + r * 0.55); g.moveTo(cx + r * 0.55, cy - r * 0.55); g.lineTo(cx - r * 0.55, cy + r * 0.55); g.stroke(); }
    if (inf.act) { g.lineWidth = Math.max(2.4 * dpr * u, r * 0.14); g.strokeStyle = th.brass; g.beginPath(); g.arc(cx, cy, r + ring + g.lineWidth, 0, PI2); g.stroke(); }
    if (inf.mine) { g.lineWidth = Math.max(2 * dpr * u, r * 0.1); g.strokeStyle = th.primary; g.setLineDash([4 * dpr * u, 3 * dpr * u]); g.beginPath(); g.arc(cx, cy, r + ring + (inf.act ? r * 0.4 : r * 0.14), 0, PI2); g.stroke(); g.setLineDash([]); }
    if (inf.sel) { g.lineWidth = Math.max(1.6 * dpr * u, r * 0.08); g.strokeStyle = th.ink; g.setLineDash([3 * dpr * u, 3 * dpr * u]); g.beginPath(); g.arc(cx, cy, r + ring + r * 0.75, 0, PI2); g.stroke(); g.setLineDash([]); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    var X = C.ox + cx * s, Y = C.oy + cy * s, R = r * s, RR = R + ring * s;
    /* pastilles d'états : jusqu'à 3, en haut à droite ; « +N » si davantage */
    n = inf.conds.length;
    if (n) {
      br = Math.max(6 * dpr, R * 0.34);
      for (i = 0; i < Math.min(3, n); i++) {
        ang = (-55 + i * 38) * Math.PI / 180; bx = X + Math.cos(ang) * (RR + br * 0.35); by = Y + Math.sin(ang) * (RR + br * 0.35);
        tx = (i === 2 && n > 3) ? '+' + (n - 2) : (inf.conds[i] ? inf.conds[i].charAt(0).toUpperCase() : '?');
        g.beginPath(); g.arc(bx, by, br, 0, PI2); g.fillStyle = th.primary; g.fill(); g.lineWidth = Math.max(1, dpr); g.strokeStyle = th.surface; g.stroke();
        g.fillStyle = '#ffffff'; g.font = '700 ' + Math.round(br * 1.25) + 'px Alegreya Sans, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tx, bx, by + dpr * 0.5);
      }
    }
    /* tour actif : petit triangle au-dessus */
    if (inf.act) { g.fillStyle = th.brass; g.beginPath(); g.moveTo(X, Y - RR - R * 0.55); g.lineTo(X - R * 0.32, Y - RR - R * 0.95); g.lineTo(X + R * 0.32, Y - RR - R * 0.95); g.closePath(); g.fill(); }
    /* étiquette sous le jeton : PV exacts (MJ) ou mot d'état (joueuse), « Toi » pour son propre jeton */
    px = dpr * Math.max(11, Math.min(15, e.sz * (s / dpr) * 0.3));
    g.font = '700 ' + Math.round(px) + 'px Alegreya Sans, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    tx = (inf.mine ? 'Toi · ' : '') + inf.label;
    w = g.measureText(tx).width; lx = X - w / 2; ly = Y + RR + px * 0.75;
    g.globalAlpha = 0.93; g.fillStyle = th.surface; g.fillRect(lx - 4 * dpr, ly - px * 0.65, w + 8 * dpr, px * 1.3);
    g.globalAlpha = 1; g.lineWidth = Math.max(1, dpr); g.strokeStyle = col; g.strokeRect(lx - 4 * dpr, ly - px * 0.65, w + 8 * dpr, px * 1.3);
    g.fillStyle = th.ink; g.fillText(tx, lx, ly + dpr * 0.5);
    g.restore();
  }

  api.SZ = SZ; api.MAX_TOK = MAX_TOK; api.RING = RING;
  api.tokenFor = tokenFor; api.place = place; api.idsToRemove = idsToRemove; api.hidChanges = hidChanges;
  api.info = info; api.altText = altText; api.sigOf = sigOf; api.slot = slot;
  api.drawDeco = drawDeco;

  /* Contexte de projection vers board/live (appelé par tableau.js) : cachés retirés ; cid conservé seulement en Simplifié. */
  api.projCtx = function () {
    var S = H ? H.S() : null;
    if (!H || !S || !H.loaded()) return H ? { dropLinked: true, keepCid: false } : null;
    var simple = !!H.simple();
    return { hiddenCids: CS && CS.hiddenIds ? CS.hiddenIds(S) : {}, keepCid: simple };
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.tylTK = api;
  var H = null;
  if (!root || !root.document) return;

  /* =================== Interface (navigateur) =================== */
  var doc = root.document;
  var asked = false, ui = { built: false }, sel = '', known = null, hidKnown = null, lastSig = '', hasTok = null, msgT = 0, busy = false;
  function $(id) { return doc.getElementById(id); }
  function getS() { return H ? H.S() : null; }
  function isMj() { return !!H && H.role() !== 'joueur'; }
  function on() { return !!H && H.loaded() && !!H.simple(); }
  function link() { return root.tylBoard && root.tylBoard.link ? root.tylBoard.link : null; }
  function byId(id) { var a = list(getS()), i; for (i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }

  /* point d'entrée de tableau-rendu.js : pastille d'un jeton lié (MJ : C.mj, joueuse : sinon) */
  api.deco = function (g, e, cx, cy, r, C) {
    var S = getS(); if (!H || !e || !e.cid || !on()) return;
    var c = null, a = list(S), i;
    for (i = 0; i < a.length; i++) if (a[i].id === e.cid) { c = a[i]; break; }
    if (!c) return;
    var inf = info(c, S, !!C.mj, H.mine ? H.mine() : '');
    inf.sel = !!C.mj && sel === c.id;
    drawDeco(g, e, cx, cy, r, C, inf);
  };
  api.alt = function (cid) {
    var S = getS(), c;
    if (!H || !cid || !on()) return '';
    c = byId(cid); if (!c) return '';
    return altText(info(c, S, false, H.mine ? H.mine() : ''));
  };

  function msg(t) {
    var m = $('tkMsg'); if (!m) return;
    m.textContent = t || ''; clearTimeout(msgT);
    if (t) msgT = setTimeout(function () { m.textContent = ''; }, 6000);
  }
  function plural(n, a, b) { return n + ' ' + (n > 1 ? b : a); }

  function build() {
    if (ui.built) return;
    var q = $('csQuick'); if (!q) return;
    ui.built = true;
    var r = doc.createElement('div');
    r.className = 'cs-row tk-row'; r.id = 'tkRow';
    r.innerHTML = '<button type="button" class="btn" id="tkAll">Tout placer sur le tableau</button><button type="button" class="btn" id="tkOpen">Ouvrir le tableau</button>' +
      '<button type="button" class="btn" id="tkClean" hidden>Retirer les jetons orphelins</button><span class="cs-hint tk-msg" id="tkMsg" role="status" aria-live="polite"></span>';
    q.appendChild(r);
    $('tkAll').addEventListener('click', function () { placeOnBoard(null); });
    $('tkOpen').addEventListener('click', function () { var b = $('boardBtn'); if (b && !b.hidden) b.click(); else msg('Le tableau n\'est pas disponible.'); });
    $('tkClean').addEventListener('click', clean);
    var le = $('list');
    if (le) le.addEventListener('click', function (e) {
      var t = e.target, b = t.closest ? t.closest('[data-tkn]') : null, li = t.closest ? t.closest('li.card[data-id]') : null;
      if (b && li) { var id = li.getAttribute('data-id'); if (b.getAttribute('data-tkn') === 'put') placeOnBoard([id]); else pick(id, true); return; }
      if (li && !(t.closest && t.closest('button, input, select, textarea, a, summary, label'))) pick(li.getAttribute('data-id'), false);
    });
  }

  /* Cartes du tracker : bouton « Placer sur le tableau » / « Voir sur le tableau », surbrillance de la carte choisie */
  api.decorate = function (listEl) {
    if (!H || !listEl || !isMj() || !on()) return;
    Array.prototype.forEach.call(listEl.querySelectorAll('li.card[data-id]'), function (li) {
      var id = li.getAttribute('data-id'), tools = li.querySelector('.tools'), placed = hasTok && hasTok[id];
      if (tools) {
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'btn sm tk-btn'; b.setAttribute('data-tkn', placed ? 'see' : 'put');
        b.textContent = placed ? 'Voir sur le tableau' : 'Placer sur le tableau';
        b.title = placed ? 'Ouvre le tableau sur le jeton de ce combattant' : 'Pose un jeton lié à ce combattant sur le tableau';
        tools.insertBefore(b, tools.firstChild);
      }
      if (id === sel) { li.classList.add('tk-sel'); li.setAttribute('aria-current', 'true'); }
    });
  };

  /* ---------- actions MJ ---------- */
  function refreshHas(L) {
    var c = L ? L.cids() : null, h = null, i;
    if (c) { h = {}; for (i = 0; i < c.length; i++) h[c[i]] = 1; }
    hasTok = h;
    if (ui.built) {
      var ids = {}, orphans = 0; list(getS()).forEach(function (x) { ids[x.id] = 1; });
      if (c) c.forEach(function (x) { if (!ids[x]) orphans++; });
      $('tkClean').hidden = !orphans;
      $('tkClean').textContent = 'Retirer ' + plural(orphans, 'jeton orphelin', 'jetons orphelins');
    }
  }
  function placeOnBoard(only) {
    var L = link(), S = getS();
    if (!L || !S) { msg('Le tableau n\'est pas encore chargé : réessaie dans un instant.'); return Promise.resolve(0); }
    if (busy) return Promise.resolve(0);
    busy = true;
    var res = { add: 0, have: 0, full: false, name: '' };
    return L.edit(function (X) {
      var r = place(X.els, X.ar, S, only);
      r.add.forEach(function (t) { if (X.add(t)) res.add++; });
      res.have = r.have; res.full = r.full; res.name = X.name;
      return true;
    }).then(function (ok) {
      busy = false;
      if (ok === null || ok === undefined) { msg('Tableau indisponible (réseau ou droits).'); return 0; }
      refreshHas(L);
      if (res.full) msg('Limite de ' + MAX_TOK + ' jetons atteinte' + (res.add ? ' : ' + plural(res.add, 'jeton posé', 'jetons posés') + '.' : '.'));
      else if (!res.add) msg(only && only.length === 1 ? 'Ce combattant a déjà son jeton.' : 'Tous les combattants ont déjà un jeton.');
      else msg(plural(res.add, 'jeton posé', 'jetons posés') + ' sur « ' + res.name + ' ».');
      H.render();
      return res.add;
    }, function () { busy = false; msg('Tableau indisponible (réseau ou droits).'); return 0; });
  }

  function clean() {
    var L = link(); if (!L) return;
    var ids = {}, gone = {}, n = 0; list(getS()).forEach(function (x) { ids[x.id] = 1; });
    (L.cids() || []).forEach(function (x) { if (!ids[x]) { gone[x] = 1; n++; } });
    if (!n) return;
    L.sweep(gone).then(function () { refreshHas(L); msg(plural(n, 'jeton orphelin retiré', 'jetons orphelins retirés') + '.'); H.render(); });
  }

  /* ---------- sélection combattant <-> jeton ---------- */
  function strip() {
    var st = $('tbStage'), s = $('tkInfo');
    if (!st) return null;
    if (!s) {
      s = doc.createElement('div'); s.id = 'tkInfo'; s.className = 'tk-info'; s.hidden = true; s.setAttribute('role', 'status'); s.setAttribute('aria-live', 'polite');
      s.innerHTML = '<span class="tk-i-txt" id="tkInfoTxt"></span><button type="button" class="tb-btn" id="tkSee">Voir la fiche</button>';
      ['pointerdown', 'pointermove', 'pointerup', 'wheel'].forEach(function (ev) { s.addEventListener(ev, function (x) { x.stopPropagation(); }); });
      st.appendChild(s);
      $('tkSee').addEventListener('click', function () { if (root.tylBoard) root.tylBoard.close(); setTimeout(function () { showCard(sel); }, 60); });
    }
    return s;
  }
  function updateStrip() {
    var s = $('tkInfo') || (sel ? strip() : null);
    if (!s) return;
    var c = sel ? byId(sel) : null;
    if (!c || !isMj()) { s.hidden = true; return; }
    var inf = info(c, getS(), true, '');
    $('tkInfoTxt').textContent = c.name + ' · PV ' + inf.hp + '/' + inf.max + ' (' + inf.w + ')' + (inf.conds.length ? ' · ' + inf.conds.join(', ') : '') + (inf.act ? ' · tour en cours' : '') + (inf.hid ? ' · caché' : '');
    s.hidden = false;
  }
  function showCard(id) {
    var li = id ? doc.querySelector('#list li.card[data-id="' + id.replace(/[^\w-]/g, '') + '"]') : null;
    if (li && li.scrollIntoView) { try { li.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { li.scrollIntoView(); } }
  }
  /* toucher une carte (ou « Voir sur le tableau ») : sélectionne le combattant et le jeton lié */
  function pick(id, open) {
    if (!on() || !isMj() || !id) return;
    sel = id;
    var L = link(); if (L) L.select(id);
    markCards(); lastSig = ''; sync();
    if (open) { var b = $('boardBtn'); if (b && !b.hidden) b.click(); }
  }
  function markCards() {
    Array.prototype.forEach.call(doc.querySelectorAll('#list li.card'), function (li) {
      var is = li.getAttribute('data-id') === sel;
      li.classList.toggle('tk-sel', is); if (is) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
    });
  }
  /* point d'entrée de tableau.js : jeton lié touché sur le tableau */
  /* point d'entrée de tableau.js : le tableau vient de s'ouvrir -> bandeau d'info et jeton du combattant déjà choisi */
  api.onOpen = function () {
    if (!on() || !isMj()) return;
    strip();
    var L = link(); if (L && sel) L.select(sel);
    updateStrip();
  };
  api.onPick = function (cid) {
    if (!on() || !isMj()) return;
    sel = cid && byId(cid) ? cid : '';
    markCards(); lastSig = ''; sync(); updateStrip();
    var s = strip(); if (s) updateStrip();
  };

  /* ---------- synchronisation après chaque rendu ---------- */
  function redrawBoards() {
    var L = link(); if (L && isMj()) L.redraw();
    if (!isMj() && root.tylBoardPlayer && root.tylBoardPlayer.redraw) root.tylBoardPlayer.redraw();
  }
  function keys(o) { return Object.keys(o); }
  function diffMj(S) {
    var ids = {}, hs = CS && CS.hiddenIds ? CS.hiddenIds(S) : {}, gone = {}, ng = 0, flips = false, L = link(), i;
    list(S).forEach(function (c) { ids[c.id] = 1; });
    if (known === null) { known = ids; hidKnown = hs; return; }
    keys(known).forEach(function (k) { if (!ids[k]) { gone[k] = 1; ng++; } });
    for (i in hs) { if (Object.prototype.hasOwnProperty.call(hs, i) && !hidKnown[i]) flips = true; }
    for (i in hidKnown) { if (Object.prototype.hasOwnProperty.call(hidKnown, i) && !hs[i]) flips = true; }
    var before = hidKnown;
    known = ids; hidKnown = hs;
    if (!L) return;
    if (ng) L.sweep(gone).then(function () { refreshHas(L); H.render(); });
    if (flips) {
      var nowHid = hs;
      L.edit(function (X) {
        var ch = hidChanges(X.els, nowHid, before), pre = X.snap();
        ch.forEach(function (c) { var i2, e; for (i2 = 0; i2 < X.els.length; i2++) { e = X.els[i2]; if (e.id === c.id) { if (c.hid) e.hid = true; else delete e.hid; } } });
        if (ch.length) X.done(pre);
        return true;
      }).then(function () { L.touchLive(!!keys(nowHid).length && flipHide(before, nowHid)); });
    }
  }
  function flipHide(before, now) { var k; for (k in now) { if (Object.prototype.hasOwnProperty.call(now, k) && !before[k]) return true; } return false; }

  function sync() {
    if (!H) return;
    var S = getS(), enabled = on(), mj = isMj();
    if (!enabled) { known = null; hidKnown = null; if (ui.built) $('tkRow').hidden = true; return; }
    if (mj) {
      build();
      if (ui.built) $('tkRow').hidden = false;
      var L = link();
      if (L && !asked) { asked = true; L.ready().then(function () { refreshHas(L); }); }
      diffMj(S);
      if (L && L.cids()) refreshHas(L);
      if (sel && !byId(sel)) { sel = ''; markCards(); }
    }
    var sg = sigOf(S, H.mine ? H.mine() : '', sel);
    if (sg !== lastSig) { lastSig = sg; redrawBoards(); if (mj) updateStrip(); }
  }
  api.sync = sync;

  api.bind = function (h) { H = h; };
  api._state = function () { return { sel: sel, has: hasTok, known: known ? keys(known) : null }; };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' && globalThis.document ? globalThis : null));
