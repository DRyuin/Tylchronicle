/* tableau-modele.js : modèle pur du tableau blanc partagé (validation, projection visible, trait, historique, ping).
   Aucune écriture, aucun accès réseau ni base : chargé par la vue MJ (tableau.js) ET par la vue joueuse (tableau-joueuse.js). ES5. */
(function (root) {
  'use strict';

  /* =================== Modèle pur =================== */
  var LIM = { els: 400, pts: 400, text: 200, label: 24, totalPts: 20000, imgs: 12, texts: 60, tokens: 60, boards: 12,
    tokImg: 60 * 1024, imgPixels: 40e6, imgDim: 12000, imgTarget: 400 * 1024, imgMax: 800 * 1024, imgSide: 1600, undo: 50, doc: 700000, live: 500000 };
  var TYPES = { img: 1, stroke: 1, text: 1, arrow: 1, shape: 1, token: 1, wall: 1, rule: 1 };
  var PTS_T = { stroke: 1, arrow: 1, wall: 1, rule: 1 };
  var ID_RE = /^[a-z0-9]{8}$/, ASSET_RE = /^a:[\w-]{4,64}$/, HEX_RE = /^#[0-9a-f]{6}$/i;
  var IMG_TRIES = [{ q: 0.82, side: 1600 }, { q: 0.7, side: 1600 }, { q: 0.55, side: 1600 }, { q: 0.55, side: 1200 }];
  var hasOwn = Object.prototype.hasOwnProperty;

  function num(v, lo, hi, d) { v = +v; if (typeof v !== 'number' || !isFinite(v)) return d; return v < lo ? lo : v > hi ? hi : v; }
  function rnd36(n) {
    var s = '', i, a;
    try { if (root.crypto && root.crypto.getRandomValues) { a = new Uint8Array(n); root.crypto.getRandomValues(a); for (i = 0; i < n; i++) s += (a[i] % 36).toString(36); return s; } } catch (e) { s = ''; }
    for (i = 0; i < n; i++) s += Math.floor(Math.random() * 36).toString(36);
    return s;
  }
  function newId() { return rnd36(8); }
  function normColor(c) {
    if (typeof c === 'number' && c === Math.floor(c) && c >= 0 && c <= 11) return c;
    if (typeof c === 'string' && HEX_RE.test(c)) return c.toLowerCase();
    return 0;
  }
  function cut(s, n) { return String(s == null ? '' : s).slice(0, n); }

  function normEl(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    var t = r.t;
    if (typeof t !== 'string' || !hasOwn.call(TYPES, t)) return null;
    var e = { id: (typeof r.id === 'string' && ID_RE.test(r.id)) ? r.id : newId(), t: t, x: num(r.x, -1, 2, 0), y: num(r.y, -1, 2, 0) }, i, p, q;
    if (t === 'img') {
      if (typeof r.a !== 'string' || !ASSET_RE.test(r.a)) return null;
      e.a = r.a; e.w = num(r.w, 0.005, 2, 0.3); e.r = num(r.r, 0.05, 20, 1);
      if (r.h != null) e.h = num(r.h, 0.005, 2, 0.3);
    } else if (hasOwn.call(PTS_T, t)) {
      p = Array.isArray(r.pts) ? r.pts : [];
      q = [];
      for (i = 0; i < p.length && q.length < LIM.pts * 2; i++) { if (typeof p[i] === 'number' && isFinite(p[i])) q.push(Math.round(num(p[i], -20000, 20000, 0))); }
      if (q.length % 2) q.pop();
      if (q.length < 4) return null;
      e.pts = q; e.th = num(r.th, 0.002, 0.03, 0.005); e.c = normColor(r.c);
    } else if (t === 'text') {
      e.tx = cut(r.tx, LIM.text); if (!e.tx) return null;
      e.fs = num(r.fs, 0.01, 0.2, 0.03); e.c = normColor(r.c);
    } else if (t === 'shape') {
      e.k = (r.k === 'ellipse' || r.k === 'line') ? r.k : 'rect';
      e.w = num(r.w, e.k === 'line' ? -2 : 0, 2, 0.1); e.h = num(r.h, e.k === 'line' ? -2 : 0, 2, 0.1); e.th = num(r.th, 0.002, 0.03, 0.005); e.c = normColor(r.c);
      if (r.f && e.k !== 'line') e.f = true;
    } else if (t === 'token') {
      e.k = (r.k === 'npc' || r.k === 'mob') ? r.k : 'pc';
      e.sz = num(r.sz, 0.01, 0.3, 0.05); e.c = normColor(r.c);
      if (typeof r.a === 'string' && ASSET_RE.test(r.a)) e.a = r.a;
      if (typeof r.cid === 'string' && /^[\w-]{1,40}$/.test(r.cid)) e.cid = r.cid;
    }
    if (r.z != null) e.z = Math.round(num(r.z, 0, 100000, 0));
    if (r.rot != null && t !== 'stroke') e.rot = num(r.rot, -360, 360, 0);
    if (r.lb != null && r.lb !== '') e.lb = cut(r.lb, LIM.label);
    if (r.hid) e.hid = true;
    if (r.lk) e.lk = true;
    return e;
  }

  function validateBoard(b) {
    var src = (b && typeof b === 'object') ? b : {}, out = { v: 1, name: cut(src.name, 40) || 'Tableau', ar: num(src.ar, 0.5, 2, 1.6),
      bg: (typeof src.bg === 'string' && HEX_RE.test(src.bg)) ? src.bg.toLowerCase() : null,
      scale: { m: num(src.scale && src.scale.m, 0.01, 1000, 1.5), u: num(src.scale && src.scale.u, 0.001, 1, 0.05) },
      rv: Math.round(num(src.rv, 0, 1e12, 0)), upd: Math.round(num(src.upd, 0, 1e15, 0)), els: [] };
    if (typeof src.w === 'string' && ID_RE.test(src.w)) out.w = src.w;
    var list = Array.isArray(src.els) ? src.els : [], seen = {}, nImg = 0, nTx = 0, nTk = 0, nPts = 0, dropped = 0, i, e, np;
    for (i = 0; i < list.length; i++) {
      e = normEl(list[i]);
      if (!e) { dropped++; continue; }
      np = e.pts ? e.pts.length / 2 : 0;
      if (out.els.length >= LIM.els || (e.t === 'img' && nImg >= LIM.imgs) || (e.t === 'text' && nTx >= LIM.texts) || (e.t === 'token' && nTk >= LIM.tokens) || nPts + np > LIM.totalPts) { dropped++; continue; }
      if (hasOwn.call(seen, e.id)) e.id = newId();
      while (hasOwn.call(seen, e.id)) e.id = newId();
      seen[e.id] = 1;
      if (e.t === 'img') nImg++; else if (e.t === 'text') nTx++; else if (e.t === 'token') nTk++;
      nPts += np;
      e.z = out.els.length;
      out.els.push(e);
    }
    return { board: out, dropped: dropped };
  }

  /* Projection visible des joueuses : jamais d'élément hid, jamais cid / hid / lk. */
  function project(board, bid, shown) {
    var vb = validateBoard(board).board, els = [], i, e;
    for (i = 0; i < vb.els.length; i++) {
      e = vb.els[i];
      if (e.hid || e.t === 'rule') continue;
      delete e.cid; delete e.hid; delete e.lk;
      els.push(e);
    }
    return { v: 1, on: true, bid: String(bid || ''), name: vb.name, ar: vb.ar, bg: vb.bg, scale: vb.scale, rv: vb.rv, els: els, shown: shown || 0 };
  }
  function hiddenLive(rv) { return { v: 1, on: false, rv: rv || 0 }; }

  /* Simplification de trait (Douglas-Peucker itératif). pts : [[x,y],…] ; y en fraction de la hauteur, ar = l/h. */
  function simplify(pts, maxN, eps0, ar) {
    var n = pts.length, k = (ar > 0 ? 1 / ar : 1);
    if (n <= 2 || (n <= maxN && eps0 === undefined)) return pts.slice();
    function dseg(p, a, b) {
      var px = p[0], py = p[1] * k, ax = a[0], ay = a[1] * k, dx = b[0] - ax, dy = b[1] * k - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.sqrt(Math.pow(px - ax - t * dx, 2) + Math.pow(py - ay - t * dy, 2));
    }
    function rdp(eps) {
      var keep = [], st = [[0, n - 1]], s, i, mx, ix, d;
      keep[0] = true; keep[n - 1] = true;
      while (st.length) {
        s = st.pop(); mx = 0; ix = -1;
        for (i = s[0] + 1; i < s[1]; i++) { d = dseg(pts[i], pts[s[0]], pts[s[1]]); if (d > mx) { mx = d; ix = i; } }
        if (ix >= 0 && mx > eps) { keep[ix] = true; st.push([s[0], ix], [ix, s[1]]); }
      }
      var out = [];
      for (i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
      return out;
    }
    var eps = eps0 || 0.0004, res = rdp(eps), j, out2, step;
    while (res.length > maxN && eps < 1) { eps *= 1.6; res = rdp(eps); }
    if (res.length > maxN) {
      out2 = []; step = (res.length - 1) / (maxN - 1);
      for (j = 0; j < maxN; j++) out2.push(res[Math.round(j * step)]);
      res = out2;
    }
    return res;
  }

  function strokeFromPoints(p, c, th, ar, id) {
    var s = simplify(p, LIM.pts, 0.0003, ar), x0, y0, pts = [], i;
    if (s.length < 2) s = [s[0] || [0.5, 0.5], [(s[0] || [0.5, 0.5])[0] + 0.0001, (s[0] || [0.5, 0.5])[1]]];
    x0 = s[0][0]; y0 = s[0][1];
    for (i = 0; i < s.length; i++) pts.push(Math.round((s[i][0] - x0) * 10000), Math.round((s[i][1] - y0) * 10000));
    return { id: (typeof id === 'string' && ID_RE.test(id)) ? id : newId(), t: 'stroke', x: Math.max(-1, Math.min(2, x0)), y: Math.max(-1, Math.min(2, y0)), pts: pts, c: c, th: th };
  }

  function imgBox(e, ar) { return { x: e.x, y: e.y, w: e.w, h: e.h != null ? e.h : e.w * ar / (e.r || 1) }; }
  function elBox(e, ar) {
    var i, mn, mx, my, ny, h;
    if (e.t === 'img') return imgBox(e, ar);
    if (e.pts) {
      mn = 1e9; mx = -1e9; ny = 1e9; my = -1e9;
      for (i = 0; i < e.pts.length; i += 2) { mn = Math.min(mn, e.pts[i]); mx = Math.max(mx, e.pts[i]); ny = Math.min(ny, e.pts[i + 1]); my = Math.max(my, e.pts[i + 1]); }
      h = (e.th || 0.005) / 2;
      return { x: e.x + mn / 10000 - h, y: e.y + ny / 10000 - h * ar, w: (mx - mn) / 10000 + 2 * h, h: (my - ny) / 10000 + 2 * h * ar };
    }
    if (e.t === 'text') return { x: e.x, y: e.y, w: Math.max(0.02, e.tx.length * e.fs * 0.55), h: e.fs * 1.3 * ar };
    if (e.t === 'token') return { x: e.x - e.sz / 2, y: e.y - e.sz * ar / 2, w: e.sz, h: e.sz * ar };
    if (e.t === 'shape' && e.k === 'line') return { x: Math.min(e.x, e.x + e.w), y: Math.min(e.y, e.y + e.h), w: Math.abs(e.w), h: Math.abs(e.h) };
    return { x: e.x, y: e.y, w: e.w || 0.05, h: e.h || 0.05 };
  }
  function dSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  /* Élément le plus haut touché en (x,y) normalisés ; tol en fraction de largeur. */
  function hitTest(els, x, y, tol, ar) {
    var k = 1 / (ar || 1), i, j, e, b, r, X, Y, pa, pb;
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.pts) {
        r = tol + (e.th || 0.005) / 2; X = x; Y = y * k;
        if (e.pts.length === 2) { if (dSeg(X, Y, e.x + e.pts[0] / 10000, (e.y + e.pts[1] / 10000) * k, e.x + e.pts[0] / 10000, (e.y + e.pts[1] / 10000) * k) <= r) return e.id; continue; }
        for (j = 0; j + 3 < e.pts.length; j += 2) {
          pa = [e.x + e.pts[j] / 10000, (e.y + e.pts[j + 1] / 10000) * k]; pb = [e.x + e.pts[j + 2] / 10000, (e.y + e.pts[j + 3] / 10000) * k];
          if (dSeg(X, Y, pa[0], pa[1], pb[0], pb[1]) <= r) return e.id;
        }
      } else if (e.t === 'shape' && e.k === 'line') {
        if (dSeg(x, y * k, e.x, e.y * k, e.x + e.w, (e.y + e.h) * k) <= tol + (e.th || 0.005) / 2) return e.id;
      } else {
        b = elBox(e, ar);
        if (x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol * (ar || 1) && y <= b.y + b.h + tol * (ar || 1)) return e.id;
      }
    }
    return null;
  }

  function makeHistory(limit) {
    var u = [], r = [];
    return {
      push: function (s) { u.push(s); if (u.length > limit) u.shift(); r = []; },
      undo: function (cur) { if (!u.length) return null; r.push(cur); return u.pop(); },
      redo: function (cur) { if (!r.length) return null; u.push(cur); if (u.length > limit) u.shift(); return r.pop(); },
      canUndo: function () { return u.length > 0; },
      canRedo: function () { return r.length > 0; },
      size: function () { return u.length; },
      reset: function () { u = []; r = []; }
    };
  }

  /* Type d'une image lu dans le CONTENU (jamais dans le nom ni le type déclaré). */
  function sniffType(b) {
    var n = b ? b.length : 0, i, s = '', t;
    function at(o, str) { for (var q = 0; q < str.length; q++) if (b[o + q] !== str.charCodeAt(q)) return false; return true; }
    if (n >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
    if (n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (n >= 6 && at(0, 'GIF8')) return 'gif';
    if (n >= 12 && at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
    if (n >= 12 && at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return 'avif';
    for (i = 0; i < n && i < 1024; i++) s += String.fromCharCode(b[i]);
    t = s.replace(/^\xef\xbb\xbf/, '').replace(/^\s+/, '');
    if (t.charAt(0) === '<' && /<svg[\s>\/]/i.test(t)) return 'svg';
    return null;
  }
  function fitSize(w, h, max) { var r = Math.min(1, max / Math.max(w, h)); return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) }; }
  /* Dimensions lues dans l'EN-TÊTE (aucun décodage) : { w, h } ou null si illisibles. */
  function imgDims(b) {
    var n = b ? b.length : 0, i, m, len, v;
    function u16(o) { return b[o] * 256 + b[o + 1]; }
    function l16(o) { return b[o] + b[o + 1] * 256; }
    function l24(o) { return b[o] + b[o + 1] * 256 + b[o + 2] * 65536; }
    function ascii(o, s) { for (var q = 0; q < s.length; q++) if (b[o + q] !== s.charCodeAt(q)) return false; return true; }
    if (n >= 24 && b[0] === 0x89 && b[1] === 0x50 && ascii(12, 'IHDR')) return { w: b[16] * 16777216 + b[17] * 65536 + b[18] * 256 + b[19], h: b[20] * 16777216 + b[21] * 65536 + b[22] * 256 + b[23] };
    if (n >= 10 && ascii(0, 'GIF8')) return { w: l16(6), h: l16(8) };
    if (n >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
      if (ascii(12, 'VP8X')) return { w: l24(24) + 1, h: l24(27) + 1 };
      if (ascii(12, 'VP8L') && b[20] === 0x2f) { v = b[21] + b[22] * 256 + b[23] * 65536 + b[24] * 16777216; return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 }; }
      if (ascii(12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { w: l16(26) & 0x3fff, h: l16(28) & 0x3fff };
      return null;
    }
    if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      i = 2;
      while (i + 4 <= n) {
        if (b[i] !== 0xff) { i++; continue; }
        m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        len = u16(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { if (i + 9 > n) return null; return { w: u16(i + 7), h: u16(i + 5) }; }
        if (len < 2) return null;
        i += 2 + len;
      }
      return null;
    }
    return null;
  }
  function imgTooBig(w, h) { return w * h > LIM.imgPixels || Math.max(w, h) > LIM.imgDim; }
  function imgVerdict(size) { return size <= LIM.imgTarget ? 'ok' : size <= LIM.imgMax ? 'retry' : 'refuse'; }

  /* Message de trait en direct : points absolus en 1/10 000, ≤ 100 points (≤ 2 Ko). */
  function liveMsg(id, c, th, pts, seq, end) {
    var p = [], i, m;
    for (i = 0; i < pts.length && i < 100; i++) p.push(Math.round(num(pts[i][0], -1, 2, 0) * 10000), Math.round(num(pts[i][1], -1, 2, 0) * 10000));
    m = { id: id, c: normColor(c), th: Math.round(num(th, 0.002, 0.03, 0.005) * 10000) / 10000, s: seq, p: p };
    if (end) m.e = 1;
    return m;
  }

  var api = { LIM: LIM, IMG_TRIES: IMG_TRIES, newId: newId, normEl: normEl, validateBoard: validateBoard, project: project, hiddenLive: hiddenLive,
    simplify: simplify, strokeFromPoints: strokeFromPoints, hitTest: hitTest, imgBox: imgBox, elBox: elBox, makeHistory: makeHistory,
    sniffType: sniffType, imgDims: imgDims, imgTooBig: imgTooBig, fitSize: fitSize, imgVerdict: imgVerdict, liveMsg: liveMsg, num: num, normColor: normColor, cut: cut };
  /* ---------- Ping et trait en direct : diffusions éphémères, aucune écriture en base ---------- */
  var PING = { ttl: 5000, sendGap: 3000, recvGap: 2500, max: 8, maxKeys: 200, globalGap: 400, nameLen: 24, bytes: 200, defName: 'Joueuse' };
  var LIVE_PTS = 400, LIVE_STROKES = 8, LIVE_BYTES = 2048;
  function utf8Len(s) {
    var n = 0, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3; }
    return n;
  }
  function jsonBytes(v) { var t; try { t = JSON.stringify(v); } catch (e) { return 1e9; } return t === undefined ? 1e9 : utf8Len(t); }
  /* Nom d'affichage : texte seul (jamais interprété), sans caractères de contrôle, 24 caractères au plus. */
  function cleanName(n) {
    var s = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').slice(0, PING.nameLen), c = s.charCodeAt(s.length - 1);
    if (c >= 0xd800 && c <= 0xdbff) s = s.slice(0, -1);
    return s.replace(/^\s+|\s+$/g, '');
  }
  /* Noms réservés (usurpation du MJ) : refusés, remplacés par le nom par défaut. L'identité émettrice n'est pas authentifiée (shim). */
  function reservedName(s) {
    var t = s;
    try { if (typeof t.normalize === 'function') t = t.normalize('NFKC'); } catch (e) { /* ignoré */ }
    t = t.replace(/[\u041c\u043c]/g, 'M').replace(/[\u0408\u0458]/g, 'J');   /* homoglyphes cyrilliques de « MJ » */
    return /^\s*(m\.?\s?j\.?|ma[iî]tre(sse)?|game\s?master|gm|dm)(?![a-zà-ÿ0-9])/i.test(t);
  }
  function safeName(n) { var s = cleanName(n); return (!s || reservedName(s)) ? PING.defName : s;
  }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  var BID_RE = /^b_[a-z0-9]{8}$/;
  function makePing(x, y, name, bid) {
    var p = { x: r4(num(x, 0, 1, 0)), y: r4(num(y, 0, 1, 0)), n: safeName(name) };
    if (typeof bid === 'string' && BID_RE.test(bid)) p.b = bid;
    return p;
  }
  /* Réception : forme stricte, x et y finis dans 0..1, nom texte, moins de 200 octets ; sinon null (message ignoré). */
  function validPing(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (typeof d.x !== 'number' || typeof d.y !== 'number' || !isFinite(d.x) || !isFinite(d.y) || d.x < 0 || d.x > 1 || d.y < 0 || d.y > 1) return null;
    if (d.n !== undefined && typeof d.n !== 'string') return null;
    if (d.b !== undefined && (typeof d.b !== 'string' || !BID_RE.test(d.b))) return null;
    var k; for (k in d) { if (hasOwn.call(d, k) && k !== 'x' && k !== 'y' && k !== 'n' && k !== 'b') return null; }
    if (jsonBytes(d) >= PING.bytes) return null;
    var out = { x: r4(d.x), y: r4(d.y), n: safeName(d.n) };
    if (d.b !== undefined) out.b = d.b;
    return out;
  }
  function makeLimiter(gap) {
    var last = -1e15;
    return {
      take: function (now) { if (now - last < gap) return false; last = now; return true; },
      wait: function (now) { var w = gap - (now - last); return w > 0 ? w : 0; }
    };
  }
  /* Registre de pings. Clé d'émettrice préfixée dans un objet sans prototype (« __proto__ » inoffensif) ; limite PAR identifiant (2,5 s)
     ET limite GLOBALE (400 ms, toutes émettrices confondues) : les identifiants forgés ne la contournent pas. */
  function makePingBook(globalGap) {
    var list = [], last = Object.create(null), order = [], glob = makeLimiter(globalGap == null ? PING.globalGap : globalGap);
    function prune(now) { list = list.filter(function (p) { return now - p.t < PING.ttl; }); }
    return {
      add: function (p, key, now) {
        var k = 'k' + String(key == null ? '' : key).slice(0, 64), e, known = k in last;
        if (known && now - last[k] < PING.recvGap) return null;
        if (!glob.take(now)) return null;
        if (!known) {
          order.push(k);
          if (order.length > PING.maxKeys) delete last[order.shift()];
        }
        last[k] = now;
        prune(now);
        e = { x: p.x, y: p.y, n: p.n, t: now, k: k, b: p.b };
        list.push(e);
        if (list.length > PING.max) list.shift();
        return e;
      },
      forget: function (e) { var i = list.indexOf(e); if (i >= 0) list.splice(i, 1); },
      list: function (now) { prune(now); return list.slice(); },
      clear: function () { list = []; },
      keys: function () { return order.length; }
    };
  }
  /* Annonces aria-live : 5 au plus par 10 s (un client modifié ne peut pas inonder un lecteur d'écran). */
  function makeAnnounceLimiter() {
    var t = [];
    return { take: function (now) { t = t.filter(function (x) { return now - x < 10000; }); if (t.length >= 5) return false; t.push(now); return true; } };
  }
  /* Repère de ping, en pixels écran (contexte sans transformation). o : { dpr, reduced, brass, ink, surface }. */
  function drawPing(g, sx, sy, age, name, o) {
    var d = o.dpr || 1, ph = (age % 1300) / 1300, r = (o.reduced ? 18 : 12 + ph * 24) * d, fade = age > PING.ttl - 600 ? Math.max(0, (PING.ttl - age) / 600) : 1, w, tx;
    g.save();
    g.globalAlpha = fade;
    g.lineWidth = 3 * d; g.strokeStyle = o.brass;
    g.globalAlpha = fade * (o.reduced ? 1 : 1 - ph * 0.7);
    g.beginPath(); g.arc(sx, sy, r, 0, 6.2832); g.stroke();
    g.globalAlpha = fade;
    g.fillStyle = o.brass; g.strokeStyle = o.surface; g.lineWidth = 2 * d;
    g.beginPath(); g.arc(sx, sy, 5 * d, 0, 6.2832); g.fill(); g.stroke();
    g.font = '700 ' + (15 * d) + 'px Alegreya Sans, sans-serif'; g.textBaseline = 'middle';
    w = g.measureText(name).width;
    tx = Math.max(4 * d, Math.min(sx - w / 2, (g.canvas ? g.canvas.width : 1e6) - w - 10 * d));
    g.fillStyle = o.surface; g.globalAlpha = fade * 0.92;
    g.fillRect(tx - 5 * d, sy - 46 * d, w + 10 * d, 24 * d);
    g.globalAlpha = fade; g.strokeStyle = o.brass; g.lineWidth = 1 * d; g.strokeRect(tx - 5 * d, sy - 46 * d, w + 10 * d, 24 * d);
    g.fillStyle = o.ink; g.fillText(name, tx, sy - 34 * d);
    g.restore();
  }
  /* Trait du MJ reçu en direct (tyl-board / « live ») : forme, taille et bornes validées ; null = ignoré. */
  function validLive(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return null;
    if (typeof m.s !== 'number' || !isFinite(m.s) || m.s < 0 || m.s > 100000 || m.s !== Math.floor(m.s)) return null;
    if (!Array.isArray(m.p) || m.p.length > 200 || m.p.length % 2) return null;
    var i, v, p = [];
    for (i = 0; i < m.p.length; i++) {
      v = m.p[i];
      if (typeof v !== 'number' || !isFinite(v) || v < -10000 || v > 20000) return null;
      p.push(Math.round(v));
    }
    if (jsonBytes(m) > LIVE_BYTES) return null;
    return { id: m.id, c: normColor(m.c), th: num(m.th, 0.002, 0.03, 0.005), s: m.s, p: p, e: m.e === 1 ? 1 : 0, x: m.x === 1 ? 1 : 0 };
  }
  function makeLiveStrokes() {
    var byId = Object.create(null), order = [];
    function del(id) { var i = order.indexOf(id); if (i >= 0) order.splice(i, 1); delete byId[id]; }
    return {
      apply: function (m, now) {
        var st = m.id in byId ? byId[m.id] : null, have, tail;
        if (m.x === 1) { if (st) del(m.id); return true; }
        if (!st) {
          if (m.s !== 0) return false;
          st = byId[m.id] = { id: m.id, c: m.c, th: m.th, pts: [], e: 0, t: now || 0 };
          order.push(m.id);
          if (order.length > LIVE_STROKES) delete byId[order.shift()];
        }
        st.t = now || st.t;
        have = st.pts.length / 2;
        if (m.s > have) return false;
        tail = m.p.slice((have - m.s) * 2);
        if (tail.length && have < LIVE_PTS) st.pts = st.pts.concat(tail.slice(0, (LIVE_PTS - have) * 2));
        if (m.e) st.e = 1;
        return true;
      },
      /* Retire les traits dont l'id est dans ids (ils sont désormais dans le document enregistré). */
      drop: function (ids) { order.slice().forEach(function (id) { if (ids && Object.prototype.hasOwnProperty.call(ids, id)) del(id); }); },
      /* Traits finis : retirés après fin ms ; traits sans nouvelle depuis 15 s (message final perdu) : retirés aussi. */
      expire: function (now, fin) { order.slice().forEach(function (id) { var st = byId[id], age = now - st.t; if ((st.e && age > fin) || age > 15000) del(id); }); },
      list: function () { return order.map(function (k) { return byId[k]; }); },
      clear: function () { byId = Object.create(null); order = []; }
    };
  }
  /* Chargeur de scripts à la demande (une seule fois par fichier) : need(['a.js','b.js'], cb). */
  var needed = {};
  function need(list, cb) {
    var i = 0, errs = [], t0 = Date.now();
    function next() {
      var src, sc;
      if (i >= list.length) { cb(errs.length ? errs[0] : undefined); return; }
      src = list[i++];
      if (needed[src] === 2) { next(); return; }
      if (!root.document) { next(); return; }
      if (needed[src] === 1) {
        if (Date.now() - t0 > 10000) { errs.push(new Error('délai ' + src)); next(); return; }
        setTimeout(function () { i--; next(); }, 30); return;
      }
      needed[src] = 1; sc = root.document.createElement('script'); sc.src = src;
      sc.onload = function () { needed[src] = 2; next(); };
      sc.onerror = function () { needed[src] = 0; errs.push(new Error('chargement ' + src)); try { if (sc.parentNode) sc.parentNode.removeChild(sc); } catch (e) { /* ignoré */ } next(); };
      root.document.head.appendChild(sc);
    }
    next();
  }
  api.need = need;
  api.PING = PING; api.cleanName = cleanName; api.makePing = makePing; api.validPing = validPing; api.makeLimiter = makeLimiter; api.makePingBook = makePingBook; api.makeAnnounceLimiter = makeAnnounceLimiter; api.safeName = safeName;
  api.drawPing = drawPing; api.validLive = validLive; api.makeLiveStrokes = makeLiveStrokes; api.utf8Len = utf8Len;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.tylBoardModel = api;
})(typeof window !== 'undefined' ? window : this);
