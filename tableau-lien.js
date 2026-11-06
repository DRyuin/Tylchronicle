/* tableau-lien.js : lien jeton <-> combattant du Combat simplifié, côté MJ (tranche T4). ES5, sans bibliothèque.
   Reçoit de tableau.js ses fonctions internes (create(H)) : aucune logique de combat ici, aucun HTML.
   Les modifications passent par le même enregistrement temporisé que le reste du tableau (boardmj 1 s, board/live 2,5 s,
   jamais deux écritures de board/live à moins de 350 ms) ; le tableau n'a pas besoin d'être ouvert. */
(function (root) {
  'use strict';
  function create(H) {
    var S = H.S, TAB = H.TAB, LIVE_GAP = H.LIVE_GAP, services = H.services, load = H.load, loadPref = H.loadPref, adopt = H.adopt, newBoard = H.newBoard, newId = H.newId,
      snap = H.snap, commitHist = H.commitHist, addEl = H.addEl, delEl = H.delEl, flush = H.flush, schedule = H.schedule, setTool = H.setTool, syncUi = H.syncUi,
      redraw = H.redraw, project = H.project, validateBoard = H.validateBoard, linkCtx = H.ctx;

  function linkReady() {
    return services().then(function (svc) {
      if (!svc || !svc.db) return false;
      if (S.board && S.bid) {
        if (S.open || S.dirty || S.saving || !S.exists) return true;   /* version en mémoire à jour : écoutée, ou en cours d'enregistrement */
        return Promise.resolve(svc.db.doc('boardmj/' + S.bid).get()).then(function (ds) {
          var d = ds && ds.exists ? (ds.data() || {}) : null;
          if (d && ((+d.rv || 0) > S.rv || ((+d.rv || 0) === S.rv && typeof d.w === 'string' && d.w !== S.lastW))) { adopt(d, S.bid); S.cache[S.bid] = d; }
          return true;
        }, function () { return true; });
      }
      loadPref();
      return load().then(function () {
        if (!S.board) { S.board = newBoard(); S.bid = 'b_' + newId(); S.rv = 0; S.exists = false; S.hist.reset(); S.shown = false; }
        return true;
      });
    }, function () { return false; });
  }
  function linkEdit(fn) {
    return linkReady().then(function (ok) {
      if (!ok || !S.board) return null;
      var X = { els: S.board.els, ar: S.board.ar, name: S.board.name, snap: snap, done: function (pre) { var c = commitHist(pre); if (S.open) redraw(true); return c; },
        add: function (raw) { var h = S.newHid; S.newHid = false; var r; try { r = addEl(raw); } finally { S.newHid = h; } if (r && S.open) redraw(true); return r; } };
      return fn(X);
    });
  }
  function linkProjectLive(bid) {
    var db = S.svc && S.svc.db, d = bid === S.bid ? S.board : S.cache[bid], wait;
    if (!db || !d || !bid) return;
    wait = Math.max(0, S.lastLive + 350 - Date.now());
    setTimeout(function go() {
      if (S.liveBid !== bid) return;   /* caché ou remplacé entre-temps */
      if (bid === S.bid) { S.liveDirty = true; flush(false); return; }
      var w2 = S.lastLive + 350 - Date.now();   /* M6 : une écriture a pu avoir lieu pendant l'attente */
      if (w2 > 0) { setTimeout(go, w2); return; }
      var ld = project(S.cache[bid] || d, bid, S.shownAt || Date.now(), linkCtx());
      S.lrv++; ld.rv = S.lrv; S.lastLive = Date.now();
      db.doc('board/live').set(ld).then(null, function () { S.liveLate = true; });
    }, wait);
  }
  /* urgent = quelque chose vient d'être caché : réécriture immédiate (>= 350 ms après la précédente) ; sinon groupée (<= 2,5 s). */
  function linkTouchLive(urgent) {
    if (!S.svc || !S.svc.db || !S.liveBid) return;
    if (urgent) { linkProjectLive(S.liveBid); return; }
    if (S.shown) { S.liveLate = true; schedule(); return; }
    clearTimeout(S.linkT); S.linkT = setTimeout(function () { linkProjectLive(S.liveBid); }, Math.max(200, S.lastLive + LIVE_GAP - Date.now()));
  }
  /* Retire les jetons liés aux combattants de `gone` ({cid:1}) dans TOUS les tableaux. Renvoie le nombre de jetons retirés. */
  function linkSweep(gone) {
    return linkEdit(function (X) {
      var has = Object.prototype.hasOwnProperty, n = 0, pre = X.snap(), i, ids = [];
      for (i = 0; i < X.els.length; i++) if (X.els[i].t === 'token' && X.els[i].cid && has.call(gone, X.els[i].cid)) ids.push(X.els[i].id);
      ids.forEach(function (id) { if (delEl(id)) n++; });
      if (n) { commitHist(pre); if (S.open) { syncUi(); redraw(true); } }
      var others = Object.keys(S.cache).filter(function (bid) {
        var d = S.cache[bid]; return bid !== S.bid && d && Array.isArray(d.els) && d.els.some(function (e) { return e && e.t === 'token' && e.cid && has.call(gone, e.cid); });
      }), chain = Promise.resolve();
      others.forEach(function (bid) {
        chain = chain.then(function () {
          var d = JSON.parse(JSON.stringify(S.cache[bid])), cut = d.els.length;
          d.els = d.els.filter(function (e) { return !(e && e.t === 'token' && e.cid && has.call(gone, e.cid)); });
          n += cut - d.els.length;
          d = validateBoard(d).board; d.rv = (+S.cache[bid].rv || 0) + 1; d.upd = Date.now(); d.w = TAB;
          return Promise.resolve(S.svc.db.doc('boardmj/' + bid).set(d)).then(function () { S.cache[bid] = d; if (bid === S.liveBid) linkTouchLive(false); return new Promise(function (r) { setTimeout(r, 350); }); }, function () { /* ignoré */ });
        });
      });
      return chain.then(function () { return n; });
    });
  }
  function linkSelect(cid) {
    if (!S.board) return false;
    var l = S.board.els, i;
    for (i = 0; i < l.length; i++) {
      if (l[i].t === 'token' && l[i].cid === cid) {
        S.sel = l[i].id;
        if (S.open && !S.down) { if (S.tool !== 'select') setTool('select'); S.sel = l[i].id; syncUi(); redraw(true); }
        return true;
      }
    }
    if (S.sel) { S.sel = null; if (S.open && !S.down) { syncUi(); redraw(true); } }
    return false;
  }
    return {
      ready: linkReady, edit: linkEdit, sweep: linkSweep, select: linkSelect, touchLive: linkTouchLive,
      cids: function () { if (!S.board) return null; var o = []; S.board.els.forEach(function (e) { if (e.t === 'token' && e.cid) o.push(e.cid); }); return o; },
      redraw: function () { if (S.open && !S.down && S.board) redraw(true); }
    };
  }
  root.tylBoardLink = { create: create };
})(typeof window !== 'undefined' ? window : this);
