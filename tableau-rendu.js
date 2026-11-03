/* tableau-rendu.js : dessin des éléments du tableau (partagé MJ + joueuse) et petits calculs purs (règle, jetons, formes).
   Aucune écriture, aucun réseau. Tout texte est dessiné par fillText (jamais d'HTML). ES5. */
(function (root) {
  'use strict';
  var M = (typeof module === 'object' && module && module.exports && typeof require === 'function') ? require('./tableau-modele.js') : root.tylBoardModel;
  if (!M) return;
  var TOK_SZ = [0.04, 0.065, 0.1], TXT_SZ = [0.022, 0.035, 0.06], WALL_TH = 0.014, PI2 = 6.2832;

  /* ---------- calculs purs ---------- */
  function first(s) { var c = s.charCodeAt(0); return (c >= 0xd800 && c <= 0xdbff) ? s.slice(0, 2) : s.charAt(0); }
  function initials(lb) {
    var t = String(lb == null ? '' : lb).replace(/^\s+|\s+$/g, ''), p = t ? t.split(/\s+/) : [];
    if (!p.length) return '';
    return (first(p[0]) + (p[1] ? first(p[1]) : '')).toUpperCase();
  }
  function textOn(col) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(col || '')), r, g, b, a;
    if (m) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4), 16); }
    else { a = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(String(col || '')); if (!a) return '#ffffff'; r = +a[1]; g = +a[2]; b = +a[3]; }
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#111111' : '#ffffff';
  }
  /* Distance entre deux points normalisés (y en fraction de la hauteur) : cases et mètres selon l'échelle {m, u}. */
  function rulerDist(a, b, ar, sc) {
    var dx = b.x - a.x, dy = (b.y - a.y) / ar, len = Math.sqrt(dx * dx + dy * dy), cases = len / sc.u;
    return { len: len, cases: cases, m: cases * sc.m };
  }
  function fmtNum(v) { var r = Math.round(v * 10) / 10; return String(r).replace('.', ','); }
  function fmtDist(m) { return fmtNum(m) + ' m'; }
  function fmtCases(c) { var r = Math.round(c * 10) / 10; return fmtNum(c) + (r === 1 ? ' case' : ' cases'); }
  /* Échelle : m mètres par case, n cases sur la largeur de la feuille (5 à 1000). */
  function scaleFrom(m, n) {
    var nn = M.num(n, 5, 1000, 20), mm = M.num(m, 0.01, 1000, 1.5);
    return { m: mm, u: Math.round(1 / nn * 1e6) / 1e6 };
  }
  function casesAcross(sc) { return Math.round(1 / sc.u * 100) / 100; }
  function shapeFromDrag(kind, a, b, ar) {
    var w = b.x - a.x, h = b.y - a.y;
    if (Math.abs(w) < 0.004 && Math.abs(h) < 0.004 * ar) return null;
    if (kind === 'line') return { t: 'shape', k: 'line', x: a.x, y: a.y, w: w, h: h };
    return { t: 'shape', k: kind === 'ellipse' ? 'ellipse' : 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(w), h: Math.abs(h) };
  }
  function lineFromDrag(kind, a, b) {
    var dx = Math.round((b.x - a.x) * 10000), dy = Math.round((b.y - a.y) * 10000), pts;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return null;
    pts = kind === 'wall-rect' ? [0, 0, dx, 0, dx, dy, 0, dy, 0, 0] : [0, 0, dx, dy];
    return { t: kind === 'arrow' ? 'arrow' : 'wall', x: a.x, y: a.y, pts: pts };
  }
  function nextName(names) {
    var n = 1, base = 'Tableau', ok = false, c;
    while (!ok) { c = n === 1 ? base : base + ' ' + n; ok = names.indexOf(c) < 0; if (!ok) n++; }
    return c;
  }
  function copyName(n) { return M.cut(String(n) + '', 30) + ' (copie)'; }
  function canAddBoard(count) { return count < M.LIM.boards; }

  /* ---------- dessin ----------
     C : { colorOf(c), theme:{ink,brass,surface,line}, img(a)->{im,ok}, s (pixels par largeur), ox, oy (décalage px), mj (éléments cachés atténués) } ;
     g est déjà dans le repère « largeur = 1 » (setTransform), y des éléments multiplié par 1/ar. */
  function path(g, e, k) {
    var i, n = e.pts.length;
    g.beginPath(); g.moveTo(e.x + e.pts[0] / 10000, (e.y + e.pts[1] / 10000) * k);
    for (i = 2; i < n; i += 2) g.lineTo(e.x + e.pts[i] / 10000, (e.y + e.pts[i + 1] / 10000) * k);
    if (n === 2) g.lineTo(e.x + e.pts[0] / 10000 + 0.0001, (e.y + e.pts[1] / 10000) * k);
  }
  function arrowHead(g, e, k, col) {
    var n = e.pts.length, bx = e.x + e.pts[n - 2] / 10000, by = (e.y + e.pts[n - 1] / 10000) * k, ax, ay, i, ang, L = Math.max(e.th * 4.5, 0.014);
    for (i = n - 4; i >= 0; i -= 2) { ax = e.x + e.pts[i] / 10000; ay = (e.y + e.pts[i + 1] / 10000) * k; if (Math.abs(ax - bx) + Math.abs(ay - by) > 1e-5) break; }
    if (ax === undefined || Math.abs(ax - bx) + Math.abs(ay - by) <= 1e-5) return;
    ang = Math.atan2(by - ay, bx - ax);
    g.fillStyle = col; g.beginPath(); g.moveTo(bx, by);
    g.lineTo(bx - L * Math.cos(ang - 0.5), by - L * Math.sin(ang - 0.5)); g.lineTo(bx - L * Math.cos(ang + 0.5), by - L * Math.sin(ang + 0.5));
    g.closePath(); g.fill();
  }
  function drawToken(g, e, C, k) {
    var cx = e.x, cy = e.y * k, r = e.sz / 2, col = C.colorOf(e.c), o = e.a ? C.img(e.a) : null, im, w, h, s, t, px;
    g.save();
    g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, PI2); g.fill();
    if (o && o.ok) {
      im = o.im; w = im.naturalWidth || im.width; h = im.naturalHeight || im.height; s = Math.min(w, h);
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, PI2); g.clip();
      if (s > 0) g.drawImage(im, (w - s) / 2, (h - s) / 2, s, s, cx - r, cy - r, 2 * r, 2 * r);
      g.restore();
    }
    g.lineWidth = Math.max(0.0015, r * 0.14); g.strokeStyle = o && o.ok ? col : C.theme.surface;
    g.beginPath(); g.arc(cx, cy, r - g.lineWidth / 2, 0, PI2); g.stroke();
    g.restore();
    t = (o && o.ok) ? '' : initials(e.lb);
    if (t) {
      px = Math.max(7, e.sz * C.s * (t.length > 2 ? 0.34 : 0.42));
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = textOn(col); g.font = '700 ' + px + 'px Alegreya Sans, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, C.ox + cx * C.s, C.oy + cy * C.s); g.restore();
    }
  }
  function drawEl(g, e, ar, C) {
    var k = 1 / ar, b, o, col, cx, cy, hid = !!(C.mj && e.hid);
    if (hid) g.save();
    if (hid) g.globalAlpha = 0.4;
    if (e.t === 'img') {
      b = M.imgBox(e, ar); o = C.img(e.a);
      if (o.ok) g.drawImage(o.im, b.x, b.y * k, b.w, b.h * k);
      else { g.save(); g.strokeStyle = C.theme.line; g.lineWidth = 0.003; g.strokeRect(b.x, b.y * k, b.w, b.h * k); g.restore(); }
    } else if (e.pts) {
      col = C.colorOf(e.c); g.strokeStyle = col; g.lineWidth = e.th; g.lineJoin = e.t === 'wall' ? 'miter' : 'round'; g.lineCap = e.t === 'wall' ? 'square' : 'round';
      path(g, e, k); g.stroke();
      if (e.t === 'arrow') arrowHead(g, e, k, col);
    } else if (e.t === 'text') {
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = C.colorOf(e.c); g.font = Math.max(6, e.fs * C.s) + 'px Alegreya Sans, sans-serif'; g.textBaseline = 'top';
      g.fillText(e.tx, C.ox + e.x * C.s, C.oy + e.y * k * C.s); g.restore();
    } else if (e.t === 'shape') {
      col = C.colorOf(e.c); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = e.th; g.lineJoin = 'round'; g.lineCap = 'round';
      if (e.k === 'line') { g.beginPath(); g.moveTo(e.x, e.y * k); g.lineTo(e.x + e.w, (e.y + e.h) * k); g.stroke(); }
      else if (e.k === 'ellipse') {
        cx = e.x + e.w / 2; cy = (e.y + e.h / 2) * k;
        g.save(); g.beginPath(); g.translate(cx, cy); g.scale(Math.max(1e-6, e.w / 2), Math.max(1e-6, e.h * k / 2)); g.arc(0, 0, 1, 0, PI2); g.restore();
        if (e.f) { g.save(); g.globalAlpha = (hid ? 0.4 : 1) * 0.25; g.fill(); g.restore(); }
        g.stroke();
      } else {
        if (e.f) { g.save(); g.globalAlpha = (hid ? 0.4 : 1) * 0.25; g.fillRect(e.x, e.y * k, e.w, e.h * k); g.restore(); }
        g.strokeRect(e.x, e.y * k, e.w, e.h * k);
      }
    } else if (e.t === 'token') drawToken(g, e, C, k);
    if (hid) {
      b = M.elBox(e, ar); g.globalAlpha = 1; g.strokeStyle = C.theme.brass; g.lineWidth = 0.0025; g.setLineDash([0.008, 0.006]);
      g.strokeRect(b.x, b.y * k, b.w, b.h * k); g.setLineDash([]); g.restore();
    }
  }
  /* Règle (MJ seul, jamais enregistrée ni diffusée) : trait, graduation à chaque case, étiquette. */
  function drawRule(g, a, b, ar, sc, C) {
    var k = 1 / ar, d = rulerDist(a, b, ar, sc), n = Math.min(120, Math.floor(d.cases)), i, ux, uy, l = d.len || 1, px, py, t, mx, my, w;
    g.save();
    g.strokeStyle = C.theme.brass; g.lineWidth = 0.004; g.lineCap = 'round';
    g.beginPath(); g.moveTo(a.x, a.y * k); g.lineTo(b.x, b.y * k); g.stroke();
    ux = (b.x - a.x) / l; uy = ((b.y - a.y) * k) / l; px = -uy; py = ux;
    g.lineWidth = 0.0025;
    for (i = 0; i <= n; i++) {
      t = i * sc.u; g.beginPath();
      g.moveTo(a.x + ux * t + px * 0.007, a.y * k + uy * t + py * 0.007); g.lineTo(a.x + ux * t - px * 0.007, a.y * k + uy * t - py * 0.007); g.stroke();
    }
    g.beginPath(); g.arc(a.x, a.y * k, 0.006, 0, PI2); g.fillStyle = C.theme.brass; g.fill();
    g.beginPath(); g.arc(b.x, b.y * k, 0.006, 0, PI2); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    t = fmtDist(d.m) + ' · ' + fmtCases(d.cases);
    g.font = '700 15px Alegreya Sans, sans-serif'; g.textBaseline = 'middle'; w = g.measureText(t).width;
    mx = C.ox + ((a.x + b.x) / 2) * C.s; my = C.oy + ((a.y + b.y) / 2) * k * C.s - 22;
    g.fillStyle = C.theme.surface; g.globalAlpha = 0.94; g.fillRect(mx - w / 2 - 6, my - 13, w + 12, 26);
    g.globalAlpha = 1; g.strokeStyle = C.theme.brass; g.lineWidth = 1; g.strokeRect(mx - w / 2 - 6, my - 13, w + 12, 26);
    g.fillStyle = C.theme.ink; g.fillText(t, mx - w / 2, my);
    g.restore();
    return t;
  }

  var api = { TOK_SZ: TOK_SZ, TXT_SZ: TXT_SZ, WALL_TH: WALL_TH, initials: initials, textOn: textOn, rulerDist: rulerDist, fmtNum: fmtNum, fmtDist: fmtDist, fmtCases: fmtCases,
    scaleFrom: scaleFrom, casesAcross: casesAcross, shapeFromDrag: shapeFromDrag, lineFromDrag: lineFromDrag, nextName: nextName, copyName: copyName, canAddBoard: canAddBoard,
    drawEl: drawEl, drawRule: drawRule };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.tylBoardDraw = api;
})(typeof window !== 'undefined' ? window : this);
