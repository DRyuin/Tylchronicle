/* tableau.js : tableau blanc partagé, côté MJ (tranches T1 et T2). ES5, sans bibliothèque.
   Modèle pur (testé sous Node) + rendu Canvas 2D + sauvegarde temporisée.
   Le MJ écrit boardmj (tout) et board/live (visible seulement) ; les traits en cours passent par la diffusion
   éphémère « tyl-board » (aucune écriture par point). Aucun HTML construit à partir d'un texte saisi. */
(function (root) {
  'use strict';

  var M = (typeof module === 'object' && module && module.exports && typeof require === 'function') ? require('./tableau-modele.js') : root.tylBoardModel;
  if (!M) return;
  var LIM = M.LIM, IMG_TRIES = M.IMG_TRIES, normEl = M.normEl, newId = M.newId, validateBoard = M.validateBoard, project = M.project, hiddenLive = M.hiddenLive,
    strokeFromPoints = M.strokeFromPoints, hitTest = M.hitTest, imgBox = M.imgBox, elBox = M.elBox, makeHistory = M.makeHistory,
    sniffType = M.sniffType, fitSize = M.fitSize, imgVerdict = M.imgVerdict, liveMsg = M.liveMsg;
  var api = {};
  Object.keys(M).forEach(function (k) { api[k] = M[k]; });


  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (!root || !root.document) return;

  /* =================== Interface (navigateur) =================== */
  var doc = root.document;
  var PAL = [null, '#d9453b', '#e07b1f', '#d4a00a', '#3fa34d', '#1fa8a0', '#3b82d6', '#8e5bd0', '#d6579b', '#9a6b3f', '#8a918c', null];
  var PAL_N = ['Encre', 'Rouge', 'Orange', 'Jaune', 'Vert', 'Turquoise', 'Bleu', 'Violet', 'Rose', 'Brun', 'Gris', 'Laiton'];
  var THICK = [0.004, 0.008, 0.016], THICK_N = ['Fin', 'Moyen', 'Épais'];
  var LS_PREF = 'tylchronicle-board-v1';
  var $ = function (id) { return doc.getElementById(id); };

  var TAB = M.newId(), LIVE_GAP = 2500, RETRY = [5000, 15000, 60000], FATAL = /22023|42501|invalid_argument|permission/i;
  var S = { open: false, down: false, fails: 0, lastW: '', lastLive: 0, liveLate: false, unLive: null, annc: M.makeAnnounceLimiter(), imgFail: {}, mq: null, built: false, bid: '', board: null, exists: false, rv: 0, lrv: 0, shown: false, dirty: false, saveT: 0, lastSave: 0, saving: false, again: false,
    tool: 'select', color: 0, th: 1, sel: null, hideId: null, hist: makeHistory(LIM.undo), pre: null, drag: null, ptr: {}, gest: null, stroke: null,
    view: { z: 1, ox: 0, oy: 0 }, ren: { z: 1, ox: 0, oy: 0 }, Wf: 100, SW: 100, SH: 100, dpr: 1, imgs: {}, imgOrder: [], busy: false, opener: null,
    svc: null, unsub: null, unPing: null, cache: {}, liveBid: '', newHid: false, ext: null, pings: M.makePingBook(), pingT: 0, msgT: 0, clrT: 0, rafId: 0, needS: false, needL: false, commitT: 0, theme: null, liveT: 0, liveSent: 0 };

  function enabled() { return !(root.TYL_CONFIG && root.TYL_CONFIG.board === false); }
  function refreshButton() { var b = $('boardBtn'); if (b) b.hidden = !enabled(); }

  function build() {
    if (S.built) return;
    var ov = doc.createElement('div'); ov.id = 'tbOv'; ov.hidden = true; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Tableau partagé');
    var sw = '', i;
    for (i = 0; i < 12; i++) sw += '<button type="button" class="tb-btn tb-sw" data-tbc="' + i + '" aria-pressed="false" aria-label="Couleur ' + PAL_N[i] + '"><i data-tbi="' + i + '"></i></button>';
    ov.innerHTML = '<div class="tb-top"><button type="button" class="tb-btn" id="tbClose" aria-label="Fermer le tableau">✕ Fermer</button><span class="tb-name" id="tbName"></span><span class="tb-status" id="tbStatus" role="status" aria-live="off"></span>' +
      '<button type="button" class="tb-btn tb-primary" id="tbShow" aria-pressed="false">Montrer aux joueuses</button></div>' +
      '<div class="tb-stage" id="tbStage" tabindex="-1"><canvas id="tbCv"></canvas><canvas id="tbLv"></canvas></div>' +
      '<p class="tb-msg" id="tbMsg" role="status" aria-live="polite"></p><div class="tb-down" id="tbDown" hidden><button type="button" class="tb-btn tb-primary" id="tbRetry">Réessayer</button></div>' +
      '<div class="tb-bar" role="toolbar" aria-label="Outils du tableau"><div class="tb-row" id="tbTools">' +
      '<button type="button" class="tb-btn" data-tbtool="select" aria-pressed="true">✥ Choisir</button><button type="button" class="tb-btn" data-tbtool="pen" aria-pressed="false">✎ Stylo</button><button type="button" class="tb-btn" data-tbtool="erase" aria-pressed="false">⌫ Gomme</button>' +
      '<button type="button" class="tb-btn" id="tbImg">🖼 Image</button><button type="button" class="tb-btn" id="tbPaste" hidden>📋 Coller</button></div>' +
      '<div class="tb-row" id="tbOpts" hidden>' + sw + '<button type="button" class="tb-btn" data-tbth="0" aria-pressed="false">Fin</button><button type="button" class="tb-btn" data-tbth="1" aria-pressed="true">Moyen</button><button type="button" class="tb-btn" data-tbth="2" aria-pressed="false">Épais</button></div>' +
      '<div class="tb-row" id="tbActs"><button type="button" class="tb-btn" id="tbUndo" disabled>↶ Annuler</button><button type="button" class="tb-btn" id="tbRedo" disabled>↷ Rétablir</button>' +
      '<button type="button" class="tb-btn" id="tbDel" disabled>🗑 Supprimer</button>' +
      '<button type="button" class="tb-btn" id="tbZout" aria-label="Zoom arrière">−</button><button type="button" class="tb-btn" id="tbFit">Ajuster</button><button type="button" class="tb-btn" id="tbZin" aria-label="Zoom avant">+</button><button type="button" class="tb-btn" id="tbClrPing">Effacer les pings</button><button type="button" class="tb-btn" id="tbClear">Tout effacer</button></div></div>' +
      '<input type="file" id="tbFile" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden>';
    doc.body.appendChild(ov);
    S.built = true;
    for (i = 0; i < 12; i++) { var d = ov.querySelector('[data-tbi="' + i + '"]'); if (d) d.style.background = i === 0 ? 'var(--ink)' : i === 11 ? 'var(--brass)' : PAL[i]; }
    if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.read === 'function') $('tbPaste').hidden = false;
    wire();
  }

  function msg(t, err, keep) {
    var m = $('tbMsg'); if (!m) return;
    m.textContent = t || ''; m.className = 'tb-msg' + (err ? ' err' : '');
    clearTimeout(S.msgT);
    if (t && !keep) S.msgT = setTimeout(function () { m.textContent = ''; }, err ? 9000 : 5000);
  }
  function announce(t) { if (S.annc.take(Date.now())) msg(t); }
  function status(t) { var s = $('tbStatus'); if (s) s.textContent = t; }

  /* ---------- Géométrie ---------- */
  function layout() {
    var st = $('tbStage'), r = st.getBoundingClientRect(), ar = S.board.ar, cv = $('tbCv'), lv = $('tbLv');
    S.SW = Math.max(50, r.width); S.SH = Math.max(50, r.height);
    S.Wf = Math.max(40, Math.min(S.SW - 16, (S.SH - 16) * ar));
    S.dpr = Math.min(root.devicePixelRatio || 1, 2);
    var k = Math.min(1, 2048 / (Math.max(S.SW, S.SH) * S.dpr));
    S.dpr = S.dpr * k;
    cv.width = lv.width = Math.max(1, Math.round(S.SW * S.dpr)); cv.height = lv.height = Math.max(1, Math.round(S.SH * S.dpr));
  }
  function fitView() { S.view = { z: 1, ox: (S.SW - S.Wf) / 2, oy: (S.SH - S.Wf / S.board.ar) / 2 }; commitView(); }
  function toNorm(cx, cy) {
    var r = $('tbStage').getBoundingClientRect(), v = S.view, ar = S.board.ar;
    return { x: (cx - r.left - v.ox) / (S.Wf * v.z), y: (cy - r.top - v.oy) / (S.Wf * v.z / ar) };
  }
  function toScreen(nx, ny) {
    var r = $('tbStage').getBoundingClientRect(), v = S.view, ar = S.board.ar;
    return { x: r.left + v.ox + nx * S.Wf * v.z, y: r.top + v.oy + ny * (S.Wf * v.z / ar) };
  }
  function commitView() {
    S.ren = { z: S.view.z, ox: S.view.ox, oy: S.view.oy };
    $('tbCv').style.transform = ''; $('tbLv').style.transform = '';
    S.needS = true; S.needL = true; frame();
  }
  function previewView() {
    var s = S.view.z / S.ren.z, tx = S.view.ox - S.ren.ox * s, ty = S.view.oy - S.ren.oy * s, t = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    $('tbCv').style.transform = t; $('tbLv').style.transform = t;
  }
  function zoomAt(f, cx, cy) {
    var z0 = S.view.z, z1 = Math.max(0.5, Math.min(8, z0 * f)), k = z1 / z0;
    S.view = { z: z1, ox: cx - (cx - S.view.ox) * k, oy: cy - (cy - S.view.oy) * k };
  }

  /* ---------- Rendu ---------- */
  function frame() { if (!S.rafId) S.rafId = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { S.rafId = 0; paint(); }); }
  function themeColors() {
    var cs = root.getComputedStyle(doc.documentElement), g = function (n, d) { var v = cs.getPropertyValue(n); return v ? v.replace(/^\s+|\s+$/g, '') : d; };
    return { ink: g('--ink', '#1d2924'), brass: g('--brass', '#a97514'), surface: g('--surface', '#fbfaf4'), line: g('--line', '#dad5c1'), primary: g('--primary', '#2e5b4e') };
  }
  function colorOf(c) {
    if (typeof c === 'string') return c;
    if (c === 0) return S.theme.ink;
    if (c === 11) return S.theme.brass;
    return PAL[c] || S.theme.ink;
  }
  function setUnits(g) { var s = S.dpr * S.ren.z * S.Wf; g.setTransform(s, 0, 0, s, S.dpr * S.ren.ox, S.dpr * S.ren.oy); }
  function getImg(a) {
    var id = a.slice(2), o = S.imgs[id];
    if (o) return o;
    o = S.imgs[id] = { im: new root.Image(), ok: false, err: false };
    S.imgOrder.push(id);
    if (S.imgOrder.length > LIM.imgs + LIM.tokens + 8) { var old = S.imgOrder.shift(); if (old !== id) delete S.imgs[old]; }
    o.im.onload = function () { o.ok = true; S.needS = true; frame(); };
    /* Échec réseau : jusqu'à 2 nouveaux essais (5 s puis 20 s) en oubliant l'entrée ; le dessin la recrée. */
    o.im.onerror = function () {
      var n = S.imgFail[id] || 0;
      o.err = true;
      if (n < 2) { S.imgFail[id] = n + 1; setTimeout(function () { if (S.imgs[id] === o && S.open) { forgetImg(id); S.needS = true; frame(); } }, n === 0 ? 5000 : 20000); }
      S.needS = true; frame();
    };
    try { o.im.crossOrigin = 'anonymous'; } catch (e) { /* ignoré */ }
    o.im.src = (root.TYL_BLOB || '/_blob/') + id.replace(/[^\w-]/g, '');
    return o;
  }
  function forgetImg(id) {
    var o = S.imgs[id], i = S.imgOrder.indexOf(id);
    if (i >= 0) S.imgOrder.splice(i, 1);
    if (o) { o.im.onload = o.im.onerror = null; try { o.im.src = ''; } catch (e) { /* ignoré */ } }
    delete S.imgs[id];
  }
  /* Ne garde en mémoire que les images du tableau courant (téléphone : mémoire décodée limitée). */
  function pruneImgs() {
    var keep = {}, k;
    if (S.board) S.board.els.forEach(function (e) { if (typeof e.a === 'string') keep[e.a.slice(2)] = 1; });
    for (k in S.imgs) { if (Object.prototype.hasOwnProperty.call(S.imgs, k) && !keep[k]) forgetImg(k); }
  }
  var R = null;
  function ctxR() { return { colorOf: colorOf, theme: S.theme, img: getImg, s: S.dpr * S.ren.z * S.Wf, ox: S.dpr * S.ren.ox, oy: S.dpr * S.ren.oy, mj: true, dpr: S.dpr, deco: root.tylTK && root.tylTK.deco }; }
  function drawEl(g, e, ar) { R = R || root.tylBoardDraw; if (!R) return; R.drawEl(g, e, ar, ctxR()); }
  function paintStatic() {
    var cv = $('tbCv'), g = cv.getContext('2d'), bd = S.board, ar = bd.ar, els = bd.els, i, t0 = S.ren;
    S.theme = themeColors();
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    setUnits(g);
    g.fillStyle = bd.bg || S.theme.surface; g.fillRect(0, 0, 1, 1 / ar);
    g.strokeStyle = S.theme.line; g.lineWidth = 1 / (S.Wf * t0.z); g.strokeRect(0, 0, 1, 1 / ar);
    g.save(); g.beginPath(); g.rect(0, 0, 1, 1 / ar); g.clip();
    for (i = 0; i < els.length; i++) { if (els[i].id !== S.hideId) drawEl(g, els[i], ar); }
    g.restore();
  }
  function paintLive() {
    var lv = $('tbLv'), g = lv.getContext('2d'), ar = S.board.ar, k = 1 / ar, e, b, i, p, hs = 7 / (S.Wf * S.ren.z);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, lv.width, lv.height);
    setUnits(g);
    g.save(); g.beginPath(); g.rect(0, 0, 1, k); g.clip();
    if (S.hideId) { e = elById(S.hideId); if (e) drawEl(g, e, ar); }
    if (S.stroke && S.stroke.pts.length) {
      p = S.stroke.pts; g.strokeStyle = colorOf(S.stroke.c); g.lineWidth = S.stroke.th; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(p[0][0], p[0][1] * k);
      for (i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1] * k);
      if (p.length === 1) g.lineTo(p[0][0] + 0.0001, p[0][1] * k);
      g.stroke();
    }
    g.restore();
    e = S.sel ? elById(S.sel) : null;
    if (e) {
      b = elBox(e, ar);
      g.strokeStyle = S.theme.brass; g.lineWidth = 2 / (S.Wf * S.ren.z); g.setLineDash([6 / (S.Wf * S.ren.z), 4 / (S.Wf * S.ren.z)]);
      g.strokeRect(b.x, b.y * k, b.w, b.h * k); g.setLineDash([]);
      if (e.t === 'img') {
        g.fillStyle = S.theme.brass; g.strokeStyle = S.theme.surface; g.lineWidth = 1.5 / (S.Wf * S.ren.z);
        [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(function (c) { g.fillRect(c[0] - hs, c[1] * k - hs, 2 * hs, 2 * hs); g.strokeRect(c[0] - hs, c[1] * k - hs, 2 * hs, 2 * hs); });
      }
    }
    if (S.ext) S.ext.paintLive(g);
    drawPings(g);
  }
  /* ---------- Pings des joueuses (diffusion éphémère, 5 s) ---------- */
  function reduced() { try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function drawPings(g) {
    var now = Date.now(), l = S.pings.list(now), i, e, k = S.dpr, sc = S.Wf * S.ren.z, ar = S.board.ar;
    if (!l.length) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (i = 0; i < l.length; i++) {
      e = l[i];
      M.drawPing(g, (S.ren.ox + e.x * sc) * k, (S.ren.oy + e.y * sc / ar) * k, now - e.t, e.n, { dpr: k, reduced: reduced(), brass: S.theme.brass, ink: S.theme.ink, surface: S.theme.surface });
    }
  }
  function pingTick() {
    clearTimeout(S.pingT); S.pingT = 0;
    if (!S.open) return;
    redraw(false);
    if (S.pings.list(Date.now()).length) S.pingT = setTimeout(pingTick, reduced() ? 500 : 60);
  }
  function onPing(m) {
    var v = M.validPing(m && m.data), e, t;
    if (!v) return;
    e = S.pings.add(v, (m && (m.by || m.peer)) || '', Date.now());
    if (!e) return;
    if (v.b && v.b !== S.bid) { S.pings.forget(e); t = 'Ping de ' + e.n + ' sur le tableau montré'; status(t); announce(t); return; }
    status('Ping de ' + e.n); announce('Ping de ' + e.n);
    pingTick();
  }
  function clearPings() {
    S.pings.clear();
    try { if (S.svc && S.svc.bc) S.svc.bc.emit('clr', {}); } catch (e) { /* ignoré */ }
    msg('Pings effacés chez tout le monde.');
    pingTick();
  }
  function paint() { if (!S.open) return; if (S.needS) { S.needS = false; paintStatic(); } if (S.needL) { S.needL = false; paintLive(); } }
  function redraw(all) { if (all) S.needS = true; S.needL = true; frame(); }

  /* ---------- Éléments ---------- */
  function elById(id) { var l = S.board.els, i; for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function snap() { return JSON.stringify(S.board.els); }
  function commitHist(pre) { if (pre !== null && pre !== snap()) { S.hist.push(pre); markDirty(); syncUi(); return true; } return false; }
  function totalPts() { var n = 0; S.board.els.forEach(function (e) { if (e.pts) n += e.pts.length / 2; }); return n; }
  function addEl(raw) {
    var e = normEl(raw), bd = S.board, n = 0;
    if (!e) return false;
    if (S.newHid) e.hid = true;
    if (e.t === 'text' || e.t === 'token') {
      bd.els.forEach(function (x) { if (x.t === e.t) n++; });
      if (n >= (e.t === 'text' ? LIM.texts : LIM.tokens)) { msg('Limite de ' + (e.t === 'text' ? LIM.texts + ' textes' : LIM.tokens + ' jetons') + ' atteinte.', true); return false; }
      n = 0;
    }
    if (bd.els.length >= LIM.els) { msg('Limite de ' + LIM.els + ' éléments atteinte : supprime-en avant d\'en ajouter.', true); return false; }
    if (e.t === 'img') { bd.els.forEach(function (x) { if (x.t === 'img') n++; }); if (n >= LIM.imgs) { msg('Limite de ' + LIM.imgs + ' images atteinte.', true); return false; } }
    if (e.pts && totalPts() + e.pts.length / 2 > LIM.totalPts) { msg('Trop de points dans ce tableau : efface des traits.', true); return false; }
    var pre = snap();
    while (elById(e.id)) e.id = newId();
    e.z = bd.els.length;
    bd.els.push(e);
    S.hist.push(pre); markDirty(); syncUi();
    return true;
  }
  function delEl(id) {
    var l = S.board.els, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); if (S.sel === id) S.sel = null; for (i = 0; i < l.length; i++) l[i].z = i; return true; }
    return false;
  }

  /* ---------- Sauvegarde temporisée : boardmj 1 s, live 2,5 s au plus (les traits arrivent déjà en direct) ---------- */
  function markDirty() { S.dirty = true; status('Modifié…'); schedule(); }
  function schedule() {
    clearTimeout(S.saveT);
    var now = Date.now(), w = S.dirty ? Math.max(1000, S.lastSave + 1000 - now) : 0;
    if (!S.dirty && S.liveLate) w = Math.max(200, S.lastLive + LIVE_GAP - now);
    S.saveT = setTimeout(function () { flush(false); }, w);
  }
  function flush(force) {
    clearTimeout(S.saveT);
    if (!S.svc || !S.svc.db || !S.board) return Promise.resolve();
    if (S.saving) { S.again = true; return Promise.resolve(); }
    var needBoard = S.dirty || !S.exists, urgent = S.liveDirty, late = S.liveLate;
    if (!needBoard && !urgent && !late) return Promise.resolve();
    var db = S.svc.db, jobs = [], data, now = Date.now(), wroteLive = false;
    if (needBoard) {
      data = validateBoard(S.board).board; data.rv = S.rv + 1; data.upd = now; data.w = TAB;
      if (M.utf8Len(JSON.stringify(data)) * 1.15 > LIM.doc - 20000) { status('Trop lourd'); msg('Tableau trop lourd pour être enregistré : supprime des éléments.', true); S.dirty = false; return Promise.resolve(); }
      jobs.push(db.doc('boardmj/' + S.bid).set(data)); S.cache[S.bid] = data;
    }
    if (S.shown && (needBoard || urgent || late)) {
      if (!force && !urgent && now - S.lastLive < LIVE_GAP) S.liveLate = true;   /* différé : écriture groupée dans ≤ 2,5 s */
      else {
        var ld = project(S.board, S.bid, S.shownAt || now, linkCtx());
        wroteLive = true; S.lastLive = now; S.liveLate = false;
        if (M.utf8Len(JSON.stringify(ld)) * 1.15 > LIM.live - 10000) { S.shown = false; S.liveBid = ''; msg('Trop lourd pour être montré aux joueuses (500 Ko maximum) : le tableau a été caché. Supprime des éléments.', true); syncUi(); S.lrv++; jobs.push(db.doc('board/live').set(hiddenLive(S.lrv))); }
        else { S.lrv++; ld.rv = S.lrv; jobs.push(db.doc('board/live').set(ld)); }
      }
    }
    else if (urgent) { S.lrv++; wroteLive = true; S.lastLive = now; jobs.push(db.doc('board/live').set(hiddenLive(S.lrv))); }
    if (!jobs.length) { schedule(); return Promise.resolve(); }
    S.saving = true; S.lastSave = now; status('Enregistrement…');
    S.dirty = false; S.liveDirty = false;
    if (needBoard) { S.rv = data.rv; S.lastW = TAB; }
    return Promise.all(jobs).then(function () {
      S.saving = false; S.exists = true; S.fails = 0; status(S.again || S.dirty ? 'Modifié…' : 'Enregistré');
      if (S.again) { S.again = false; schedule(); }
      else if (S.liveLate && S.shown && !S.dirty) schedule();
    }, function (err) {
      var info = String((err && err.code) || '') + ' ' + String((err && err.message) || '') + ' ' + String((err && err.cause && err.cause.message) || ''), tooFast = /trop rapproch/i.test(info), fatal = !tooFast && FATAL.test(info), wait;
      S.saving = false; S.dirty = true; S.liveDirty = S.liveDirty || urgent; if (wroteLive && !urgent) S.liveLate = true;
      status('Échec de l\'enregistrement');
      if (fatal) {   /* erreur définitive (limite de 12 tableaux, droits) : un seul message, pas de boucle de nouveaux essais */
        msg('Enregistrement refusé' + (err && err.message ? ' (' + String(err.message).slice(0, 80) + ')' : '') + ' : modifie le tableau pour réessayer.', true);
        return;
      }
      wait = tooFast ? 400 : RETRY[Math.min(S.fails, RETRY.length - 1)]; if (!tooFast) S.fails++;   /* limite de rythme de la base (018) : nouvel essai très vite, même fenêtre fermée */
      msg('Enregistrement impossible' + (err && err.message ? ' (' + String(err.message).slice(0, 80) + ')' : '') + ' : nouvel essai dans ' + Math.round(wait / 1000) + ' s.', true);
      clearTimeout(S.saveT); S.saveT = setTimeout(function () { flush(false); }, wait);
    });
  }
  function setShown(on) {
    S.shown = !!on; if (on) { S.shownAt = Date.now(); S.liveBid = S.bid; } else if (S.liveBid === S.bid) S.liveBid = '';
    S.liveDirty = true; syncUi();
    return flush(true);
  }

  /* ---------- Diffusion éphémère du trait en cours ---------- */
  function liveSend(end) {
    var st = S.stroke, room = S.svc && S.svc.bc;
    if (!st || !S.shown || !room || st.hid) return;
    var chunk = st.pts.slice(st.sent), seq = st.sent, n;
    if (!chunk.length && !end) return;
    do {
      n = chunk.slice(0, 100); chunk = chunk.slice(100);
      try { room.emit('live', liveMsg(st.id, st.c, st.th, n, seq, end && !chunk.length)); } catch (e) { /* ignoré */ }
      seq += n.length;
    } while (chunk.length);
    st.sent = st.pts.length;
  }
  /* Trait jamais enregistré (pincer, annulation du pointeur) : message d'annulation explicite, aucun trait « fini » fantôme. */
  function cancelLive(st) {
    var room = S.svc && S.svc.bc;
    if (!st || !st.sent || !S.shown || !room || st.hid) return;
    try { room.emit('live', { id: st.id, c: 0, th: 0.005, s: 0, p: [], x: 1 }); } catch (e) { /* ignoré */ }
  }

  /* ---------- Pointeurs ---------- */
  function pt(ev) { var r = $('tbStage').getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top, cx: ev.clientX, cy: ev.clientY }; }
  function handleAt(e, n) {
    if (!e || e.t !== 'img') return null;
    var b = elBox(e, S.board.ar), tol = 22 / (S.Wf * S.view.z), ar = S.board.ar, cs = [[b.x, b.y, 'nw'], [b.x + b.w, b.y, 'ne'], [b.x, b.y + b.h, 'sw'], [b.x + b.w, b.y + b.h, 'se']], i;
    for (i = 0; i < 4; i++) if (Math.abs(n.x - cs[i][0]) <= tol && Math.abs(n.y - cs[i][1]) <= tol * ar) return cs[i][2];
    return null;
  }
  function tolN(px) { return px / (S.Wf * S.view.z); }
  function onDown(ev) {
    if (ev.button !== undefined && ev.button > 0 && ev.pointerType === 'mouse') return;
    try { $('tbStage').focus({ preventScroll: true }); } catch (x0) { /* ignoré */ }
    var p = pt(ev), n = toNorm(ev.clientX, ev.clientY), ids, e, h;
    S.ptr[ev.pointerId] = p;
    try { $('tbStage').setPointerCapture(ev.pointerId); } catch (x) { /* ignoré */ }
    ids = Object.keys(S.ptr);
    if (ids.length >= 2) { startGesture(); return; }
    if (S.ext && S.ext.owns(S.tool)) { S.ext.down(n, p); return; }
    if (S.tool === 'pen') {
      S.stroke = { id: newId(), c: S.color, th: THICK[S.th], pts: [[n.x, n.y]], sent: 0, last: p, hid: S.newHid };
      clearInterval(S.liveT); if (!S.newHid) S.liveT = setInterval(function () { liveSend(false); }, 100);
      redraw(false);
    } else if (S.tool === 'erase') {
      S.drag = { mode: 'erase', pre: snap() };
      eraseAt(n);
    } else {
      e = S.sel ? elById(S.sel) : null; h = handleAt(e, n);
      if (e && h) { S.drag = { mode: 'resize', h: h, id: e.id, pre: snap() }; S.hideId = e.id; redraw(true); return; }
      var id = hitTest(S.board.els, n.x, n.y, tolN(8), S.board.ar);
      e = id ? elById(id) : null;
      if (e && !e.lk) { S.sel = id; S.drag = { mode: 'move', id: id, last: n, pre: snap() }; S.hideId = id; syncUi(); redraw(true); if (e.cid) linkPick(e.cid); }
      else { S.sel = null; S.drag = { mode: 'pan', last: p }; syncUi(); redraw(false); }
    }
  }
  function onMove(ev) {
    var p = pt(ev), n, e, d = S.drag, st = S.stroke, dx, dy, b, ar = S.board.ar, nw, nh, ax, ay, c;
    if (!S.ptr[ev.pointerId]) return;
    S.ptr[ev.pointerId] = p;
    if (S.gest) { moveGesture(); return; }
    n = toNorm(ev.clientX, ev.clientY);
    if (S.ext && S.ext.drag) { S.ext.move(n, p); return; }
    if (st) {
      if (Math.abs(p.x - st.last.x) + Math.abs(p.y - st.last.y) < 1.5) return;
      st.last = p; st.pts.push([n.x, n.y]); redraw(false);
    } else if (d) {
      if (d.mode === 'erase') eraseAt(n);
      else if (d.mode === 'pan') { S.view.ox += p.x - d.last.x; S.view.oy += p.y - d.last.y; d.last = p; previewView(); }
      else if (d.mode === 'move') {
        e = elById(d.id); if (!e) return; dx = n.x - d.last.x; dy = n.y - d.last.y; d.last = n; e.x = Math.max(-1, Math.min(2, e.x + dx)); e.y = Math.max(-1, Math.min(2, e.y + dy)); redraw(false);
      } else if (d.mode === 'resize') {
        e = elById(d.id); if (!e) return; b = elBox(e, ar);
        ax = d.h.charAt(1) === 'e' ? b.x : b.x + b.w; ay = d.h.charAt(0) === 'n' ? b.y + b.h : b.y;
        nw = Math.max(0.03, Math.abs(n.x - ax), Math.abs(n.y - ay) * e.r / ar); nh = nw * ar / e.r;
        e.w = Math.min(2, nw); delete e.h;
        e.x = d.h.charAt(1) === 'e' ? ax : ax - nw; e.y = d.h.charAt(0) === 'n' ? ay - nh : ay;
        c = e; c.x = Math.max(-1, Math.min(2, c.x)); c.y = Math.max(-1, Math.min(2, c.y)); redraw(false);
      }
    }
  }
  function onUp(ev) {
    var had = !!S.ptr[ev.pointerId], d = S.drag, st = S.stroke;
    delete S.ptr[ev.pointerId];
    try { $('tbStage').releasePointerCapture(ev.pointerId); } catch (x) { /* ignoré */ }
    if (!had) return;
    if (S.gest) { if (Object.keys(S.ptr).length < 2) endGesture(); return; }
    if (S.ext && S.ext.drag) { S.ext.up(toNorm(ev.clientX, ev.clientY), ev.type === 'pointercancel'); return; }
    if (st && ev.type !== 'pointercancel') {
      clearInterval(S.liveT); S.liveT = 0;
      var el = strokeFromPoints(st.pts, st.c, st.th, S.board.ar, st.id);
      liveSend(true); S.stroke = null;
      if (addEl(el)) { var g = $('tbCv').getContext('2d'); S.theme = S.theme || themeColors(); g.save(); setUnits(g); g.beginPath(); g.rect(0, 0, 1, 1 / S.board.ar); g.clip(); drawEl(g, elById(el.id) || el, S.board.ar); g.restore(); }
      redraw(false);
    } else if (st) { clearInterval(S.liveT); S.liveT = 0; cancelLive(st); S.stroke = null; redraw(false); }
    if (d) {
      S.drag = null;
      if (d.mode === 'pan') commitView();
      else if (d.mode === 'erase') { commitHist(d.pre); redraw(true); }
      else { S.hideId = null; commitHist(d.pre); redraw(true); }
    }
  }
  function eraseAt(n) {
    var id = hitTest(S.board.els, n.x, n.y, tolN(10), S.board.ar);
    if (id && delEl(id)) { redraw(true); syncUi(); }
  }
  function startGesture() {
    var ids = Object.keys(S.ptr), a = S.ptr[ids[0]], b = S.ptr[ids[1]];
    if (S.ext) S.ext.cancel();
    if (S.stroke) { clearInterval(S.liveT); S.liveT = 0; cancelLive(S.stroke); S.stroke = null; redraw(false); }
    if (S.drag) { var d = S.drag; S.drag = null; if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'erase') { S.hideId = null; commitHist(d.pre); redraw(true); } }
    S.gest = { d0: Math.max(10, Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2))), c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { z: S.view.z, ox: S.view.ox, oy: S.view.oy } };
  }
  function moveGesture() {
    var ids = Object.keys(S.ptr), a = S.ptr[ids[0]], b = S.ptr[ids[1]], g = S.gest;
    if (!a || !b) return;
    var d1 = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)), c1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    var z1 = Math.max(0.5, Math.min(8, g.v0.z * d1 / g.d0)), k = z1 / g.v0.z;
    S.view = { z: z1, ox: c1.x - (g.c0.x - g.v0.ox) * k, oy: c1.y - (g.c0.y - g.v0.oy) * k };
    previewView();
  }
  function endGesture() { S.gest = null; S.ptr = {}; commitView(); }
  function onWheel(ev) {
    ev.preventDefault();
    var p = pt(ev), f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015));
    zoomAt(f, p.x, p.y); previewView();
    clearTimeout(S.commitT); S.commitT = setTimeout(commitView, 140);
  }

  function uploadImage(file, small) { if (!root.tylBoardImg) return Promise.reject(new Error('Image indisponible')); return root.tylBoardImg.prepare(file, small, S.svc.assets); }
  function imgError(e) { return root.tylBoardImg ? root.tylBoardImg.error(e) : 'Import d\'image indisponible (réseau) : ferme puis rouvre le tableau.'; }
  function placeImage(id, ratio) {
    var ar = S.board.ar, w = Math.min(0.5, 0.8 * ratio / ar), h = w * ar / ratio, c = toNorm($('tbStage').getBoundingClientRect().left + S.SW / 2, $('tbStage').getBoundingClientRect().top + S.SH / 2);
    var x = Math.max(-0.5, Math.min(1.5, c.x - w / 2)), y = Math.max(-0.5, Math.min(1.5, c.y - h / 2));
    var el = { id: newId(), t: 'img', x: x, y: y, w: w, r: ratio, a: 'a:' + id };
    if (addEl(el)) { S.sel = el.id; syncUi(); redraw(true); return el; }
    return null;
  }
  function addImageFile(file) {
    if (!file) return;
    if (S.busy) { msg('Une image est déjà en cours d\'envoi.', true); return; }
    if (S.board.els.length >= LIM.els) { msg('Limite de ' + LIM.els + ' éléments atteinte.', true); return; }
    if (!S.svc || !S.svc.assets) { msg('Import d\'image indisponible (stockage non accessible).', true); return; }
    S.busy = true; msg('Image en cours de préparation…');
    uploadImage(file, false).then(function (r) {
      if (placeImage(r.id, r.w / r.h)) msg('Image ajoutée (' + Math.round(r.size / 1024) + ' Ko).');
    }).then(function () { S.busy = false; }, function (e) { S.busy = false; msg(imgError(e), true); });
  }
  function onPaste(ev) { var f = S.open && root.tylBoardImg ? root.tylBoardImg.pasted(ev) : null; if (f) { ev.preventDefault(); addImageFile(f); } }
  function pasteBtn() { if (root.tylBoardImg) root.tylBoardImg.clip(addImageFile, msg); }

  /* ---------- Historique, interface ---------- */
  function applySnap(s) { S.board.els = JSON.parse(s); if (S.sel && !elById(S.sel)) S.sel = null; markDirty(); syncUi(); redraw(true); }
  function undo() { var p = S.hist.undo(snap()); if (p !== null) applySnap(p); }
  function redo() { var p = S.hist.redo(snap()); if (p !== null) applySnap(p); }
  function syncUi() {
    var ov = $('tbOv'), i, b;
    if (!ov || !S.board) return;
    $('tbUndo').disabled = !S.hist.canUndo(); $('tbRedo').disabled = !S.hist.canRedo(); $('tbDel').disabled = !S.sel;
    var tl = ov.querySelectorAll('[data-tbtool]');
    for (i = 0; i < tl.length; i++) tl[i].setAttribute('aria-pressed', String(tl[i].getAttribute('data-tbtool') === S.tool));
    $('tbOpts').hidden = S.tool !== 'pen';
    var cl = ov.querySelectorAll('[data-tbc]');
    for (i = 0; i < cl.length; i++) cl[i].setAttribute('aria-pressed', String(+cl[i].getAttribute('data-tbc') === S.color));
    var hl = ov.querySelectorAll('[data-tbth]');
    for (i = 0; i < hl.length; i++) { b = hl[i]; b.setAttribute('aria-pressed', String(+b.getAttribute('data-tbth') === S.th)); }
    $('tbName').textContent = S.board.name;
    b = $('tbShow'); b.textContent = S.shown ? 'Cacher' : 'Montrer aux joueuses'; b.setAttribute('aria-pressed', String(S.shown));
    b.setAttribute('aria-label', S.shown ? 'Cacher le tableau aux joueuses (visible actuellement)' : 'Montrer le tableau aux joueuses (caché actuellement)');
    $('tbStage').style.cursor = S.tool === 'select' ? 'default' : S.tool === 'erase' ? 'cell' : 'crosshair';
    if (S.ext) S.ext.sync();
  }
  function setTool(t) { if (S.ext) S.ext.cancel(); S.tool = t; if (t !== 'select') S.sel = null; savePref(); syncUi(); redraw(false); }
  function savePref() { try { root.localStorage.setItem(LS_PREF, JSON.stringify({ tool: S.tool, color: S.color, th: S.th, bid: S.bid })); } catch (e) { /* ignoré */ } }
  function loadPref() {
    try { var p = JSON.parse(root.localStorage.getItem(LS_PREF) || 'null'); if (p) { if (p.tool === 'pen' || p.tool === 'erase' || p.tool === 'select') S.tool = p.tool; if (p.bid) S.lastBid = String(p.bid).slice(0, 20); if (p.color >= 0 && p.color <= 11) S.color = Math.floor(p.color); if (p.th >= 0 && p.th <= 2) S.th = Math.floor(p.th); } } catch (e) { /* ignoré */ }
  }
  function wire() {
    var ov = $('tbOv'), st = $('tbStage');
    st.addEventListener('pointerdown', onDown); st.addEventListener('pointermove', onMove); st.addEventListener('pointerup', onUp); st.addEventListener('pointercancel', onUp);
    st.addEventListener('wheel', onWheel, { passive: false });
    st.addEventListener('dragover', function (e) { e.preventDefault(); });
    st.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) addImageFile(e.dataTransfer.files[0]); });
    ov.addEventListener('click', function (ev) {
      var t = ev.target, b = t && t.closest ? t.closest('button') : null, v;
      if (!b) return;
      if (b.id === 'tbClose') close();
      else if (b.id === 'tbRetry') retry();
      else if (b.id === 'tbShow') setShown(!S.shown);
      else if (b.hasAttribute('data-tbtool')) setTool(b.getAttribute('data-tbtool'));
      else if (b.hasAttribute('data-tbc')) { S.color = +b.getAttribute('data-tbc'); savePref(); if (S.ext) S.ext.restyle('c'); syncUi(); }
      else if (b.hasAttribute('data-tbth')) { S.th = +b.getAttribute('data-tbth'); savePref(); if (S.ext) S.ext.restyle(); syncUi(); }
      else if (b.id === 'tbImg') { S.fileFor = ''; $('tbFile').click(); }
      else if (b.id === 'tbPaste') pasteBtn();
      else if (b.id === 'tbUndo') undo();
      else if (b.id === 'tbRedo') redo();
      else if (b.id === 'tbDel') { if (S.sel) { var pre = snap(); delEl(S.sel); commitHist(pre); redraw(true); syncUi(); } }
      else if (b.id === 'tbClear') clearAll(b);
      else if (b.id === 'tbClrPing') clearPings();
      else if (b.id === 'tbZin') { zoomAt(1.4, S.SW / 2, S.SH / 2); commitView(); }
      else if (b.id === 'tbZout') { zoomAt(1 / 1.4, S.SW / 2, S.SH / 2); commitView(); }
      else if (b.id === 'tbFit') fitView();
    });
    $('tbFile').addEventListener('change', function (ev) { var f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return; if (S.fileFor === 'token' && S.ext) S.ext.tokenFile(f); else addImageFile(f); });
    ov.addEventListener('keydown', function (ev) { ev.stopPropagation(); });   /* rien de ce qui se tape ici ne remonte aux raccourcis de l'appli */
    doc.addEventListener('paste', onPaste);
    root.addEventListener('resize', function () { if (S.open && !S.down && S.board) { layout(); fitView(); } });
    root.addEventListener('pagehide', pending);
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') pending(); });
  }
  function pending() { if (S.dirty || S.liveDirty || S.liveLate || S.again) flush(true); }
  /* Écouteur CLAVIER en capture sur le document, actif seulement tant que le tableau est ouvert : le tableau est modal, aucun raccourci
     de l'appli (Ctrl+Z du combat, Échap du Carnet…) ne doit agir dessous, quel que soit l'élément qui a le focus. */
  function onKey(ev) {
    if (!S.open) return;
    var k = ev.key, tg = ev.target && ev.target.tagName, inField = tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT', mod = ev.ctrlKey || ev.metaKey, pre;
    if (k === 'Escape' || k === 'Esc') { ev.preventDefault(); ev.stopPropagation(); if (!(S.ext && S.ext.escape())) close(); return; }
    if (k === 'Tab') { trap(ev); ev.stopPropagation(); return; }
    if (S.down) { ev.stopPropagation(); return; }
    if ((k === 'Delete' || k === 'Backspace') && S.sel && !inField) { ev.preventDefault(); ev.stopPropagation(); pre = snap(); delEl(S.sel); commitHist(pre); redraw(true); syncUi(); return; }
    if (mod && (k === 'z' || k === 'Z' || k === 'y' || k === 'Y')) {
      ev.stopPropagation();
      if (inField && tg !== 'SELECT') return;   /* annulation native du texte saisi */
      ev.preventDefault();
      if (k === 'y' || k === 'Y' || ev.shiftKey) redo(); else undo();
      return;
    }
    if (!($('tbOv') && $('tbOv').contains(ev.target))) ev.stopPropagation();
  }
  function armKeys() { doc.addEventListener('keydown', onKey, true); if (root.matchMedia) { try { S.mq = root.matchMedia('(prefers-color-scheme: dark)'); if (S.mq.addEventListener) S.mq.addEventListener('change', onTheme); else if (S.mq.addListener) S.mq.addListener(onTheme); } catch (e) { S.mq = null; } } }
  function disarmKeys() { doc.removeEventListener('keydown', onKey, true); if (S.mq) { try { if (S.mq.removeEventListener) S.mq.removeEventListener('change', onTheme); else if (S.mq.removeListener) S.mq.removeListener(onTheme); } catch (e) { /* ignoré */ } S.mq = null; } }
  function onTheme() { if (S.open && !S.down && S.board) { S.theme = themeColors(); redraw(true); } }
  function clearAll(btn) {
    if (!S.board.els.length) return;
    if (btn.getAttribute('data-ask') !== '1') {
      btn.setAttribute('data-ask', '1'); btn.textContent = 'Confirmer ?';
      clearTimeout(S.clrT); S.clrT = setTimeout(function () { btn.removeAttribute('data-ask'); btn.textContent = 'Tout effacer'; }, 4000);
      return;
    }
    clearTimeout(S.clrT); btn.removeAttribute('data-ask'); btn.textContent = 'Tout effacer';
    var pre = snap(); S.board.els = []; S.sel = null; commitHist(pre); redraw(true); syncUi(); msg('Tableau vidé (tu peux annuler).');
  }
  function trap(ev) {
    var ov = $('tbOv'), f = ov.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=file]),select:not([disabled])'), vis = [], i, a = doc.activeElement;
    for (i = 0; i < f.length; i++) if (f[i].offsetParent !== null || f[i].getClientRects().length) vis.push(f[i]);
    if (!vis.length) return;
    if (ev.shiftKey && (a === vis[0] || !ov.contains(a))) { ev.preventDefault(); vis[vis.length - 1].focus(); }
    else if (!ev.shiftKey && (a === vis[vis.length - 1] || !ov.contains(a))) { ev.preventDefault(); vis[0].focus(); }
  }

  /* ---------- Services, chargement, ouverture ---------- */
  function services() {
    if (S.svc) return Promise.resolve(S.svc);
    var c = root.claude;
    if (!c || !c.use) return Promise.resolve({ db: null });
    return Promise.all([c.use('db'), c.use('assets'), c.use('board'), c.use('boardPing')]).then(function (r) {
      S.svc = { db: r[0] || null, assets: r[1] || null, bc: r[2] || null, pp: r[3] || null };
      return S.svc;
    }, function () { S.svc = { db: null }; return S.svc; });
  }
  function newBoard() { return validateBoard({ name: 'Tableau', ar: 1.6, els: [] }).board; }
  function adopt(d, bid) {
    var v = validateBoard(d); S.board = v.board; S.bid = bid; S.rv = v.board.rv || 0; S.lastW = v.board.w || ''; S.imgFail = {}; S.exists = true; S.dirty = false; S.sel = null; S.hist.reset(); S.shown = !!S.liveBid && S.liveBid === bid; pruneImgs();
    if (v.dropped) msg(v.dropped + ' élément(s) ignoré(s) à la lecture (invalides ou au-delà des limites).', true);
  }
  function readLive(l) {
    S.lrv = Math.max(S.lrv, +l.rv || 0); S.liveBid = l.on === true && typeof l.bid === 'string' ? l.bid : ''; S.shownAt = +l.shown || 0;
  }
  function load() {
    var db = S.svc.db;
    /* Tableau déjà en mémoire : on relit quand même « live » (un autre appareil a pu montrer/cacher entretemps). */
    if (S.board && S.bid) return Promise.resolve(db.doc('board/live').get()).then(function (ls) { readLive(ls && ls.exists ? (ls.data() || {}) : {}); S.shown = !!S.liveBid && S.liveBid === S.bid; }, function () { /* ignoré */ });
    return Promise.resolve(db.doc('board/live').get()).then(function (ls) {
      readLive(ls && ls.exists ? (ls.data() || {}) : {});
      return db.collection('boardmj').get();
    }).then(function (snap) {
      var best = null, bestU = -1;
      S.cache = {};
      snap.docs.forEach(function (ds) {
        var d = ds.data() || {}, u = +d.upd || 0;
        if (!/^b_[a-z0-9]{8}$/.test(ds.id)) return;
        S.cache[ds.id] = d;
        if (u >= bestU) { best = { d: d, id: ds.id }; bestU = u; }
      });
      if (S.lastBid && S.cache[S.lastBid]) best = { d: S.cache[S.lastBid], id: S.lastBid };
      if (best) adopt(best.d, best.id);
      else { S.board = newBoard(); S.bid = 'b_' + newId(); S.rv = 0; S.exists = false; S.hist.reset(); S.shown = false; }
    });
  }
  function listen() {
    var db = S.svc && S.svc.db;
    if (!db) return;
    unlisten();
    try {
      S.unsub = db.doc('boardmj/' + S.bid).onSnapshot(function (sn) {
        if (!sn || !sn.exists || (sn.metadata && sn.metadata.hasPendingWrites)) return;
        var d = sn.data() || {}, rv = +d.rv || 0, w = typeof d.w === 'string' ? d.w : '';
        if (w === TAB) return;   /* notre propre écriture */
        /* plus récent, OU même numéro écrit par un autre onglet/appareil (écritures simultanées) : on reprend la version distante, avec avertissement */
        if (rv > S.rv || (rv === S.rv && w !== S.lastW)) {
          adopt(d, S.bid); clearTimeout(S.saveT);
          msg('Modifié depuis un autre onglet ou appareil : version distante reprise.', true); status('Version distante reprise');
          if (S.open) { syncUi(); redraw(true); }
        }
      }, function () { /* ignoré */ });
    } catch (e) { S.unsub = null; }
    try {
      S.unLive = db.doc('board/live').onSnapshot(function (sn) {
        if (!sn || (sn.metadata && sn.metadata.hasPendingWrites)) return;
        var l = sn.exists ? (sn.data() || {}) : {}, was = S.shown;
        if ((+l.rv || 0) < S.lrv) return;   /* plus ancien que nos propres écritures */
        readLive(l);
        S.shown = S.liveBid === S.bid;
        if (was && !S.shown) { S.liveDirty = false; S.liveLate = false; msg(l.on === true ? 'Un autre tableau est maintenant montré (autre appareil).' : 'Le tableau a été caché depuis un autre appareil.', true); }
        if (S.open && !S.down) syncUi();
      }, function () { /* ignoré */ });
    } catch (e2) { S.unLive = null; }
  }
  function unlisten() {
    if (S.unsub) { try { S.unsub(); } catch (e) { /* ignoré */ } S.unsub = null; }
    if (S.unLive) { try { S.unLive(); } catch (e2) { /* ignoré */ } S.unLive = null; }
  }
  function listenPing() {
    if (S.unPing) { try { S.unPing(); } catch (e) { /* ignoré */ } S.unPing = null; }
    try { if (S.svc && S.svc.pp) S.unPing = S.svc.pp.on('ping', onPing); } catch (e2) { S.unPing = null; }
  }
  /* Attend la fin des écritures en cours (changement de tableau sans perte). */
  function settle(n) {
    n = n || 0;
    return flush(true).then(function () {
      if ((S.saving || S.dirty || S.again) && n < 25) return new Promise(function (r) { setTimeout(r, 160); }).then(function () { return settle(n + 1); });
    });
  }
  function boardList() {
    var out = [], k, d;
    for (k in S.cache) { if (Object.prototype.hasOwnProperty.call(S.cache, k) && k !== S.bid) { d = S.cache[k] || {}; out.push({ id: k, name: M.cut(d.name, 40) || 'Tableau', n: Array.isArray(d.els) ? d.els.length : 0 }); } }
    if (S.board) out.push({ id: S.bid, name: S.board.name, n: S.board.els.length });
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1; });
    return out;
  }
  function enter() {
    layout(); S.theme = themeColors(); fitView(); listen(); savePref(); syncUi(); redraw(true);
    try { if (root.tylTK && root.tylTK.onOpen) root.tylTK.onOpen(); } catch (e) { /* ignoré */ }
    status(S.exists ? 'Enregistré' : 'Nouveau tableau');
  }
  function initExt() {
    if (S.ext || !root.tylBoardTools) return;
    S.ext = root.tylBoardTools.create({ S: S, $: $, msg: msg, status: status, addEl: addEl, snap: snap, commitHist: commitHist, delEl: delEl, elById: elById, markDirty: markDirty, redraw: redraw, syncUi: syncUi,
      toNorm: toNorm, tolN: tolN, setTool: setTool, flush: flush, settle: settle, boardList: boardList, adopt: adopt, enter: enter, newBoard: newBoard, setShown: setShown, getImg: getImg, colorOf: colorOf,
      themeColors: themeColors, ctxR: ctxR, uploadImage: uploadImage, imgError: imgError, placeImage: placeImage, addImageFile: addImageFile, PAL: PAL, THICK: THICK, api: api });
  }
  function cssReady() {
    return new Promise(function (res) {
      if (doc.getElementById('tbCss')) { res(); return; }
      var l = doc.createElement('link'); l.id = 'tbCss'; l.rel = 'stylesheet'; l.href = 'tableau.css';
      l.onload = l.onerror = function () { res(); }; setTimeout(res, 2500);
      doc.head.appendChild(l);
    });
  }
  function open(opener) {
    return cssReady().then(function () { return new Promise(function (res) { M.need(['tableau-rendu.js', 'tableau-image.js', 'tableau-outils.js'], function (err) { res(err || null); }); }); }).then(function (err) {
      if (!root.tylBoardDraw) { showDown(opener); return; }   /* sans le dessin, rien ne s'afficherait : on ne l'ouvre pas */
      var p = open2(opener);
      if (err) msg(!root.tylBoardTools ? 'Outils avancés indisponibles (réseau) : seuls le stylo et la gomme fonctionnent.' : 'Import d\'image indisponible (réseau) : ferme puis rouvre le tableau.', true);
      return p;
    });
  }
  /* Fichier indispensable non chargé : fenêtre réduite (message + Réessayer + Fermer), aucune erreur JS. */
  function showDown(opener) {
    build();
    S.opener = opener || doc.activeElement; S.down = true;
    var ov = $('tbOv');
    ov.className = 'tb-down-on'; ov.hidden = false; S.open = true; if (!/tb-lock/.test(doc.documentElement.className)) doc.documentElement.className += ' tb-lock';
    $('tbDown').hidden = false; status('');
    msg('Tableau indisponible (réseau) : vérifie ta connexion puis appuie sur Réessayer.', true, true);
    armKeys();
    try { $('tbRetry').focus(); } catch (e) { /* ignoré */ }
  }
  function leaveDown() {
    var ov = $('tbOv');
    S.down = false; S.open = false; ov.className = ''; ov.hidden = true; $('tbDown').hidden = true; msg('');
    doc.documentElement.className = doc.documentElement.className.replace(/\s*tb-lock/g, '');
    disarmKeys();
  }
  function retry() { var o = S.opener; leaveDown(); open(o); }
  function open2(opener) {
    build(); initExt();
    S.opener = opener || doc.activeElement;
    var ov = $('tbOv');
    ov.hidden = false; S.open = true; doc.documentElement.className += ' tb-lock'; armKeys();
    status('Chargement…'); loadPref();
    return services().then(function (svc) {
      if (!svc.db) { msg('Base de données indisponible : le tableau ne peut pas être enregistré.', true); S.board = S.board || newBoard(); S.bid = S.bid || 'b_' + newId(); return; }
      return load().then(function () { if (S.open) listenPing(); });
    }).then(function () {
      if (!S.board) { S.board = newBoard(); S.bid = 'b_' + newId(); }
      if (!S.open) return;
      enter(); $('tbClose').focus();
    }, function () { msg('Impossible de charger le tableau.', true); status('Erreur'); });
  }
  function close() {
    var ov = $('tbOv');
    if (!ov || !S.open) return;
    if (S.down) { leaveDown(); try { if (S.opener && S.opener.focus) S.opener.focus(); } catch (e0) { /* ignoré */ } return; }
    if (S.stroke) { clearInterval(S.liveT); cancelLive(S.stroke); S.stroke = null; }
    S.drag = null; S.gest = null; S.ptr = {}; S.hideId = null; if (S.ext) S.ext.close();
    flush(true);
    S.open = false; ov.hidden = true; disarmKeys();
    doc.documentElement.className = doc.documentElement.className.replace(/\s*tb-lock/g, '');
    unlisten();
    if (S.unPing) { try { S.unPing(); } catch (e3) { /* ignoré */ } S.unPing = null; }
    S.pings.clear(); clearTimeout(S.pingT); S.pingT = 0;
    /* Libère la mémoire (téléphone) : canvas à 0 (layout() les redimensionne à la réouverture) et cache d'images vidé. */
    $('tbCv').width = $('tbCv').height = $('tbLv').width = $('tbLv').height = 0;
    S.imgOrder.slice().forEach(forgetImg); S.imgs = {}; S.imgOrder = []; S.imgFail = {};
    try { if (S.opener && S.opener.focus) S.opener.focus(); } catch (e2) { /* ignoré */ }
  }

  function state() {
    var b = S.board || { els: [], ar: 1.6, name: '' };
    return { boards: S.board ? boardList() : [], liveBid: S.liveBid, newHid: S.newHid, bid: S.bid, name: b.name, ar: b.ar, els: JSON.parse(JSON.stringify(b.els)), tool: S.tool, shown: S.shown, dirty: S.dirty, rv: S.rv, sel: S.sel, view: { z: S.view.z, ox: S.view.ox, oy: S.view.oy }, hist: S.hist.size(), imgs: Object.keys(S.imgs),
      pings: S.pings.list(Date.now()).map(function (p) { return { x: p.x, y: p.y, n: p.n }; }) };
  }

  /* ---------- Points d'entrée du combat simplifié : le lien jeton <-> combattant vit dans tableau-lien.js, la pastille dans combat-jetons.js ---------- */
  function linkCtx() { try { return root.tylTK && root.tylTK.projCtx ? root.tylTK.projCtx() : null; } catch (e) { return null; } }
  function linkPick(cid) { try { if (root.tylTK && root.tylTK.onPick) root.tylTK.onPick(cid); } catch (e) { /* ignoré */ } }
  api.link = root.tylBoardLink ? root.tylBoardLink.create({ S: S, TAB: TAB, LIVE_GAP: LIVE_GAP, services: services, load: load, loadPref: loadPref, adopt: adopt, newBoard: newBoard, newId: newId,
    snap: snap, commitHist: commitHist, addEl: addEl, delEl: delEl, flush: flush, schedule: schedule, setTool: setTool, syncUi: syncUi, redraw: redraw, project: project, validateBoard: validateBoard, ctx: linkCtx }) : null;

  api.enabled = enabled; api.refreshButton = refreshButton; api.open = open; api.close = close; api.state = state; api.toScreen = toScreen;
  api._exportInfo = function () { return S.ext ? S.ext.exportInfo() : null; };
  api._addForTest = function (raw) { var ok = addEl(raw); if (ok && S.open) redraw(true); return ok; };
  root.tylBoard = api;
})(typeof window !== 'undefined' ? window : this);
