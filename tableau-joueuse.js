/* tableau-joueuse.js : vue JOUEUSE du tableau blanc partagé (tranche T3) : LECTURE SEULE + ping. ES5, sans bibliothèque.
   Ce fichier ne contient AUCUNE fonction d'écriture : pas d'enregistrement en base, pas d'envoi d'image, pas d'émission sur le canal
   du MJ. Il lit « board/live » (document projeté sans élément caché), écoute les traits en direct du MJ (canal tyl-board) et les
   pings (canal tyl-board-ping, le seul sur lequel une joueuse émet). Aucun texte reçu n'est interprété comme du HTML.
   Chargé uniquement pour un compte joueuse (app.js : boardPlayerUi). Modèle partagé : tableau-modele.js. */
(function (root) {
  'use strict';
  var M = root.tylBoardModel;
  if (!M || !root.document) return;
  var doc = root.document;
  var PAL = [null, '#d9453b', '#e07b1f', '#d4a00a', '#3fa34d', '#1fa8a0', '#3b82d6', '#8e5bd0', '#d6579b', '#9a6b3f', '#8a918c', null];
  var HOLD_MS = 500, MOVE_PX = 8, KEY_STEP = 0.02, KEY_BIG = 0.1;
  var $ = function (id) { return doc.getElementById(id); };

  var S = { gen: 0, annc: M.makeAnnounceLimiter(), imgFail: {}, mq: null, inited: false, built: false, open: false, shown: false, first: true, board: null, bid: '', svc: null, name: '', unsubs: [], connSeen: false,
    strokes: M.makeLiveStrokes(), expT: 0, pings: M.makePingBook(), limiter: M.makeLimiter(M.PING.sendGap),
    view: { z: 1, ox: 0, oy: 0 }, ren: { z: 1, ox: 0, oy: 0 }, Wf: 100, SW: 100, SH: 100, dpr: 1, imgs: {}, imgOrder: [], theme: null,
    ptr: {}, gest: null, pan: null, holdT: 0, pingMode: false, cursor: { x: 0.5, y: 0.5 }, kb: false, opener: null, pushed: false,
    rafId: 0, needS: false, needL: false, commitT: 0, pingT: 0, toastT: 0, msgT: 0, liveSeen: 0 };

  function enabled() { return !(root.TYL_CONFIG && root.TYL_CONFIG.board === false); }
  function reduced() { try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

  var CSS = '#pvBoardFab{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:calc(76px + env(safe-area-inset-bottom));z-index:900;box-sizing:border-box;width:48px;height:48px;min-width:44px;min-height:44px;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--ink);font:inherit;font-size:20px;line-height:1;cursor:pointer;opacity:.92;display:flex;align-items:center;justify-content:center;touch-action:manipulation}' +
    '#pvBoardFab[hidden],body:has(.sped.open) #pvBoardFab{display:none}#pvBoardFab i{position:absolute;top:5px;right:5px;width:11px;height:11px;border-radius:50%;background:var(--brass);box-shadow:0 0 0 2px var(--surface)}#pvBoardFab:focus-visible{outline:2px solid var(--brass);outline-offset:2px}' +
    '#pvbToast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(132px + env(safe-area-inset-bottom));z-index:1100;max-width:min(92vw,420px);box-sizing:border-box;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font-size:15px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.18)}#pvbToast:empty{display:none}' +
    '#pbOv{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;height:100vh;height:100dvh;box-sizing:border-box;background:var(--bg);color:var(--ink);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);overscroll-behavior:contain}' +
    '#pbOv[hidden]{display:none}html.pb-lock,html.pb-lock body{overflow:hidden}' +
    '#pbOv .pb-top,#pbOv .pb-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;background:var(--surface)}#pbOv .pb-top{border-bottom:1px solid var(--line)}#pbOv .pb-bar{border-top:1px solid var(--line);justify-content:center}' +
    '#pbOv .pb-name{font-weight:700;flex:1 1 80px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}' +
    '#pbOv .pb-btn{box-sizing:border-box;min-width:44px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);color:var(--ink);font:inherit;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;touch-action:manipulation}' +
    '#pbOv .pb-btn[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:var(--on-primary);font-weight:700}' +
    '#pbOv .pb-stage{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;background:var(--surface-2);touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}#pbOv .pb-stage canvas{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:0 0}' +
    '#pbOv .pb-stage:focus-visible{outline:3px solid var(--brass);outline-offset:-3px}' +
    '#pbOv .pb-empty{position:absolute;left:0;right:0;top:40%;margin:0;padding:0 16px;text-align:center;font-size:16px;color:var(--muted)}#pbOv .pb-empty[hidden]{display:none}' +
    '#pbOv .pb-msg{margin:0;padding:2px 10px;min-height:20px;font-size:14px;color:var(--ink);text-align:center}' +
    '#pbOv .pb-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;list-style:none}' +
    '#pbOv :focus-visible{outline:2px solid var(--brass);outline-offset:2px}';

  /* ---------- Interface fixe : bouton flottant, annonce, plein écran ---------- */
  function buildEntry() {
    if ($('pvBoardFab')) return;
    var st = doc.createElement('style'); st.id = 'pbStyle'; st.appendChild(doc.createTextNode(CSS)); doc.head.appendChild(st);
    var f = doc.createElement('button'); f.id = 'pvBoardFab'; f.type = 'button'; f.hidden = true;
    f.setAttribute('aria-label', 'Ouvrir le tableau que le MJ montre'); f.setAttribute('aria-haspopup', 'dialog'); f.title = 'Le MJ montre un tableau';
    f.appendChild(doc.createTextNode('🖼')); f.appendChild(doc.createElement('i')); f.lastChild.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(f);
    var t = doc.createElement('div'); t.id = 'pvbToast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); doc.body.appendChild(t);
    f.addEventListener('click', function () { openBoard(f); });
  }
  function $x(root0, id) { var i, c = root0.childNodes; for (i = 0; i < c.length; i++) if (c[i].id === id) return c[i]; return null; }
  function build() {
    if (S.built) return;
    var ov = doc.createElement('div'); ov.id = 'pbOv'; ov.hidden = true; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Tableau partagé');
    function mk(tag, id, cls, txt, at) {
      var e = doc.createElement(tag), k;
      if (id) e.id = id;
      if (cls) e.className = cls;
      if (txt) e.textContent = txt;
      if (at) for (k in at) if (at.hasOwnProperty(k)) e.setAttribute(k, at[k]);
      return e;
    }
    function btn(id, txt, at) { var e = mk('button', id, 'pb-btn', txt, at); e.type = 'button'; return e; }
    var top = mk('div', '', 'pb-top'), stage, bar;
    top.appendChild(btn('pbClose', '\u2715 Fermer', { 'aria-label': 'Fermer le tableau' })); top.appendChild(mk('span', 'pbName', 'pb-name'));
    stage = mk('div', 'pbStage', 'pb-stage', '', { tabindex: '0', role: 'application', 'aria-label': 'Tableau partag\u00E9, en lecture seule. Fl\u00E8ches : d\u00E9placer le r\u00E9ticule. Entr\u00E9e : faire un ping. Plus et moins : zoom. Z\u00E9ro : recentrer.' });
    stage.appendChild(mk('canvas', 'pbCv')); stage.appendChild(mk('canvas', 'pbLv')); stage.appendChild(mk('p', 'pbEmpty', 'pb-empty')); $x(stage, 'pbEmpty').hidden = true;
    bar = mk('div', '', 'pb-bar', '', { role: 'toolbar', 'aria-label': 'Affichage du tableau' });
    bar.appendChild(btn('pbPing', '\uD83D\uDCCD Ping', { 'aria-pressed': 'false', title: 'Touche ensuite un point du tableau (ou appui long sur le point)' }));
    bar.appendChild(btn('pbZout', '\u2212', { 'aria-label': 'Zoom arri\u00E8re' })); bar.appendChild(btn('pbFit', 'Recentrer')); bar.appendChild(btn('pbZin', '+', { 'aria-label': 'Zoom avant' }));
    ov.appendChild(top); ov.appendChild(stage); ov.appendChild(mk('p', 'pbMsg', 'pb-msg', '', { role: 'status', 'aria-live': 'polite' })); ov.appendChild(bar);
    ov.appendChild(mk('ul', 'pbLog', 'pb-sr', '', { 'aria-live': 'polite', 'aria-label': 'Pings re\u00E7us' }));
    ov.appendChild(mk('ul', 'pbAlt', 'pb-sr', '', { 'aria-label': 'Contenu du tableau' }));
    doc.body.appendChild(ov);
    S.built = true;
    wire();
  }
  var STAGE_HELP = ' Lecture seule. Fl\u00E8ches : d\u00E9placer le r\u00E9ticule. Entr\u00E9e : faire un ping. Plus et moins : zoom. Z\u00E9ro : recentrer.';
  /* Équivalent texte du canvas (lecteurs d'écran) : textes, libellés de jetons, images nommées ; 60 entrées au plus, texte seul. */
  function updateAlt() {
    var ul = $('pbAlt'), st = $('pbStage'), els = S.board ? S.board.els : [], i, e, li, n = 0;
    if (!ul || !st) return;
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    for (i = 0; i < els.length && n < 60; i++) {
      e = els[i]; li = null;
      if (e.t === 'text') li = 'Texte : ' + e.tx;
      else if (e.t === 'token') li = 'Jeton : ' + (e.lb || 'sans nom') + (e.cid && root.tylTK && root.tylTK.alt && root.tylTK.alt(e.cid) ? ' (' + root.tylTK.alt(e.cid) + ')' : '');
      else if (e.t === 'img') li = 'Image' + (e.lb ? ' : ' + e.lb : '');
      if (li) { var x = doc.createElement('li'); x.textContent = li; ul.appendChild(x); n++; }
    }
    st.setAttribute('aria-label', S.board ? 'Tableau \u00AB ' + S.board.name + ' \u00BB, ' + els.length + (els.length > 1 ? ' \u00E9l\u00E9ments' : ' \u00E9l\u00E9ment') + '.' + STAGE_HELP : 'Aucun tableau montr\u00E9.' + STAGE_HELP);
  }
  function msg(t, ms) {
    var m = $('pbMsg'); if (!m) return;
    m.textContent = t || '';
    clearTimeout(S.msgT);
    if (t && ms !== 0) S.msgT = setTimeout(function () { m.textContent = ''; }, ms || 5000);
  }
  function toast(t) {
    var e = $('pvbToast'); if (!e) return;
    e.textContent = t || '';
    clearTimeout(S.toastT);
    if (t) S.toastT = setTimeout(function () { e.textContent = ''; }, 6000);
  }
  function updateEntry() {
    var f = $('pvBoardFab'), b = $('pvBoardBtn');
    if (f) f.hidden = !(enabled() && S.shown && !S.open);
    if (b) { b.hidden = !enabled(); b.setAttribute('data-shown', S.shown ? '1' : '0'); b.textContent = S.shown ? '🖼 Tableau ● (montré)' : '🖼 Tableau'; }
  }

  /* ---------- Géométrie (mêmes conventions que la vue MJ : x en largeur, y en hauteur de la feuille) ---------- */
  function layout() {
    var st = $('pbStage'), r = st.getBoundingClientRect(), ar = S.board ? S.board.ar : 1.6, cv = $('pbCv'), lv = $('pbLv'), k;
    S.SW = Math.max(50, r.width); S.SH = Math.max(50, r.height);
    S.Wf = Math.max(40, Math.min(S.SW - 16, (S.SH - 16) * ar));
    S.dpr = Math.min(root.devicePixelRatio || 1, 2);
    k = Math.min(1, 2048 / (Math.max(S.SW, S.SH) * S.dpr));
    S.dpr = S.dpr * k;
    cv.width = lv.width = Math.max(1, Math.round(S.SW * S.dpr)); cv.height = lv.height = Math.max(1, Math.round(S.SH * S.dpr));
  }
  function fitView() { var ar = S.board ? S.board.ar : 1.6; S.view = { z: 1, ox: (S.SW - S.Wf) / 2, oy: (S.SH - S.Wf / ar) / 2 }; commitView(); }
  function toNorm(cx, cy) {
    var r = $('pbStage').getBoundingClientRect(), v = S.view, ar = S.board ? S.board.ar : 1.6;
    return { x: (cx - r.left - v.ox) / (S.Wf * v.z), y: (cy - r.top - v.oy) / (S.Wf * v.z / ar) };
  }
  function toScreen(nx, ny) {
    var r = $('pbStage').getBoundingClientRect(), v = S.view, ar = S.board ? S.board.ar : 1.6;
    return { x: r.left + v.ox + nx * S.Wf * v.z, y: r.top + v.oy + ny * (S.Wf * v.z / ar) };
  }
  /* Cache bitmap : pendant un geste seule une transformation CSS déplace les deux couches, le redessin a lieu à la fin. */
  function commitView() {
    S.ren = { z: S.view.z, ox: S.view.ox, oy: S.view.oy };
    $('pbCv').style.transform = ''; $('pbLv').style.transform = '';
    S.needS = true; S.needL = true; frame();
  }
  function previewView() {
    var s = S.view.z / S.ren.z, tx = S.view.ox - S.ren.ox * s, ty = S.view.oy - S.ren.oy * s, t = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    $('pbCv').style.transform = t; $('pbLv').style.transform = t;
  }
  function zoomAt(f, cx, cy) {
    var z0 = S.view.z, z1 = Math.max(0.5, Math.min(8, z0 * f)), k = z1 / z0;
    S.view = { z: z1, ox: cx - (cx - S.view.ox) * k, oy: cy - (cy - S.view.oy) * k };
  }

  /* ---------- Rendu ---------- */
  function frame() { if (!S.rafId) S.rafId = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { S.rafId = 0; paint(); }); }
  function redraw(all) { if (all) S.needS = true; S.needL = true; frame(); }
  function themeColors() {
    var cs = root.getComputedStyle(doc.documentElement), g = function (n, d) { var v = cs.getPropertyValue(n); return v ? v.replace(/^\s+|\s+$/g, '') : d; };
    return { ink: g('--ink', '#1d2924'), brass: g('--brass', '#a97514'), surface: g('--surface', '#fbfaf4'), line: g('--line', '#dad5c1') };
  }
  function colorOf(c) {
    if (typeof c === 'string') return c;
    if (c === 0) return S.theme.ink;
    if (c === 11) return S.theme.brass;
    return PAL[c] || S.theme.ink;
  }
  function setUnits(g) { var s = S.dpr * S.ren.z * S.Wf; g.setTransform(s, 0, 0, s, S.dpr * S.ren.ox, S.dpr * S.ren.oy); }
  function forgetImg(id) {
    var o = S.imgs[id], i = S.imgOrder.indexOf(id);
    if (i >= 0) S.imgOrder.splice(i, 1);
    if (o) { o.im.onload = o.im.onerror = null; try { o.im.src = ''; } catch (e) { /* ignoré */ } }
    delete S.imgs[id];
  }
  function pruneImgs() {
    var keep = {}, k;
    if (S.board) S.board.els.forEach(function (e) { if (typeof e.a === 'string') keep[e.a.slice(2)] = 1; });
    for (k in S.imgs) { if (Object.prototype.hasOwnProperty.call(S.imgs, k) && !keep[k]) forgetImg(k); }
  }
  function getImg(a) {
    var id = a.slice(2), o = S.imgs[id], old;
    if (o) return o;
    o = S.imgs[id] = { im: new root.Image(), ok: false, err: false };
    S.imgOrder.push(id);
    if (S.imgOrder.length > M.LIM.imgs + M.LIM.tokens + 8) { old = S.imgOrder.shift(); if (old !== id) delete S.imgs[old]; }
    o.im.onload = function () { o.ok = true; S.needS = true; frame(); };
    /* Échec réseau (4G instable) : jusqu'à 2 nouveaux essais (5 s puis 20 s). Aucun crossOrigin : le canvas n'est jamais exporté. */
    o.im.onerror = function () {
      var n = S.imgFail[id] || 0;
      o.err = true;
      if (n < 2) { S.imgFail[id] = n + 1; setTimeout(function () { if (S.imgs[id] === o && S.open) { forgetImg(id); S.needS = true; frame(); } }, n === 0 ? 5000 : 20000); }
      S.needS = true; frame();
    };
    o.im.src = (root.TYL_BLOB || '/_blob/') + id.replace(/[^\w-]/g, '');
    return o;
  }
  function strokePath(g, pts, ox, oy, scale, k) {
    var i;
    g.beginPath(); g.moveTo(ox + pts[0] / scale, (oy + pts[1] / scale) * k);
    for (i = 2; i < pts.length; i += 2) g.lineTo(ox + pts[i] / scale, (oy + pts[i + 1] / scale) * k);
    if (pts.length === 2) g.lineTo(ox + pts[0] / scale + 0.0001, (oy + pts[1] / scale) * k);
    g.stroke();
  }
  /* Dessin partagé (tableau-rendu.js, chargé à l'initialisation) : texte, flèche, formes, jetons visibles, murs, traits, images. Lecture seule. */
  var R = null;
  function drawEl(g, e, ar) {
    R = R || root.tylBoardDraw;
    if (!R) return;
    R.drawEl(g, e, ar, { colorOf: colorOf, theme: S.theme, img: getImg, s: S.dpr * S.ren.z * S.Wf, ox: S.dpr * S.ren.ox, oy: S.dpr * S.ren.oy, mj: false, dpr: S.dpr, deco: root.tylTK && root.tylTK.deco });
  }
  function paintStatic() {
    var cv = $('pbCv'), g = cv.getContext('2d'), bd = S.board, ar, els, i;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    if (!bd) return;
    ar = bd.ar; els = bd.els; S.theme = themeColors();
    setUnits(g);
    g.fillStyle = bd.bg || S.theme.surface; g.fillRect(0, 0, 1, 1 / ar);
    g.strokeStyle = S.theme.line; g.lineWidth = 1 / (S.Wf * S.ren.z); g.strokeRect(0, 0, 1, 1 / ar);
    g.save(); g.beginPath(); g.rect(0, 0, 1, 1 / ar); g.clip();
    for (i = 0; i < els.length; i++) drawEl(g, els[i], ar);
    g.restore();
  }
  function paintLive() {
    var lv = $('pbLv'), g = lv.getContext('2d'), bd = S.board, ar, k, l, i, st, now, e, sc, c, d;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, lv.width, lv.height);
    if (!bd) return;
    ar = bd.ar; k = 1 / ar; S.theme = S.theme || themeColors();
    setUnits(g);
    g.save(); g.beginPath(); g.rect(0, 0, 1, k); g.clip();
    l = S.strokes.list();
    for (i = 0; i < l.length; i++) {
      st = l[i]; if (!st.pts.length) continue;
      g.strokeStyle = colorOf(st.c); g.lineWidth = st.th; g.lineCap = 'round'; g.lineJoin = 'round';
      strokePath(g, st.pts, 0, 0, 10000, k);
    }
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    d = S.dpr; sc = S.Wf * S.ren.z;
    if (S.kb) {
      c = { x: (S.ren.ox + S.cursor.x * sc) * d, y: (S.ren.oy + S.cursor.y * sc / ar) * d };
      g.strokeStyle = S.theme.ink; g.lineWidth = 2.5 * d;
      g.beginPath(); g.moveTo(c.x - 16 * d, c.y); g.lineTo(c.x + 16 * d, c.y); g.moveTo(c.x, c.y - 16 * d); g.lineTo(c.x, c.y + 16 * d); g.stroke();
      g.strokeStyle = S.theme.brass; g.lineWidth = 1.5 * d; g.beginPath(); g.arc(c.x, c.y, 10 * d, 0, 6.2832); g.stroke();
    }
    now = Date.now(); l = S.pings.list(now);
    for (i = 0; i < l.length; i++) {
      e = l[i];
      M.drawPing(g, (S.ren.ox + e.x * sc) * d, (S.ren.oy + e.y * sc / ar) * d, now - e.t, e.n, { dpr: d, reduced: reduced(), brass: S.theme.brass, ink: S.theme.ink, surface: S.theme.surface });
    }
  }
  function paint() { if (!S.open || !S.board) return; if (S.needS) { S.needS = false; paintStatic(); } if (S.needL) { S.needL = false; paintLive(); } }

  /* ---------- Pings ---------- */
  function pingTick() {
    clearTimeout(S.pingT); S.pingT = 0;
    if (!S.open) return;
    redraw(false);
    if (S.pings.list(Date.now()).length) S.pingT = setTimeout(pingTick, reduced() ? 500 : 60);
  }
  function announce(name) {
    var log = $('pbLog'), li;
    if (!log || !S.annc.take(Date.now())) return;
    li = doc.createElement('li'); li.textContent = 'Ping de ' + name;
    log.appendChild(li);
    while (log.children.length > 8) log.removeChild(log.firstChild);
  }
  function onPing(m) {
    var v, e;
    if (!S.open || !S.shown) return;
    v = M.validPing(m && m.data);
    if (!v) return;
    e = S.pings.add(v, (m && (m.by || m.peer)) || '', Date.now());
    if (!e) return;
    if (v.b && v.b !== S.bid) { S.pings.forget(e); return; }   /* ping prévu pour un autre tableau */
    announce(e.n); pingTick();
  }
  function onClr() { S.pings.clear(); redraw(false); }
  function buzz() { try { if (root.navigator && typeof root.navigator.vibrate === 'function') root.navigator.vibrate(30); } catch (e) { /* ignoré */ } }
  /* Émission : au plus 1 ping par 3 s et par joueuse, coordonnées dans la feuille (0..1). Seul envoi possible de ce fichier. */
  function sendPing(nx, ny) {
    var now = Date.now(), w;
    setPingMode(false);
    if (!S.shown || !S.board) { msg('Aucun tableau n’est montré pour l’instant.'); return false; }
    if (!(nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1)) { msg('Touche un point à l’intérieur du tableau.'); return false; }
    if (!S.svc || !S.svc.pp) { msg('Ping indisponible : connexion en cours.'); return false; }
    w = S.limiter.wait(now);
    if (w > 0 || !S.limiter.take(now)) { msg('Un ping toutes les 3 secondes : patiente un instant.'); return false; }
    try { S.svc.pp.emit('ping', M.makePing(nx, ny, S.name, S.bid)); } catch (e) { msg('Ping non envoyé.'); return false; }
    msg('Ping envoyé.', 2500);
    return true;
  }
  function setPingMode(on) {
    S.pingMode = !!on;
    var b = $('pbPing'); if (b) b.setAttribute('aria-pressed', S.pingMode ? 'true' : 'false');
    if (S.pingMode) msg('Touche le point à montrer.', 8000);
  }

  /* ---------- Gestes : glisser = déplacer ma vue, pincer = zoom, appui long = ping ---------- */
  function stagePt(ev) { var r = $('pbStage').getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top, cx: ev.clientX, cy: ev.clientY }; }
  function holdClear() { clearTimeout(S.holdT); S.holdT = 0; }
  function onDown(ev) {
    if (!S.board) return;
    if (ev.button !== undefined && ev.button > 0 && ev.pointerType === 'mouse') return;
    var p = stagePt(ev), ids;
    S.kb = false;
    S.ptr[ev.pointerId] = p;
    try { $('pbStage').setPointerCapture(ev.pointerId); } catch (x) { /* ignoré */ }
    ids = Object.keys(S.ptr);
    if (ids.length >= 2) { holdClear(); S.pan = null; startPinch(); return; }
    S.pan = { sx: p.x, sy: p.y, cx: p.cx, cy: p.cy, v0: { z: S.view.z, ox: S.view.ox, oy: S.view.oy }, moved: false, fired: false };
    holdClear();
    if (!S.pingMode) {
      S.holdT = setTimeout(function () {
        S.holdT = 0;
        var pan = S.pan;
        if (!pan || pan.moved || pan.fired || S.gest) return;
        pan.fired = true; buzz();
        var n = toNorm(pan.cx, pan.cy);
        sendPing(n.x, n.y);
      }, HOLD_MS);
    }
  }
  function onMove(ev) {
    var p = S.ptr[ev.pointerId], q, pan = S.pan, dx, dy;
    if (!p) return;
    q = stagePt(ev); S.ptr[ev.pointerId] = q;
    if (S.gest) { movePinch(); return; }
    if (!pan || pan.fired) return;
    dx = q.x - pan.sx; dy = q.y - pan.sy;
    if (!pan.moved && Math.sqrt(dx * dx + dy * dy) > MOVE_PX) { pan.moved = true; holdClear(); }
    if (pan.moved) { S.view = { z: pan.v0.z, ox: pan.v0.ox + dx, oy: pan.v0.oy + dy }; previewView(); }
  }
  function onUp(ev) {
    var pan = S.pan, was = !!S.ptr[ev.pointerId], n;
    delete S.ptr[ev.pointerId];
    try { $('pbStage').releasePointerCapture(ev.pointerId); } catch (x) { /* ignoré */ }
    if (!was) return;
    holdClear();
    if (S.gest) { if (!Object.keys(S.ptr).length) { S.gest = null; commitView(); } return; }
    S.pan = null;
    if (!pan) return;
    if (pan.moved) { commitView(); return; }
    if (S.pingMode && !pan.fired && ev.type === 'pointerup') { n = toNorm(pan.cx, pan.cy); sendPing(n.x, n.y); }
  }
  function startPinch() {
    var ids = Object.keys(S.ptr), a = S.ptr[ids[0]], b = S.ptr[ids[1]];
    S.gest = { d0: Math.max(10, Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2))), c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { z: S.view.z, ox: S.view.ox, oy: S.view.oy } };
  }
  function movePinch() {
    var ids = Object.keys(S.ptr), a = S.ptr[ids[0]], b = S.ptr[ids[1]], g = S.gest, d1, c1, z1, k;
    if (!a || !b || !g) return;
    d1 = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)); c1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    z1 = Math.max(0.5, Math.min(8, g.v0.z * d1 / g.d0)); k = z1 / g.v0.z;
    S.view = { z: z1, ox: c1.x - (g.c0.x - g.v0.ox) * k, oy: c1.y - (g.c0.y - g.v0.oy) * k };
    previewView();
  }
  function onWheel(ev) {
    if (!S.board) return;
    ev.preventDefault();
    var p = stagePt(ev), f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015));
    zoomAt(f, p.x, p.y); previewView();
    clearTimeout(S.commitT); S.commitT = setTimeout(commitView, 140);
  }
  function onKey(ev) {
    var st = ev.shiftKey ? KEY_BIG : KEY_STEP, k = ev.key, c = S.cursor;
    if (!S.board) return;
    if (k === 'ArrowLeft') c.x = Math.max(0, c.x - st);
    else if (k === 'ArrowRight') c.x = Math.min(1, c.x + st);
    else if (k === 'ArrowUp') c.y = Math.max(0, c.y - st);
    else if (k === 'ArrowDown') c.y = Math.min(1, c.y + st);
    else if (k === 'Enter' || k === ' ') { ev.preventDefault(); S.kb = true; sendPing(c.x, c.y); redraw(false); return; }
    else if (k === '+' || k === '=') { zoomAt(1.4, S.SW / 2, S.SH / 2); commitView(); return; }
    else if (k === '-') { zoomAt(1 / 1.4, S.SW / 2, S.SH / 2); commitView(); return; }
    else if (k === '0') { fitView(); return; }
    else return;
    ev.preventDefault(); S.kb = true; redraw(false);
  }

  /* ---------- Données : document « board/live » (lecture), diffusions du MJ ---------- */
  function services() {
    if (S.svc) return Promise.resolve(S.svc);
    var c = root.claude;
    if (!c || !c.use) return Promise.resolve(null);
    return Promise.all([c.use('db'), c.use('board'), c.use('boardPing'), c.use('user')]).then(function (r) {
      S.svc = { db: r[0] || null, bc: r[1] || null, pp: r[2] || null, user: r[3] || null };
      return S.svc;
    }, function () { return null; });
  }
  function readName() {
    try {
      if (S.svc && S.svc.user && S.svc.user.me) return Promise.resolve(S.svc.user.me()).then(function (m) { S.name = M.cleanName(m && m.name) || ''; }, function () { /* ignoré */ });
    } catch (e) { /* ignoré */ }
    return Promise.resolve();
  }
  function applyLive(d) {
    var on = !!(d && d.on === true), was = S.shown, bid, v, arOld = S.board ? S.board.ar : 0, same, ids = {};
    if (on) {
      v = M.validateBoard(d); bid = String(d.bid || '').slice(0, 40);
      /* défense en profondeur : jamais d'élément caché ni de règle, même si une projection future en laissait passer */
      v.board.els = v.board.els.filter(function (e) { return !e.hid && e.t !== 'rule'; });
      same = was && bid === S.bid;
      S.board = v.board; S.bid = bid; S.shown = true;
      if (same) { v.board.els.forEach(function (e) { ids[e.id] = 1; }); S.strokes.drop(ids); } else S.strokes.clear();   /* seuls les traits désormais enregistrés sont retirés */
      pruneImgs();
      if (S.open) {
        if (!same || arOld !== S.board.ar) { layout(); fitView(); } else redraw(true);
        syncOpen();
      }
      if (!was && !S.first) toast('Le MJ a montré un tableau.');
    } else {
      S.shown = false; S.board = null; S.bid = ''; S.strokes.clear(); S.pings.clear(); pruneImgs();
      if (was && S.open) closeBoard(true, 'Le MJ a caché le tableau.');
      else if (was) toast('Le MJ a caché le tableau.');
      else if (S.open) syncOpen();
    }
    S.first = false;
    updateEntry();
  }
  function refresh() {
    if (!S.svc || !S.svc.db) return Promise.resolve();
    var g0 = S.gen;   /* un get() parti avant un instantané plus récent est périmé : on l'ignore */
    return Promise.resolve(S.svc.db.doc('board/live').get()).then(function (ds) { if (S.gen !== g0) return; applyLive(ds && ds.exists ? ds.data() : null); }, function () { /* ignoré */ });
  }
  function onLive(m) {
    var v;
    if (!S.open || !S.shown) return;
    v = M.validLive(m && m.data);
    if (!v || !S.strokes.apply(v, Date.now())) return;
    if (v.e) { clearTimeout(S.expT); S.expT = setTimeout(function () { S.strokes.expire(Date.now(), 8000); redraw(false); }, 8200); }
    redraw(false);
  }
  function watch() {
    var db = S.svc && S.svc.db;
    if (!db) return;
    try {
      db.doc('board/live').onSnapshot(function (sn) { S.gen++; applyLive(sn && sn.exists ? sn.data() : null); }, function () { /* ignoré */ });
    } catch (e) { /* ignoré */ }
    refresh();
  }
  function listen() {
    var bc = S.svc && S.svc.bc, pp = S.svc && S.svc.pp;
    unlisten();
    try { if (bc) { S.unsubs.push(bc.on('live', onLive)); S.unsubs.push(bc.on('clr', onClr)); S.unsubs.push(bc.onConnection(function (up) { if (up && S.connSeen && S.open) refresh(); S.connSeen = true; })); } } catch (e) { /* ignoré */ }
    try { if (pp) S.unsubs.push(pp.on('ping', onPing)); } catch (e2) { /* ignoré */ }
  }
  function unlisten() { var u; S.connSeen = false; while (S.unsubs.length) { u = S.unsubs.pop(); try { if (typeof u === 'function') u(); } catch (e) { /* ignoré */ } } }

  /* ---------- Ouverture / fermeture (comme la feuille de sorts : Échap, Retour Android, focus rendu) ---------- */
  function syncOpen() {
    var e = $('pbEmpty'), n = $('pbName');
    if (n) n.textContent = S.board ? S.board.name : '';
    if (e) { e.hidden = !!S.board; e.textContent = S.board ? '' : 'Aucun tableau n’est montré pour l’instant.'; }
    $('pbPing').disabled = !S.board;
    if (!S.board) msg('Aucun tableau n’est montré pour l’instant.', 0); else if ($('pbMsg').textContent.indexOf('Aucun') === 0) msg('');
    updateAlt();
    if (S.board) { layout(); S.theme = themeColors(); redraw(true); }
    else { var c = $('pbCv').getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, $('pbCv').width, $('pbCv').height); redraw(false); }
  }
  function trap(ev) {
    var ov = $('pbOv'), f = ov.querySelectorAll('button:not([disabled]):not([hidden]),#pbStage'), vis = [], i, a = doc.activeElement;
    for (i = 0; i < f.length; i++) if (f[i].offsetParent !== null || f[i].getClientRects().length) vis.push(f[i]);
    if (!vis.length) return;
    if (ev.shiftKey && (a === vis[0] || !ov.contains(a))) { ev.preventDefault(); vis[vis.length - 1].focus(); }
    else if (!ev.shiftKey && (a === vis[vis.length - 1] || !ov.contains(a))) { ev.preventDefault(); vis[0].focus(); }
  }
  function onDocKey(ev) {
    if (!S.open) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeBoard(true); }
    else if (ev.key === 'Tab') trap(ev);
  }
  function onPop() { if (!S.pushed) return; S.pushed = false; closeBoard(false); }
  function onResize() { if (S.open && S.board) { layout(); fitView(); } }
  function onVisible() { if (S.open && doc.visibilityState !== 'hidden') refresh(); }
  function onTheme() { if (S.open && S.board) { S.theme = themeColors(); redraw(true); } }
  function openBoard(opener) {
    if (S.open || !enabled()) return;
    if (doc.querySelector('.sped.open')) return;   /* l'éditeur de sorts est ouvert dessous : on ne le recouvre pas */
    build();
    S.opener = opener || doc.activeElement;
    try { var mn = $('pvMenu'); if (mn) mn.open = false; } catch (e) { /* ignoré */ }
    var ov = $('pbOv');
    ov.hidden = false; S.open = true; doc.documentElement.className += ' pb-lock';
    S.pings.clear(); S.strokes.clear(); S.pingMode = false; $('pbPing').setAttribute('aria-pressed', 'false'); msg('');
    if (root.history && root.history.pushState) { try { root.history.pushState({ tylBoard: 1 }, ''); S.pushed = true; } catch (e2) { S.pushed = false; } }
    root.addEventListener('keydown', onDocKey, true);   /* capture sur window : passe avant les écouteurs de l'appli */
    if (root.matchMedia) { try { S.mq = root.matchMedia('(prefers-color-scheme: dark)'); if (S.mq.addEventListener) S.mq.addEventListener('change', onTheme); else if (S.mq.addListener) S.mq.addListener(onTheme); } catch (e3) { S.mq = null; } }
    if (!root.tylBoardDraw && M.need) M.need(['tableau-rendu.js'], function () { R = root.tylBoardDraw; if (R) { if (S.open) { msg(''); redraw(true); } } else if (S.open) msg('Affichage du tableau indisponible (réseau) : ferme puis rouvre pour r\u00E9essayer.', 0); });
    root.addEventListener('popstate', onPop); root.addEventListener('resize', onResize); doc.addEventListener('visibilitychange', onVisible);
    updateEntry();
    syncOpen(); fitView();
    $('pbClose').focus();
    services().then(function (svc) {
      if (!svc || !S.open) return;
      readName(); listen();
      return refresh();
    }).then(function () { if (S.open && S.board) { layout(); fitView(); } });
  }
  function closeBoard(viaUi, why) {
    var ov = $('pbOv'), o = S.opener;
    if (!ov || !S.open) return;
    holdClear(); clearTimeout(S.pingT); clearTimeout(S.commitT);
    S.ptr = {}; S.pan = null; S.gest = null; S.pingMode = false;
    unlisten();
    S.pings.clear(); S.strokes.clear(); clearTimeout(S.expT);
    if (S.mq) { try { if (S.mq.removeEventListener) S.mq.removeEventListener('change', onTheme); else if (S.mq.removeListener) S.mq.removeListener(onTheme); } catch (e4) { /* ignoré */ } S.mq = null; }
    S.open = false; ov.hidden = true;
    /* mémoire (téléphone) : canvas à 0 (layout() les redimensionne à la réouverture), cache d'images vidé */
    $('pbCv').width = $('pbCv').height = $('pbLv').width = $('pbLv').height = 0;
    S.imgOrder.slice().forEach(forgetImg); S.imgs = {}; S.imgOrder = []; S.imgFail = {};
    doc.documentElement.className = doc.documentElement.className.replace(/\s*pb-lock/g, '');
    root.removeEventListener('keydown', onDocKey, true); root.removeEventListener('popstate', onPop); root.removeEventListener('resize', onResize); doc.removeEventListener('visibilitychange', onVisible);
    if (S.pushed && viaUi) { S.pushed = false; try { if (root.history.state && root.history.state.tylBoard) root.history.back(); } catch (e) { /* ignoré */ } }
    if (!S.shown) { S.board = null; }
    if (why) toast(why);
    updateEntry();
    try { if (o && o.focus && !o.hidden) o.focus(); } catch (e2) { /* ignoré */ }
  }

  function wire() {
    var ov = $('pbOv'), st = $('pbStage');
    st.addEventListener('pointerdown', onDown); st.addEventListener('pointermove', onMove); st.addEventListener('pointerup', onUp); st.addEventListener('pointercancel', onUp);
    st.addEventListener('wheel', onWheel, { passive: false });
    st.addEventListener('keydown', onKey);
    st.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    st.addEventListener('blur', function () { if (S.kb) { S.kb = false; redraw(false); } });
    ov.addEventListener('click', function (ev) {
      var t = ev.target, b = t && t.closest ? t.closest('button') : null;
      if (!b) return;
      if (b.id === 'pbClose') closeBoard(true);
      else if (b.id === 'pbPing') setPingMode(!S.pingMode);
      else if (b.id === 'pbZin') { zoomAt(1.4, S.SW / 2, S.SH / 2); commitView(); }
      else if (b.id === 'pbZout') { zoomAt(1 / 1.4, S.SW / 2, S.SH / 2); commitView(); }
      else if (b.id === 'pbFit') fitView();
    });
  }

  /* ---------- Point d'entrée (app.js : boardPlayerUi) ---------- */
  function init() {
    if (S.inited || !enabled()) { updateEntry(); return; }
    S.inited = true;
    if (M.need) M.need(['tableau-rendu.js'], function () { R = root.tylBoardDraw; if (S.open) redraw(true); });
    buildEntry();
    var b = $('pvBoardBtn');
    if (b) b.addEventListener('click', function () { openBoard(b); });
    updateEntry();
    services().then(function (svc) { if (svc) { readName(); watch(); } });
  }
  function state() {
    var bd = S.board, now = Date.now();
    return { open: S.open, shown: S.shown, bid: S.bid, ar: bd ? bd.ar : 0, name: bd ? bd.name : '', els: bd ? JSON.parse(JSON.stringify(bd.els)) : [],
      strokes: S.strokes.list().length, imgs: Object.keys(S.imgs), pings: S.pings.list(now).map(function (p) { return { x: p.x, y: p.y, n: p.n }; }),
      view: { z: S.view.z, ox: S.view.ox, oy: S.view.oy }, cursor: { x: S.cursor.x, y: S.cursor.y }, anim: !reduced(), pingMode: S.pingMode, who: S.name };
  }

  root.tylBoardPlayer = { redraw: function () { if (S.open && S.board) { redraw(true); updateAlt(); } }, init: init, open: openBoard, close: function () { closeBoard(true); }, state: state, toScreen: toScreen };
})(window);
