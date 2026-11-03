/* tableau-outils.js : outils avancés du tableau côté MJ (tranche T4). ES5, sans bibliothèque. Chargé à la demande par tableau.js.
   Tableaux nommés, texte, flèche, formes, jetons, murs, règle, éléments cachés, bibliothèque d'images, export PNG.
   Tout texte saisi passe par value / textContent / fillText : jamais d'HTML construit à partir d'une saisie. */
(function (root) {
  'use strict';
  var M = root.tylBoardModel, R = root.tylBoardDraw, doc = root.document;
  if (!M || !R || !doc) return;
  var LIM = M.LIM, WALL_TH = [0.008, 0.014, 0.024], OWNED = { text: 1, arrow: 1, shape: 1, token: 1, wall: 1, rule: 1 };
  function create(H) {
    var S = H.S, $ = H.$, X = { drag: null }, pq = Promise.resolve(), lastSel = '', lastBid = '', askT = 0, ruleSeg = null, expIds = [], libMode = 'img';
    S.tk = { a: '' }; S.shapeKind = 'rect'; S.wallKind = 'line'; S.fill = false;

    /* ---------- DOM ---------- */
    function mk(html) { var d = doc.createElement('div'); d.innerHTML = html; return d.firstChild; }
    function btn(id, txt, extra) { return '<button type="button" class="tb-btn" id="' + id + '"' + (extra || '') + '>' + txt + '</button>'; }
    function tb(t, txt) { return mk('<button type="button" class="tb-btn" data-tbtool="' + t + '" aria-pressed="false"' + (t === 'rule' ? ' id="tbRuleOn"' : '') + '>' + txt + '</button>'); }
    function build() {
      var tools = $('tbTools'), img = $('tbImg'), acts = $('tbActs'), opts = $('tbOpts'), ov = $('tbOv');
      [['text', 'T Texte'], ['arrow', '➚ Flèche'], ['shape', '▭ Forme'], ['token', '◉ Jeton'], ['wall', '▦ Mur'], ['rule', '📏 Règle']].forEach(function (x) { tools.insertBefore(tb(x[0], x[1]), img); });
      tools.appendChild(mk(btn('tbLibBtn', '📚 Bibliothèque', ' aria-haspopup="dialog"')));
      acts.insertBefore(mk(btn('tbEye', '👁 Visible', ' aria-pressed="false" aria-label="Cacher l\'élément choisi aux joueuses" disabled')), $('tbZout'));
      acts.insertBefore(mk(btn('tbNewHid', '👁 Nouveaux : visibles', ' aria-pressed="false" aria-label="Les nouveaux éléments sont cachés aux joueuses"')), $('tbZout'));
      acts.appendChild(mk(btn('tbExport', '⬇ PNG', ' aria-label="Exporter le tableau en image PNG"')));
      opts.insertBefore(mk('<span class="tb-grp" id="tbOptTx" hidden><input class="tb-in" id="tbTx" type="text" maxlength="200" size="14" placeholder="Texte à poser" aria-label="Texte à poser (200 caractères au plus)" autocomplete="off"></span>'), opts.firstChild);
      opts.insertBefore(mk('<span class="tb-grp" id="tbOptShape" hidden>' + btn('', '▭ Rectangle', ' data-tbshape="rect" aria-pressed="true"') + btn('', '◯ Cercle', ' data-tbshape="ellipse" aria-pressed="false"') + btn('', '╱ Ligne', ' data-tbshape="line" aria-pressed="false"') + btn('tbFill', 'Plein', ' aria-pressed="false"') + '</span>'), opts.firstChild);
      opts.insertBefore(mk('<span class="tb-grp" id="tbOptWall" hidden>' + btn('', '╱ Ligne', ' data-tbwall="line" aria-pressed="true"') + btn('', '▢ Rectangle', ' data-tbwall="rect" aria-pressed="false"') + '</span>'), opts.firstChild);
      opts.insertBefore(mk('<span class="tb-grp" id="tbOptTk" hidden><input class="tb-in" id="tbTkName" type="text" maxlength="24" size="10" placeholder="Nom du jeton" aria-label="Nom du jeton (initiales affichées)" autocomplete="off">' +
        '<input class="tb-in" id="tbTkCid" type="text" maxlength="40" size="9" placeholder="Id combattant" aria-label="Identifiant du combattant (facultatif, jamais montré aux joueuses)" autocomplete="off">' + btn('tbTkImg', '🖼 Image du jeton') + btn('tbTkImgX', '✕ Sans image', ' hidden') + '</span>'), opts.firstChild);
      opts.insertBefore(mk('<span class="tb-grp" id="tbOptRule" hidden><span class="tb-lab">1 case =</span><input class="tb-in" id="tbRuleM" type="number" min="0.01" max="1000" step="0.5" value="1.5" aria-label="Mètres par case">' +
        '<span class="tb-lab">m ; feuille =</span><input class="tb-in" id="tbRuleN" type="number" min="5" max="1000" step="1" value="20" aria-label="Nombre de cases sur la largeur de la feuille"><span class="tb-lab">cases</span><output class="tb-out" id="tbRuleOut" aria-live="off"></output></span>'), opts.firstChild);
      var top = ov.querySelector('.tb-top');
      top.insertBefore(mk(btn('tbBoards', '☰ Tableaux', ' aria-haspopup="true" aria-expanded="false" aria-controls="tbPanel"')), $('tbName'));
      ov.appendChild(mk('<div class="tb-panel" id="tbPanel" role="group" aria-label="Tableaux" hidden><h2>Tableaux</h2><ul id="tbBoardList"></ul>' +
        '<div class="tb-prow"><label for="tbBoardName">Nom du tableau choisi</label><input class="tb-in" id="tbBoardName" type="text" maxlength="40" autocomplete="off">' + btn('tbRenameBoard', 'Renommer') + '</div>' +
        '<div class="tb-prow"><label for="tbBoardAr">Format d\'un nouveau tableau</label><select class="tb-in" id="tbBoardAr"><option value="1.6">Large</option><option value="1">Carré</option><option value="0.625">Portrait</option></select></div>' +
        '<div class="tb-prow">' + btn('tbNewBoard', '＋ Nouveau') + btn('tbDupBoard', 'Dupliquer') + btn('tbDelBoard', 'Supprimer') + btn('tbHideLive', 'Cacher celui des joueuses', ' hidden') + btn('tbPanelClose', 'Fermer') + '</div>' +
        '<p class="tb-msg" id="tbPanelMsg" role="status" aria-live="polite"></p></div>'));
      ov.appendChild(mk('<div class="tb-panel" id="tbLib" role="dialog" aria-label="Bibliothèque d\'images" hidden><h2 id="tbLibTitle">Bibliothèque</h2><div class="tb-lib" id="tbLibList"></div>' +
        '<div class="tb-prow">' + btn('tbLibFile', '📁 Un fichier…', ' hidden') + btn('tbLibClose', 'Fermer') + '</div><p class="tb-msg" id="tbLibMsg" role="status" aria-live="polite"></p></div>'));
      wire();
    }
    function place(id) { $(id).style.top = ($('tbOv').querySelector('.tb-top').offsetHeight + 4) + 'px'; }
    function pmsg(t, err) { var m = $('tbPanelMsg'); m.textContent = t || ''; m.className = 'tb-msg' + (err ? ' err' : ''); }
    function sel() { return S.sel ? H.elById(S.sel) : null; }

    /* ---------- Outils au pointeur ---------- */
    X.owns = function (t) { return Object.prototype.hasOwnProperty.call(OWNED, t); };
    X.down = function (n, p) { X.drag = { a: n, b: n, p0: p }; if (S.tool === 'rule') ruleSeg = { a: n, b: n }; H.redraw(false); };
    X.move = function (n) {
      var d = X.drag; if (!d) return;
      d.b = n; if (ruleSeg) { ruleSeg.b = n; ruleOut(); }
      H.redraw(false);
    };
    X.cancel = function () { if (X.drag) { X.drag = null; H.redraw(false); } };
    function temp(d0) {
      var d = d0 || X.drag, t = S.tool, el = null, ar = S.board.ar, th = M.num(H.THICK[S.th], 0.002, 0.03, 0.008);
      if (!d) return null;
      if (t === 'arrow' || t === 'wall') { el = R.lineFromDrag(t === 'wall' ? (S.wallKind === 'rect' ? 'wall-rect' : 'wall') : 'arrow', d.a, d.b); if (el) { el.th = t === 'wall' ? WALL_TH[S.th] : th; el.c = S.color; } }
      else if (t === 'shape') { el = R.shapeFromDrag(S.shapeKind, d.a, d.b, ar); if (el) { el.th = th; el.c = S.color; if (S.fill) el.f = true; } }
      else if (t === 'token') el = { t: 'token', x: d.b.x, y: d.b.y, sz: R.TOK_SZ[S.th], c: S.color, lb: $('tbTkName').value, a: S.tk.a || undefined };
      else if (t === 'text' && $('tbTx').value) el = { t: 'text', x: d.b.x, y: d.b.y, tx: $('tbTx').value.slice(0, LIM.text), fs: R.TXT_SZ[S.th], c: S.color };
      if (el && S.newHid) el.hid = true;
      return el ? M.normEl(el) : null;
    }
    X.up = function (n, cancelled) {
      var d = X.drag, t = S.tool, el, v;
      X.drag = null;
      if (!d || cancelled) { H.redraw(false); return; }
      d.b = n;
      if (t === 'rule') { ruleOut(); H.redraw(false); return; }
      if (t === 'text' && !$('tbTx').value.replace(/\s/g, '')) { H.msg('Écris d\'abord le texte dans le champ « Texte à poser ».', true); $('tbTx').focus(); H.redraw(false); return; }
      el = temp(d);
      if (el) {
        if (t === 'token') {
          v = $('tbTkCid').value.replace(/^\s+|\s+$/g, '');
          if (v && /^[\w-]{1,40}$/.test(v)) el.cid = v; else if (v) H.msg('Identifiant de combattant ignoré (lettres, chiffres, - et _ seulement).', true);
        }
        if (H.addEl(el)) H.redraw(true);
      }
      H.redraw(false);
    };
    function ctx() { var c = H.ctxR(); return c; }
    X.paintLive = function (g) {
      var el, ar = S.board.ar, c = ctx();
      if (X.drag && S.tool !== 'rule') { el = temp(); if (el) { g.save(); g.globalAlpha = 0.8; R.drawEl(g, el, ar, c); g.restore(); } }
      if (S.tool === 'rule' && ruleSeg) R.drawRule(g, ruleSeg.a, ruleSeg.b, ar, S.board.scale, c);
    };
    function ruleOut() {
      var o = $('tbRuleOut'), d;
      if (!ruleSeg) { o.textContent = ''; return; }
      d = R.rulerDist(ruleSeg.a, ruleSeg.b, S.board.ar, S.board.scale);
      o.textContent = R.fmtDist(d.m) + ' · ' + R.fmtCases(d.cases);
    }

    /* ---------- Style de l'élément choisi ---------- */
    X.restyle = function () {
      var e = sel(), pre;
      if (!e || S.tool !== 'select' || e.t === 'img') return;
      pre = H.snap();
      if (e.t === 'text') { e.c = S.color; e.fs = R.TXT_SZ[S.th]; }
      else if (e.t === 'token') { e.c = S.color; e.sz = R.TOK_SZ[S.th]; }
      else if (e.t === 'wall') { e.c = S.color; e.th = WALL_TH[S.th]; }
      else { e.c = S.color; if (e.th !== undefined) e.th = H.THICK[S.th]; }
      H.commitHist(pre); H.redraw(true);
    };

    /* ---------- Synchronisation de l'interface ---------- */
    function setHid(id, on) { var e = $(id); if (e) e.hidden = !on; }
    function lab(a) { var b = $('tbOpts').querySelectorAll('[data-tbth]'), i; for (i = 0; i < 3; i++) b[i].textContent = a[i]; }
    X.sync = function () {
      var e = sel(), t = S.tool, pal, tok, txt, bd = S.board, i, sw;
      if (!bd) return;
      tok = t === 'token' || (t === 'select' && e && e.t === 'token'); txt = t === 'text' || (t === 'select' && e && e.t === 'text');
      pal = (t !== 'select' && t !== 'erase' && t !== 'rule') || (t === 'select' && e && e.t !== 'img');
      setHid('tbOptTx', txt); setHid('tbOptShape', t === 'shape'); setHid('tbOptWall', t === 'wall'); setHid('tbOptTk', tok); setHid('tbOptRule', t === 'rule');
      sw = $('tbOpts').querySelectorAll('[data-tbc],[data-tbth]');
      for (i = 0; i < sw.length; i++) sw[i].hidden = !pal;
      $('tbOpts').hidden = !(pal || t === 'rule');
      lab(tok || txt ? ['Petit', 'Moyen', 'Grand'] : ['Fin', 'Moyen', 'Épais']);
      $('tbEye').disabled = !e; $('tbEye').setAttribute('aria-pressed', String(!!(e && e.hid)));
      $('tbEye').textContent = e && e.hid ? '🙈 Caché' : '👁 Visible';
      $('tbEye').setAttribute('aria-label', e && e.hid ? 'Cet élément est caché aux joueuses : le rendre visible' : 'Cacher l\'élément choisi aux joueuses');
      $('tbNewHid').setAttribute('aria-pressed', String(S.newHid)); $('tbNewHid').textContent = S.newHid ? '🙈 Nouveaux : cachés' : '👁 Nouveaux : visibles';
      Array.prototype.forEach.call($('tbOv').querySelectorAll('[data-tbshape]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tbshape') === S.shapeKind)); });
      Array.prototype.forEach.call($('tbOv').querySelectorAll('[data-tbwall]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tbwall') === S.wallKind)); });
      $('tbFill').setAttribute('aria-pressed', String(S.fill));
      $('tbBoards').textContent = '☰ Tableaux (' + H.boardList().length + ')';
      if (t !== 'rule') ruleSeg = null;
      if (S.bid !== lastBid) { lastBid = S.bid; $('tbRuleM').value = bd.scale.m; $('tbRuleN').value = R.casesAcross(bd.scale); ruleSeg = null; }
      if ((e ? e.id : '') !== lastSel) {
        lastSel = e ? e.id : '';
        if (e && e.t === 'text') $('tbTx').value = e.tx;
        if (e && e.t === 'token') { $('tbTkName').value = e.lb || ''; $('tbTkCid').value = e.cid || ''; }
      }
      var ia = e && e.t === 'token' ? e.a : S.tk.a;
      $('tbTkImgX').hidden = !ia; $('tbTkImg').textContent = ia ? '🖼 Changer l\'image' : '🖼 Image du jeton';
      if (!$('tbPanel').hidden) refreshPanel();
    };
    function editSel(f) {
      var e = sel(), pre;
      if (!e) return;
      pre = H.snap(); f(e); H.commitHist(pre); H.redraw(true); H.syncUi();
    }

    /* ---------- Tableaux nommés ---------- */
    function queue(f) { pq = pq.then(f).then(null, function () { pmsg('Opération impossible (réseau ou droits).', true); }); return pq; }
    function refreshPanel() {
      var ul = $('tbBoardList'), list = H.boardList(), i, li, b, nm = $('tbBoardName');
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      for (i = 0; i < list.length; i++) {
        li = doc.createElement('li'); b = doc.createElement('button'); b.type = 'button'; b.className = 'tb-btn tb-sel'; b.setAttribute('data-tbsel', list[i].id);
        b.setAttribute('aria-pressed', String(list[i].id === S.bid));
        b.textContent = list[i].name + ' · ' + list[i].n + ' él.' + (list[i].id === S.bid ? ' · en édition' : '') + (list[i].id === S.liveBid ? ' · montré aux joueuses' : '');
        li.appendChild(b); ul.appendChild(li);
      }
      if (doc.activeElement !== nm) nm.value = S.board.name;
      $('tbDelBoard').disabled = list.length <= 1; $('tbHideLive').hidden = !(S.liveBid && S.liveBid !== S.bid);
      $('tbBoards').setAttribute('aria-expanded', String(!$('tbPanel').hidden));
    }
    function openPanel(on) {
      $('tbPanel').hidden = !on; if (on) { place('tbPanel'); $('tbLib').hidden = true; refreshPanel(); pmsg(''); $('tbBoardName').value = S.board.name; }
      $('tbBoards').setAttribute('aria-expanded', String(!!on));
    }
    function enterNew(b, name) {
      S.board = b; S.bid = 'b_' + M.newId(); S.rv = 0; S.exists = false; S.dirty = false; S.sel = null; S.hist.reset(); S.shown = false;
      H.markDirty(); H.enter(); refreshPanel(); $('tbBoardName').value = name || b.name;
    }
    function createBoard(copy) {
      if (!R.canAddBoard(H.boardList().length)) { pmsg('Maximum ' + LIM.boards + ' tableaux : supprime-en un avant d\'en créer un autre.', true); return; }
      queue(function () {
        if (!S.exists) H.markDirty();
        return H.settle().then(function () {
          var names = H.boardList().map(function (x) { return x.name; }), ar = +$('tbBoardAr').value, b;
          if (copy) { b = M.validateBoard(JSON.parse(JSON.stringify(S.board))).board; b.name = R.copyName(S.board.name); b.rv = 0; }
          else b = M.validateBoard({ name: R.nextName(names), ar: ar === 1 || ar === 0.625 ? ar : 1.6, els: [] }).board;
          enterNew(b); pmsg(copy ? 'Tableau dupliqué.' : 'Nouveau tableau créé.');
        });
      });
    }
    function switchTo(bid) {
      if (bid === S.bid || !/^b_[a-z0-9]{8}$/.test(bid)) return;
      queue(function () {
        if (!S.exists) H.markDirty();
        return H.settle().then(function () {
          if (!S.cache[bid]) { pmsg('Ce tableau est introuvable.', true); return; }
          H.adopt(S.cache[bid], bid); H.enter(); refreshPanel(); resetAsk(); pmsg('');
        });
      });
    }
    function resetAsk() { clearTimeout(askT); var d = $('tbDelBoard'); d.removeAttribute('data-ask'); d.textContent = 'Supprimer'; }
    function deleteBoard() {
      var d = $('tbDelBoard');
      if (H.boardList().length <= 1) { pmsg('Le dernier tableau ne peut pas être supprimé.', true); return; }
      if (d.getAttribute('data-ask') !== '1') { d.setAttribute('data-ask', '1'); d.textContent = 'Confirmer ?'; clearTimeout(askT); askT = setTimeout(resetAsk, 4000); return; }
      resetAsk();
      queue(function () {
        var bid = S.bid, db = S.svc && S.svc.db, wasLive = S.liveBid === bid, next, p;
        clearTimeout(S.saveT); S.dirty = false;
        next = H.boardList().filter(function (x) { return x.id !== bid; })[0];
        p = Promise.resolve();
        if (S.exists && db) p = Promise.resolve(db.doc('boardmj/' + bid).delete());
        return p.then(function () {
          delete S.cache[bid];
          if (wasLive) { S.liveBid = ''; S.liveDirty = true; }
          S.exists = false; S.board = null;
          H.adopt(S.cache[next.id], next.id); H.enter();
          if (wasLive) H.flush(true);
          refreshPanel(); pmsg('Tableau supprimé.');
        });
      });
    }

    /* ---------- Bibliothèque d'images de l'appli ---------- */
    var DATA_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/, ASSET = /^a:[\w-]{4,64}$/;
    function dataBlob(u) {
      var m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(u), bin, a, i;
      bin = root.atob(m[2]); a = new Uint8Array(bin.length);
      for (i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return new root.Blob([a], { type: m[1] });
    }
    function libItem(kind, key, label, img, av) {
      var b = doc.createElement('button'), s, im = doc.createElement('img');
      b.type = 'button'; b.className = 'tb-btn'; b.setAttribute('data-tblib', kind + ':' + key);
      im.alt = ''; im.src = img;
      if (av) { s = doc.createElement('span'); s.className = 'avatar'; s.appendChild(im); b.appendChild(s); } else b.appendChild(im);
      b.appendChild(doc.createTextNode(label)); return b;
    }
    function openLib(mode) {
      libMode = mode; $('tbPanel').hidden = true; $('tbLib').hidden = false; place('tbLib');
      var ul = $('tbLibList'), db = S.svc && S.svc.db, lm = $('tbLibMsg');
      $('tbLibTitle').textContent = mode === 'token' ? 'Image du jeton' : 'Bibliothèque d\'images'; $('tbLibFile').hidden = mode !== 'token';
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      lm.textContent = 'Chargement…';
      if (!db) { lm.textContent = 'Base de données indisponible.'; return; }
      Promise.all([mode === 'token' ? null : db.doc('campaign/maps').get(), db.collection('library').get()]).then(function (r) {
        var n = 0, base = root.TYL_BLOB || '/_blob/';
        if (r[0] && r[0].exists) {
          ((r[0].data() || {}).list || []).slice(0, 60).forEach(function (m) {
            var u = m && m.d && m.d.bg && typeof m.d.bg.u === 'string' ? m.d.bg.u : '';
            if (!ASSET.test(u) || typeof m.id !== 'string' || !/^[\w-]{1,40}$/.test(m.id)) return;
            ul.appendChild(libItem('map', m.id, M.cut(m.n, 40) || 'Carte', base + u.slice(2).replace(/[^\w-]/g, ''), false)); n++;
          });
        }
        r[1].docs.slice(0, 200).forEach(function (ds) {
          var d = ds.data() || {};
          if (typeof d.img !== 'string' || !DATA_RE.test(d.img) || !/^[\w-]{1,60}$/.test(ds.id)) return;
          if (n < 200) { ul.appendChild(libItem('av', ds.id, M.cut(d.name, 40) || 'Personnage', d.img, true)); n++; }
        });
        lm.textContent = n ? '' : 'Aucune image dans la bibliothèque : ajoute un fond de carte ou l\'image d\'un personnage dans l\'appli.';
        var f = ul.querySelector('button'); if (f) f.focus();
      }, function () { lm.textContent = 'Bibliothèque illisible (droits ou réseau).'; });
    }
    function pickLib(b) {
      var key = b.getAttribute('data-tblib'), k = key.split(':')[0], id = key.slice(k.length + 1), db = S.svc.db, lm = $('tbLibMsg');
      if (k === 'map') {
        Promise.resolve(db.doc('campaign/maps').get()).then(function (ds) {
          var m = ((ds.data() || {}).list || []).filter(function (x) { return x && x.id === id; })[0], u = m && m.d && m.d.bg ? String(m.d.bg.u) : '', im = new root.Image();
          if (!ASSET.test(u)) { lm.textContent = 'Fond de carte introuvable.'; return; }
          im.onload = function () { if (H.placeImage(u.slice(2), (im.naturalWidth || 1) / (im.naturalHeight || 1))) { $('tbLib').hidden = true; H.msg('Image de la carte ajoutée.'); } };
          im.onerror = function () { lm.textContent = 'Image de la carte illisible.'; };
          try { im.crossOrigin = 'anonymous'; } catch (e) { /* ignoré */ }
          im.src = (root.TYL_BLOB || '/_blob/') + u.slice(2).replace(/[^\w-]/g, '');
        }, function () { lm.textContent = 'Carte illisible.'; });
      } else {
        Promise.resolve(db.doc('library/' + id).get()).then(function (ds) {
          var d = ds && ds.exists ? ds.data() : null;
          if (!d || !DATA_RE.test(String(d.img))) { lm.textContent = 'Image introuvable.'; return; }
          $('tbLib').hidden = true;
          if (libMode === 'token') X.tokenFile(dataBlob(d.img)); else H.addImageFile(dataBlob(d.img));
        }, function () { lm.textContent = 'Image illisible.'; });
      }
    }
    X.tokenFile = function (f) {
      if (!S.svc || !S.svc.assets) { H.msg('Import d\'image indisponible (stockage non accessible).', true); return; }
      S.busy = true; H.msg('Image du jeton en préparation…');
      H.uploadImage(f, true).then(function (r) {
        var e = sel();
        S.busy = false;
        if (S.tool === 'select' && e && e.t === 'token') editSel(function (x) { x.a = 'a:' + r.id; });
        else S.tk.a = 'a:' + r.id;
        H.msg('Image du jeton prête (' + Math.round(r.size / 1024) + ' Ko).'); H.syncUi();
      }, function (er) { S.busy = false; H.msg(H.imgError(er), true); });
    };

    /* ---------- Export PNG ---------- */
    function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'tableau'; }
    function exportPng() {
      var bd = S.board, W = 1600, Hh = Math.max(200, Math.round(W / bd.ar)), cv = doc.createElement('canvas'), g, c, i, e, miss = 0, o, th = H.themeColors();
      cv.width = W; cv.height = Hh; g = cv.getContext('2d'); expIds = [];
      c = { colorOf: H.colorOf, theme: th, img: H.getImg, s: W, ox: 0, oy: 0, mj: false };
      g.fillStyle = bd.bg || th.surface; g.fillRect(0, 0, W, Hh);
      g.setTransform(W, 0, 0, W, 0, 0); g.save(); g.beginPath(); g.rect(0, 0, 1, 1 / bd.ar); g.clip();
      for (i = 0; i < bd.els.length; i++) {
        e = bd.els[i]; if (e.hid || e.t === 'rule') continue;
        if (e.t === 'img') { o = H.getImg(e.a); if (!o.ok) miss++; }
        R.drawEl(g, e, bd.ar, c); expIds.push(e.id);
      }
      g.restore();
      function fail() { H.msg('Export impossible : le navigateur refuse d\'exporter ce tableau (image protégée ou trop grande).', true); }
      try {
        cv.toBlob(function (b) {
          var a, u;
          if (!b) { fail(); return; }
          try {
            u = root.URL.createObjectURL(b); a = doc.createElement('a'); a.href = u; a.download = 'tableau-' + slug(bd.name) + '.png'; doc.body.appendChild(a); a.click();
            setTimeout(function () { doc.body.removeChild(a); root.URL.revokeObjectURL(u); }, 1500);
            H.msg('Image exportée' + (miss ? ' (' + miss + ' image(s) pas encore chargée(s) : réessaie dans un instant)' : '') + '. Les éléments cachés n\'y figurent pas.');
          } catch (er) { fail(); }
        }, 'image/png');
      } catch (er2) { fail(); }
    }
    X.exportInfo = function () { return { n: expIds.length, hidden: S.board.els.filter(function (e) { return e.hid && expIds.indexOf(e.id) >= 0; }).length }; };

    /* ---------- Branchements ---------- */
    X.escape = function () {
      if (!$('tbLib').hidden) { $('tbLib').hidden = true; $('tbLibBtn').focus(); return true; }
      if (!$('tbPanel').hidden) { openPanel(false); $('tbBoards').focus(); return true; }
      return false;
    };
    X.close = function () { X.drag = null; ruleSeg = null; $('tbPanel').hidden = true; $('tbLib').hidden = true; };
    function wire() {
      $('tbOv').addEventListener('click', function (ev) {
        var t = ev.target, b = t && t.closest ? t.closest('button') : null;
        if (!b) return;
        if (b.id === 'tbBoards') openPanel($('tbPanel').hidden);
        else if (b.id === 'tbPanelClose') { openPanel(false); $('tbBoards').focus(); }
        else if (b.id === 'tbNewBoard') createBoard(false);
        else if (b.id === 'tbDupBoard') createBoard(true);
        else if (b.id === 'tbDelBoard') deleteBoard();
        else if (b.id === 'tbHideLive') { S.liveBid = ''; S.liveDirty = true; S.lrv = S.lrv || 0; H.flush(true); H.syncUi(); pmsg('Plus aucun tableau montré.'); }
        else if (b.id === 'tbRenameBoard') { S.board.name = M.cut($('tbBoardName').value.replace(/^\s+|\s+$/g, ''), 40) || 'Tableau'; H.markDirty(); H.syncUi(); pmsg('Nom enregistré.'); }
        else if (b.hasAttribute('data-tbsel')) switchTo(b.getAttribute('data-tbsel'));
        else if (b.id === 'tbLibBtn') openLib('img');
        else if (b.id === 'tbTkImg') openLib('token');
        else if (b.id === 'tbTkImgX') { var e = sel(); if (S.tool === 'select' && e && e.t === 'token') editSel(function (x) { delete x.a; }); else S.tk.a = ''; H.syncUi(); }
        else if (b.id === 'tbLibClose') { $('tbLib').hidden = true; $('tbLibBtn').focus(); }
        else if (b.id === 'tbLibFile') { $('tbLib').hidden = true; S.fileFor = 'token'; $('tbFile').click(); }
        else if (b.hasAttribute('data-tblib')) pickLib(b);
        else if (b.id === 'tbEye') { var e2 = sel(); if (e2) editSel(function (x) { if (x.hid) delete x.hid; else x.hid = true; }); }
        else if (b.id === 'tbNewHid') { S.newHid = !S.newHid; H.msg(S.newHid ? 'Les nouveaux éléments seront cachés aux joueuses (et rien ne sera diffusé en direct).' : 'Les nouveaux éléments seront visibles des joueuses.'); H.syncUi(); }
        else if (b.id === 'tbExport') exportPng();
        else if (b.hasAttribute('data-tbshape')) { S.shapeKind = b.getAttribute('data-tbshape'); H.syncUi(); }
        else if (b.hasAttribute('data-tbwall')) { S.wallKind = b.getAttribute('data-tbwall'); H.syncUi(); }
        else if (b.id === 'tbFill') { S.fill = !S.fill; H.syncUi(); }
      });
      $('tbTx').addEventListener('change', function () { var e = sel(), v = this.value; if (S.tool === 'select' && e && e.t === 'text' && v.replace(/\s/g, '')) editSel(function (x) { x.tx = M.cut(v, LIM.text); }); });
      $('tbTkName').addEventListener('change', function () { var e = sel(), v = this.value; if (S.tool === 'select' && e && e.t === 'token') editSel(function (x) { x.lb = M.cut(v, LIM.label); if (!x.lb) delete x.lb; }); });
      $('tbTkCid').addEventListener('change', function () {
        var e = sel(), v = this.value.replace(/^\s+|\s+$/g, '');
        if (v && !/^[\w-]{1,40}$/.test(v)) { H.msg('Identifiant ignoré (lettres, chiffres, - et _ seulement).', true); return; }
        if (S.tool === 'select' && e && e.t === 'token') editSel(function (x) { if (v) x.cid = v; else delete x.cid; });
      });
      function setScale() {
        var sc = R.scaleFrom($('tbRuleM').value, $('tbRuleN').value);
        S.board.scale = sc; $('tbRuleM').value = sc.m; $('tbRuleN').value = R.casesAcross(sc); H.markDirty(); ruleOut(); H.redraw(false);
      }
      $('tbRuleM').addEventListener('change', setScale); $('tbRuleN').addEventListener('change', setScale);
      $('tbBoardName').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); $('tbRenameBoard').click(); } });
    }
    build();
    return X;
  }
  root.tylBoardTools = { create: create };
})(typeof window !== 'undefined' ? window : this);
