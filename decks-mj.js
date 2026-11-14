/* decks-mj.js : vue MJ des decks de sorts (tranche 4). ES5, sans bibliothèque, chargé après decks.js (window.tylDK).
   - Panneau « Decks de sorts » dans la colonne de droite du MJ : interrupteur « actif » (decks/cfg), réglage « Changer de deck librement », liste des joueuses, modèles maison.
   - Écran « Decks de <joueuse> » : voir ses decks (lecture), PROPOSER un deck (decks/m_<pid>, elle accepte ou refuse), IMPOSER un deck (équipé tout de suite, sans verrou),
     réglage « libre » pour elle seule, retirer une proposition ou une imposition.
   - Modèles maison (decks/cfg.modeles) : classe, niveau minimum, thème, sorts, note <= 140.
   Droits (migration 021) : le MJ écrit m_<pid> et cfg en entier (set), p_<pid> par fusion (update). Anti-rebond 1 s par document, jamais d'écriture en rafale.
   Rien n'est visible tant que decks/cfg n'existe pas, sauf si le MJ ouvre le site avec « #decks » dans l'adresse (une fois : mémorisé). */
(function (root) {
  'use strict';
  var T = root.tylDK, doc = root.document;
  if (!T || !T.x || !doc) return;
  var X = T.x, LIM = T.LIM, THEMES = T.THEMES, THEME_LBL = T.THEME_LBL, CLASSES = T.CLASSES;
  var FLAG = 'tylchronicle-decks-mj';
  var MS = { open: false, view: 'player', pid: '', pu: null, mu: null, p: T.cleanDoc(null), pRaw: null, pLoaded: false, mLoaded: false, m: T.cleanM(null), mRaw: null, draft: null, mode: '', ask: null, msg: '', err: false, q: '', lv: -1, opener: null, cfgLocal: null, sig: '' };
  var Q = {}, rootEl = null, panSig = '';

  function esc(s) { return X.esc(s); }
  function H() { return X.H(); }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function keys(o) { return isObj(o) ? Object.keys(o) : []; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fold(s) { s = String(s == null ? '' : s).toLowerCase(); try { s = s.normalize('NFD'); } catch (e) { /* ancien navigateur */ } return s.replace(/[̀-ͯ]/g, ''); }
  function flagOn() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } }
  function setFlag() { try { localStorage.setItem(FLAG, '1'); } catch (e) { /* ignoré */ } }
  function isMj() { return X.role() === 'mj'; }
  function cfgNow() { return MS.cfgLocal || T.cleanCfg(X.S.cfg); }
  function setMsg(t, err) { MS.msg = t || ''; MS.err = !!err; }
  function cfgReady() { return X.S.ready === true; }   /* decks/cfg lu au moins une fois : sinon on ne réécrit rien (les decks suggérés maison seraient perdus) */
  function loaded() { return MS.pLoaded && MS.mLoaded; }   /* ses decks (p_) et m_ lus : sinon ni imposer, ni proposer, ni réglage */
  function waitMsg() { setMsg('Ses decks sont en cours de chargement : réessaie dans un instant.', true); }
  function putM(pid) { var mm = MS.m; qPut('m_' + pid, 'set', function () { return T.mBody(mm); }); }   /* l'objet est capturé : changer de joueuse avant l'envoi ne mélange rien */
  function plural(n, a, b) { return n + ' ' + (n > 1 ? b : a); }

  /* ---------- joueuses (PJ avec au moins une classe lanceuse) ---------- */
  function players() {
    var l = [];
    try { l = H().pjs() || []; } catch (e) { l = []; }
    return l.map(function (e) { var cs = X.classesOf(e); return { e: e, id: e.id, name: String(e.name || e.id), cls: cs }; }).filter(function (p) { return p.cls.length > 0; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }); });
  }
  function playerById(id) { var l = players(), i; for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

  /* ---------- file d'écriture : un document, une écriture par seconde au plus ---------- */
  function mergeP(a, b) {
    var o = clone(a);
    keys(b).forEach(function (k) { if (k === 'decks' && isObj(o.decks)) { keys(b.decks).forEach(function (i) { o.decks[i] = b.decks[i]; }); } else o[k] = b[k]; });
    return o;
  }
  function qPut(docId, kind, payload, exists) {
    var q = Q[docId];
    if (!q) q = Q[docId] = { kind: kind, patch: null, build: null, timer: null, busy: false, again: false, exists: exists !== false };
    if (kind === 'set') { q.kind = 'set'; q.build = payload; q.patch = null; }
    else { if (q.kind !== 'set') q.kind = 'update'; q.patch = q.patch ? mergeP(q.patch, payload) : payload; if (exists === false) q.exists = false; }
    if (q.busy) { q.again = true; return; }
    if (!q.timer) q.timer = root.setTimeout(function () { q.timer = null; qFlush(docId); }, 1000);
  }
  function qDone(docId, okay, er) {
    var q = Q[docId]; if (!q) return;
    q.busy = false;
    if (okay) {
      if (q.again || q.patch || q.timer) { q.again = false; if (!q.timer) q.timer = root.setTimeout(function () { q.timer = null; qFlush(docId); }, 1000); return; }
      delete Q[docId];
      if (docId === 'cfg') MS.cfgLocal = null;
      if (MS.open && docId.indexOf('m_') === 0) { MS.m = T.cleanM(MS.mRaw); }
      if (!(MS.err && MS.msg)) setMsg('Enregistré ✔', false);   /* une erreur d'un autre document (p_ refusé, m_ accepté) n'est pas masquée */
      root.setTimeout(function () { if (!MS.open && MS.msg === 'Enregistré ✔') { MS.msg = ''; refresh(); } }, 3500);
    } else {
      delete Q[docId];
      if (docId === 'cfg') MS.cfgLocal = null;
      if (MS.open && docId.indexOf('m_') === 0) MS.m = T.cleanM(MS.mRaw);
      if (MS.open && docId.indexOf('p_') === 0) MS.p = T.cleanDoc(MS.pRaw);
      var c = er && er.code;
      setMsg(c === 'invalid_argument' && docId === 'cfg' ? 'La base refuse ce réglage : la migration 021 (decks) est-elle appliquée ?' : c === 'invalid_argument' ? 'Enregistrement refusé : limite de taille ou de nombre dépassée.' : 'Enregistrement impossible (hors ligne ?). Réessaie dans un instant.', true);
    }
    refresh();
  }
  function qFlush(docId) {
    var q = Q[docId], DB = X.DB(), ref, pr, body;
    if (!q || q.busy) return;
    if (!DB) { delete Q[docId]; return; }
    q.busy = true;
    try {
      ref = DB.collection('decks').doc(docId);
      if (q.kind === 'set') { body = q.build(); if (JSON.stringify(body).length > (docId === 'cfg' ? LIM.octetsCfg : LIM.octetsM) - 4096) throw { code: 'invalid_argument' }; pr = ref.set(body); }
      else {
        body = q.patch; q.patch = null;
        /* update refusé : le shim ne dit pas pourquoi (document absent OU limite). On relit : absent => création ; présent => refus, JAMAIS de set qui remplacerait le document entier */
        pr = Promise.resolve(ref.update(body)).then(null, function (er) {
          if (!(er && er.code === 'invalid_argument')) throw er;
          return Promise.resolve(ref.get()).then(function (sn) { if (sn && sn.exists) throw er; return ref.set(body); });
        });
      }
    } catch (er) { pr = Promise.reject(er); }
    Promise.resolve(pr).then(function () { qDone(docId, true); }, function (er) { qDone(docId, false, er); });
  }

  /* ---------- réglages globaux (decks/cfg) ---------- */
  function cfgSet(fn) {
    if (!cfgReady()) { setMsg('Les réglages ne sont pas encore chargés : réessaie dans un instant.', true); refresh(); return false; }
    var c = clone(cfgNow());
    fn(c); MS.cfgLocal = c;
    qPut('cfg', 'set', function () { return T.cfgBody(cfgNow()); });
    refresh();
    return true;
  }

  /* ---------- panneau de la colonne MJ ---------- */
  function panelVisible() { return isMj() && (!!X.S.cfg || flagOn()); }
  function panelHTML() {
    var c = cfgNow(), ps = players(), nm = keys(c.modeles).length, dis = cfgReady() ? '' : ' disabled';
    return '<label class="dkm-sw"><input type="checkbox" data-dkm-f="actif"' + (c.actif ? ' checked' : '') + dis + '><span>Decks de sorts activés pour les joueuses<small>Fait apparaître « Mes decks » chez elles.</small></span></label>' +
      '<label class="dkm-sw"><input type="checkbox" data-dkm-f="libre"' + (c.libre ? ' checked' : '') + dis + '><span>Changer de deck librement<small>Éteint : après un repos long, ou avec ta confirmation. Réglable aussi joueuse par joueuse.</small></span></label>' +
      (ps.length ? '<ul class="dkm-pl">' + ps.map(function (p) { return '<li><span class="dkm-pn">' + esc(p.name) + ' <small>' + esc(p.cls.map(function (c0) { return c0.n + ' ' + c0.lv; }).join(', ')) + '</small></span><button type="button" class="dk-btn" data-dkm-a="player" data-dkm-pid="' + esc(p.id) + '">Decks</button></li>'; }).join('') + '</ul>' : '<p class="dk-meta">Aucune joueuse avec des sorts pour l\'instant.</p>') +
      '<button type="button" class="dk-btn" data-dkm-a="models">Decks suggérés du MJ (' + nm + ' / ' + LIM.modeles + ')</button><p class="dkm-st" role="status" aria-live="polite" id="dkmSt">' + (!MS.open && MS.msg ? esc(MS.msg) : '') + '</p>';
  }
  function ensurePanel() {
    var pan = doc.getElementById('dkMjPanel'), body, sig;
    if (!panelVisible()) { if (pan) pan.hidden = true; return; }
    if (!pan) {
      var pl = doc.getElementById('plist'), host = pl && pl.closest ? pl.closest('details') : null;
      if (!host || !host.parentNode) return;
      pan = doc.createElement('details'); pan.id = 'dkMjPanel'; pan.className = 'panel dkm-panel';
      pan.innerHTML = '<summary>Decks de sorts</summary><div class="pbody stack" id="dkMjBody"></div>';
      host.parentNode.insertBefore(pan, host.nextSibling);
      pan.addEventListener('click', onClick); pan.addEventListener('change', onChange);
    }
    pan.hidden = false; body = doc.getElementById('dkMjBody');
    sig = panelHTML();
    if (sig === panSig) return;
    var a = doc.activeElement, key = a && pan.contains(a) ? (a.getAttribute('data-dkm-f') ? '[data-dkm-f="' + a.getAttribute('data-dkm-f') + '"]' : a.getAttribute('data-dkm-pid') ? '[data-dkm-pid="' + a.getAttribute('data-dkm-pid') + '"]' : a.getAttribute('data-dkm-a') ? '[data-dkm-a="' + a.getAttribute('data-dkm-a') + '"]' : '') : '';
    panSig = sig; body.innerHTML = sig;
    if (key) { var n = body.querySelector(key); if (n) { try { n.focus(); } catch (e) { /* ignoré */ } } }
  }

  /* ---------- écran « Decks de … » ---------- */
  function unsub(k) { try { if (MS[k]) MS[k](); } catch (e) { /* ignoré */ } MS[k] = null; }
  function watch(pid) {
    var DB = X.DB();
    unsub('pu'); unsub('mu');
    MS.p = T.cleanDoc(null); MS.pRaw = null; MS.pLoaded = false; MS.mLoaded = false; MS.m = T.cleanM(null); MS.mRaw = null;
    if (!DB) return;
    try {
      MS.pu = DB.collection('decks').doc('p_' + pid).onSnapshot(function (sn) { MS.pRaw = sn && sn.exists ? sn.data() : null; MS.pLoaded = true; if (!Q['p_' + pid]) MS.p = T.cleanDoc(MS.pRaw); refresh(); }, function () { /* absent ou refusé : on n'écrit rien tant qu'il n'est pas lu */ });
      MS.mu = DB.collection('decks').doc('m_' + pid).onSnapshot(function (sn) { MS.mRaw = sn && sn.exists ? sn.data() : null; MS.mLoaded = true; if (!Q['m_' + pid]) MS.m = T.cleanM(MS.mRaw); refresh(); }, function () { /* absent ou refusé */ });
    } catch (e) { /* ignoré */ }
  }
  function statusOf(id) { var v = MS.p.vus && MS.p.vus[id]; return v === 'ok' ? 'acceptée' : v === 'non' ? 'refusée' : 'en attente'; }
  function spNames(ids) { return ids.map(function (id) { var r = X.spById(id); return esc(r ? r.n : id); }).join(', '); }
  function playerHTML() {
    var p = playerById(MS.pid), decks = T.liveDecks(MS.p.decks), act = MS.p.actif, props = T.liveDecks(MS.m.propose), imps = T.liveDecks(MS.m.impose), pl, h, libre = MS.m.libre;
    if (!p) return '<p class="dk-empty">Joueuse introuvable.</p>' + backBtn();
    pl = X.S.cfg && T.cleanCfg(X.S.cfg).libre;
    h = '<h3 class="dk-h3">' + esc(p.name) + '</h3><p class="dk-meta">' + esc(p.cls.map(function (c) { return c.n + ' niveau ' + c.lv; }).join(' · ')) + '</p>';
    if (MS.msg) h += '<p class="dk-msg' + (MS.err ? ' err' : '') + '" role="status">' + esc(MS.msg) + '</p>';
    if (!loaded()) h += '<p class="dk-meta" role="status">Chargement de ses decks…</p>';
    h += '<label class="dk-lab">Changer de deck librement pour ' + esc(p.name) + '<select data-dkm-f="plibre"' + (loaded() ? '' : ' disabled') + '><option value=""' + (libre === null ? ' selected' : '') + '>Suit le réglage général (' + (pl ? 'oui' : 'non') + ')</option><option value="1"' + (libre === true ? ' selected' : '') + '>Oui, sans confirmation</option><option value="0"' + (libre === false ? ' selected' : '') + '>Non, après repos long ou avec confirmation</option></select></label>';
    h += '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dkm-a="propose"' + (loaded() ? '' : ' disabled') + '>Proposer un deck</button><button type="button" class="dk-btn" data-dkm-a="impose"' + (loaded() ? '' : ' disabled') + '>Imposer un deck</button></div>';
    if (MS.ask) h += askHTML();
    h += '<section class="dk-grp" aria-label="Ses decks"><h4>Ses decks (' + decks.length + ' / ' + LIM.decks + ')</h4>' + (decks.length ? '<ul class="dk-cards">' + decks.map(function (d) {
      return '<li class="dk-card dkm-deck' + (d.id === act ? ' on' : '') + '" data-dk-id="' + esc(d.id) + '"><div class="dk-ct"><h3>' + esc(d.nom) + '</h3>' + (d.id === act ? '<span class="dk-pill">Actif</span>' : '') + (d.src === 'mj' ? '<span class="dk-pill dk-pill-mj">du MJ</span>' : '') + '</div>' +
        '<p class="dk-meta">' + esc(d.classe) + ' · niv. ' + d.niveau + ' · ' + esc(THEME_LBL[d.theme] || '') + ' · ' + plural(d.sorts.length, 'sort', 'sorts') + '</p>' + (d.note ? '<p class="dk-note">' + esc(d.note) + '</p>' : '') +
        '<details class="dkm-det"><summary>Voir les sorts</summary><p class="dk-spells">' + (d.sorts.length ? spNames(d.sorts) : 'Aucun sort.') + '</p></details></li>';
    }).join('') + '</ul>' : '<p class="dk-empty">Aucun deck pour l\'instant.</p>') + '</section>';
    h += '<section class="dk-grp" aria-label="Propositions envoyées"><h4>Propositions envoyées (' + props.length + ' / ' + LIM.props + ')</h4>' + (props.length ? '<ul class="dk-cards">' + props.map(function (d) {
      return '<li class="dk-card" data-dk-id="' + esc(d.id) + '"><div class="dk-ct"><h3>' + esc(d.nom) + '</h3><span class="dk-pill dk-pill-mj">' + statusOf(d.id) + '</span></div><p class="dk-meta">' + esc(d.classe) + ' · ' + plural(d.sorts.length, 'sort', 'sorts') + '</p>' +
        '<div class="dk-btns"><button type="button" class="dk-btn danger" data-dkm-a="unprop"' + (loaded() ? '' : ' disabled') + ' data-dk-id="' + esc(d.id) + '">Retirer<span class="dk-sr"> la proposition ' + esc(d.nom) + '</span></button></div></li>';
    }).join('') + '</ul>' : '<p class="dk-empty">Aucune proposition.</p>') + '</section>';
    h += '<section class="dk-grp" aria-label="Impositions"><h4>Impositions (' + imps.length + ' / ' + LIM.props + ')</h4>' + (imps.length ? '<ul class="dk-cards">' + imps.map(function (d) {
      return '<li class="dk-card" data-dk-id="' + esc(d.id) + '"><div class="dk-ct"><h3>' + esc(d.nom) + '</h3><span class="dk-pill dk-pill-mj">' + (MS.p.vus && MS.p.vus[d.id] ? 'vue' : 'pas encore vue') + '</span></div><p class="dk-meta">' + esc(d.classe) + ' · ' + plural(d.sorts.length, 'sort', 'sorts') + ' · déjà équipé</p>' +
        '<div class="dk-btns"><button type="button" class="dk-btn danger" data-dkm-a="unimp"' + (loaded() ? '' : ' disabled') + ' data-dk-id="' + esc(d.id) + '">Retirer de la liste<span class="dk-sr"> ' + esc(d.nom) + '</span></button></div></li>';
    }).join('') + '</ul><p class="dk-meta">Retirer de la liste ne change rien à sa fiche ni à ses decks.</p>' : '<p class="dk-empty">Aucune imposition.</p>') + '</section>';
    return h + backBtn();
  }
  function backBtn() { return '<div class="dk-btns dk-end"><button type="button" class="dk-btn" data-dkm-a="close">Fermer</button></div>'; }

  /* ---------- choisir un modèle ou composer ---------- */
  function chooseHTML() {
    var p = playerById(MS.pid), h, by = {}, any = false;
    if (!p) return backBtn();
    h = '<h3 class="dk-h3">' + (MS.mode === 'impose' ? 'Imposer' : 'Proposer') + ' un deck à ' + esc(p.name) + '</h3>';
    if (MS.mode === 'impose') h += '<p class="muted">Un deck imposé est équipé tout de suite sur sa fiche, sans verrou : elle pourra le modifier ou en changer ensuite.</p>';
    else h += '<p class="muted">Elle voit ta proposition dans « Mes decks » et l\'accepte (copie dans ses decks) ou la refuse. Ses decks ne sont jamais écrasés.</p>';
    if (MS.msg) h += '<p class="dk-msg' + (MS.err ? ' err' : '') + '" role="status">' + esc(MS.msg) + '</p>';
    h += '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dkm-a="compose">Composer un deck</button></div>';
    p.cls.forEach(function (c) {
      var sg = T.suggest(X.models(), X.customModels(), c.n, c.lv);
      if (!sg.liste.length) return;
      any = true;
      h += '<section class="dk-grp" aria-label="Decks suggérés ' + esc(c.n) + '"><h4>' + esc(c.n) + ' niveau ' + c.lv + ' · palier ' + esc(T.PAL_LBL[sg.palier] || '') + '</h4><ul class="dk-cards">' + sg.liste.map(function (m) {
        return '<li class="dk-card" data-dk-id="' + esc(m.id) + '"><div class="dk-ct"><h3>' + esc(m.nom) + '</h3>' + (m.mj ? '<span class="dk-pill dk-pill-mj">du MJ</span>' : '') + '</div><p class="dk-meta">' + esc(THEME_LBL[m.theme] || '') + ' · ' + plural(m.sorts.length, 'sort', 'sorts') + '</p>' + (m.note ? '<p class="dk-note">' + esc(m.note) + '</p>' : '') +
          '<p class="dk-spells">' + spNames(m.sorts) + '</p><div class="dk-btns"><button type="button" class="dk-btn" data-dkm-a="usemodel" data-dkm-m="' + esc(m.id) + '" data-dkm-c="' + esc(c.n) + '">Partir de ce deck</button></div></li>';
      }).join('') + '</ul></section>';
    });
    if (!any) h += '<p class="dk-empty">Aucun deck suggéré pour son niveau : compose-en un.</p>';
    return h + '<div class="dk-btns dk-end"><button type="button" class="dk-btn" data-dkm-a="back">← Retour</button></div>';
  }
  function newDraft(kind) {
    var p = playerById(MS.pid), cl = p && p.cls[0];
    if (kind === 'model') return { kind: 'model', id: '', nom: '', note: '', theme: 'combat', classe: 'Clerc', min: 5, sorts: [], favoris: [] };
    return { kind: 'deck', id: '', nom: '', note: '', theme: 'combat', classe: cl ? cl.n : 'Clerc', min: cl ? cl.lv : 1, sorts: [], favoris: [] };
  }
  function fromModel(m, classe) { return { kind: 'deck', id: '', nom: m.nom, note: m.note || '', theme: m.theme || 'autre', classe: classe || m.classe, min: m.min, sorts: (m.sorts || []).slice(), favoris: [] }; }

  /* ---------- sorts permis pour le brouillon ---------- */
  function poolRows(dr) {
    var h = H(), e = dr.kind === 'deck' ? h.byId(MS.pid) : null, cl = e ? X.clsOf(e, dr.classe) : null, code = h.code ? h.code(dr.classe) : '', cap = 9, q = fold(MS.q).trim();
    if (dr.kind === 'model') { try { cap = h.cap(dr.classe, dr.min); } catch (er) { cap = 9; } }
    return h.sp().filter(function (r) {
      if (r.l < 1) return false;
      if (cl) { if (cl.alw.indexOf(r.e) >= 0 || !h.ed.ok(cl.en, r)) return false; }
      else if (!code || String(r.cl || '').indexOf(code) < 0 || r.l > cap) return false;
      if (MS.lv >= 0 && r.l !== MS.lv) return false;
      if (q && fold(r.n + ' ' + r.e).indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return a.l - b.l || a.n.localeCompare(b.n, 'fr'); });
  }
  function maxLvl(dr) {
    var h = H(), e = dr.kind === 'deck' ? h.byId(MS.pid) : null, cl = e ? X.clsOf(e, dr.classe) : null;
    if (cl) return cl.maxL;
    try { return h.cap(dr.classe, dr.min); } catch (er) { return 9; }
  }
  function toggleSpell(dr, sid) {
    var i = dr.sorts.indexOf(sid);
    if (i >= 0) dr.sorts.splice(i, 1);
    else { if (dr.sorts.length >= LIM.sorts) { setMsg('Un deck contient ' + LIM.sorts + ' sorts au plus.', true); return; } dr.sorts.push(sid); }
  }

  /* ---------- composer ---------- */
  function composeHTML() {
    var dr = MS.draft, p = playerById(MS.pid), byL = {}, h, cl, quota = 0, e, title, btn;
    if (!dr) return backBtn();
    e = dr.kind === 'deck' ? H().byId(MS.pid) : null; cl = e ? X.clsOf(e, dr.classe) : null;
    if (cl && cl.mode === 'prep') quota = cl.quota;
    title = dr.kind === 'model' ? (dr.id ? 'Modifier le deck suggéré' : 'Nouveau deck suggéré') : (MS.mode === 'impose' ? 'Imposer un deck' : 'Proposer un deck') + (p ? ' à ' + esc(p.name) : '');
    btn = dr.kind === 'model' ? 'Enregistrer le deck suggéré' : MS.mode === 'impose' ? 'Imposer et équiper' : 'Envoyer la proposition';
    dr.sorts.forEach(function (id) { var r = X.spById(id), l = r ? r.l : 0; (byL[l] = byL[l] || []).push(id); });
    h = '<h3 class="dk-h3">' + title + '</h3>';
    if (MS.msg) h += '<p class="dk-msg' + (MS.err ? ' err' : '') + '" role="status">' + esc(MS.msg) + '</p>';
    if (MS.ask) h += askHTML();
    h += '<label class="dk-lab">Nom<input type="text" data-dkm-f="nom" maxlength="' + LIM.nom + '" value="' + esc(dr.nom) + '" autocomplete="off" placeholder="Combat, Exploration…"></label>' +
      '<label class="dk-lab">Note courte (140 caractères)<input type="text" data-dkm-f="note" maxlength="' + LIM.note + '" value="' + esc(dr.note) + '" autocomplete="off" placeholder="pour tenir la ligne"></label>' +
      '<label class="dk-lab">Thème<select data-dkm-f="theme">' + X.themeSel(dr.theme) + '</select></label>';
    if (dr.kind === 'model') {
      h += '<label class="dk-lab">Classe<select data-dkm-f="classe">' + CLASSES.map(function (c) { return '<option' + (c === dr.classe ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
        '<label class="dk-lab">Niveau minimum<select data-dkm-f="min">' + (function () { var o = '', i; for (i = 1; i <= 20; i++) o += '<option value="' + i + '"' + (i === dr.min ? ' selected' : '') + '>' + i + '</option>'; return o; })() + '</select></label>';
    } else if (p && p.cls.length > 1) {
      h += '<label class="dk-lab">Classe<select data-dkm-f="classe">' + p.cls.map(function (c) { return '<option' + (c.n === dr.classe ? ' selected' : '') + '>' + esc(c.n) + '</option>'; }).join('') + '</select></label>';
    }
    h += '<p><span class="dk-count' + (quota && dr.sorts.length > quota ? ' dk-bad' : '') + '" aria-live="polite">Sorts : <b>' + dr.sorts.length + '</b>' + (quota ? ' <small>(limite de préparation de sa classe : ' + quota + ')</small>' : '') + '</span></p>';
    if (quota && dr.sorts.length > quota) h += '<p class="dk-over" role="status">Au-dessus de sa limite : ' + (MS.mode === 'impose' ? 'à l\'équipement, les derniers sorts en trop seront retirés.' : 'elle devra en retirer ' + (dr.sorts.length - quota) + ' pour l\'équiper.') + '</p>';
    h += X.warnHTML({ sorts: dr.sorts, classe: dr.classe });
    h += '<div class="dk-btns"><button type="button" class="dk-btn" data-dkm-a="addspells">+ Ajouter des sorts</button></div>';
    if (!dr.sorts.length) h += '<p class="dk-empty">Aucun sort dans ce deck.</p>';
    keys(byL).sort(function (a, b) { return a - b; }).forEach(function (l) {
      h += '<section class="dk-grp" aria-label="Niveau ' + l + '"><h4>Niveau ' + l + '</h4><ul class="dk-list">' + byL[l].map(function (id) {
        var r = X.spById(id);
        return '<li class="dk-row" data-dk-s="' + esc(id) + '"><div class="dk-rn"><b>' + esc(r ? r.n : id) + '</b>' + (r ? '<span class="dk-tags">' + X.tagsOf(r) + '</span>' : '') + '</div><div class="dk-ra"><button type="button" class="dk-ic" data-dkm-a="rm" data-dkm-s="' + esc(id) + '" aria-label="Retirer du deck : ' + esc(r ? r.n : id) + '">✕</button></div></li>';
      }).join('') + '</ul></section>';
    });
    h += '<div class="dk-btns dk-end"><button type="button" class="dk-btn primary" data-dkm-a="send">' + btn + '</button><button type="button" class="dk-btn" data-dkm-a="cancel">Annuler</button></div>';
    return h;
  }
  function pickHTML() {
    var dr = MS.draft, mx, i, h, rows, cap = 120;
    if (!dr) return backBtn();
    mx = maxLvl(dr);
    h = '<h3 class="dk-h3">Ajouter des sorts à « ' + esc(dr.nom || 'ce deck') + ' »</h3><p><span class="dk-count" aria-live="polite">Sorts : <b>' + dr.sorts.length + '</b></span></p>' +
      '<input type="search" class="dk-q" data-dkm-f="q" value="' + esc(MS.q) + '" placeholder="Chercher un sort" aria-label="Chercher un sort" autocomplete="off">' +
      '<div class="dk-chips" role="group" aria-label="Niveau"><button type="button" class="dk-chip' + (MS.lv < 0 ? ' on' : '') + '" data-dkm-lv="-1" aria-pressed="' + (MS.lv < 0) + '">Tous</button>';
    for (i = 1; i <= mx; i++) h += '<button type="button" class="dk-chip' + (MS.lv === i ? ' on' : '') + '" data-dkm-lv="' + i + '" aria-pressed="' + (MS.lv === i) + '">Niv. ' + i + '</button>';
    h += '</div>';
    if (MS.msg) h += '<p class="dk-msg' + (MS.err ? ' err' : '') + '" role="status">' + esc(MS.msg) + '</p>';
    h += '<ul class="dk-list" id="dkmPickList">' + pickRows(dr, cap) + '</ul><div class="dk-btns dk-end"><button type="button" class="dk-btn primary" data-dkm-a="pickdone">Terminé</button></div>';
    return h;
  }
  function pickRows(dr, cap) {
    var rows = poolRows(dr), h;
    if (!rows.length) return '<li class="dk-empty">Aucun sort ne correspond.</li>';
    h = rows.slice(0, cap).map(function (r) {
      var on = dr.sorts.indexOf(r.e) >= 0;
      return '<li class="dk-row' + (on ? ' on' : '') + '" data-dk-s="' + esc(r.e) + '"><div class="dk-rn"><b>' + esc(r.n) + '</b><span class="dk-tags">' + X.tagsOf(r) + '</span></div><button type="button" class="dk-btn dk-pk' + (on ? ' primary' : '') + '" data-dkm-a="pick" data-dkm-s="' + esc(r.e) + '" aria-pressed="' + on + '">' + (on ? '✓ Dans le deck' : '+ Ajouter') + '<span class="dk-sr"> ' + esc(r.n) + '</span></button></li>';
    }).join('');
    if (rows.length > cap) h += '<li class="dk-empty">' + (rows.length - cap) + ' autres sorts : affine la recherche.</li>';
    return h;
  }
  function fillPick() {
    var ul = rootEl && rootEl.querySelector('#dkmPickList'), c = rootEl && rootEl.querySelector('.dk-count');
    if (!ul || !MS.draft) return;
    var fa = doc.activeElement, fk = fa && ul.contains(fa) && fa.getAttribute ? fa.getAttribute('data-dkm-s') : '', i, nb;
    ul.innerHTML = pickRows(MS.draft, 120);
    if (fk) { nb = ul.querySelectorAll('[data-dkm-a="pick"]'); for (i = 0; i < nb.length; i++) if (nb[i].getAttribute('data-dkm-s') === fk) { try { nb[i].focus(); } catch (e) { /* ignoré */ } break; } }   /* le focus clavier ne retombe pas sur body */
    if (c) c.innerHTML = 'Sorts : <b>' + MS.draft.sorts.length + '</b>';
  }
  function askHTML() {
    var a = MS.ask, t = '', p = playerById(MS.pid);
    if (!a) return '';
    if (a.k === 'impose') t = '<p><b>Imposer « ' + esc(MS.draft ? MS.draft.nom || 'ce deck' : '') + ' » à ' + esc(p ? p.name : '') + ' ?</b></p><p>Il est équipé tout de suite sur sa fiche (ses sorts préparés de cette classe sont remplacés), sans verrou : elle peut le modifier ou en changer ensuite. Ses autres decks ne changent pas.</p>';
    else if (a.k === 'delmodel') t = '<p><b>Supprimer le deck suggéré « ' + esc(a.nom) + ' » ?</b> Les decks déjà copiés par les joueuses ne changent pas.</p>';
    return '<div class="dk-ask" role="alertdialog" aria-label="Confirmation">' + t + '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dkm-a="ok">' + (a.k === 'impose' ? 'Oui, imposer' : 'Oui, supprimer') + '</button><button type="button" class="dk-btn" data-dkm-a="no">Non</button></div></div>';
  }

  /* ---------- modèles maison ---------- */
  function modelsHTML() {
    var c = cfgNow(), ms = keys(c.modeles).map(function (k) { return c.modeles[k]; }).sort(function (a, b) { return a.classe.localeCompare(b.classe, 'fr') || a.min - b.min || a.nom.localeCompare(b.nom, 'fr'); }), h;
    h = '<h3 class="dk-h3">Decks suggérés du MJ</h3><p class="muted">Ils s\'ajoutent aux decks suggérés de l\'appli, pour la classe et à partir du niveau choisis, et apparaissent « du MJ » chez les joueuses.</p>';
    if (MS.msg) h += '<p class="dk-msg' + (MS.err ? ' err' : '') + '" role="status">' + esc(MS.msg) + '</p>';
    if (MS.ask) h += askHTML();
    h += '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dkm-a="newmodel"' + (ms.length >= LIM.modeles || !cfgReady() ? ' disabled' : '') + '>+ Nouveau deck suggéré</button></div><p class="dk-lim muted">' + ms.length + ' / ' + LIM.modeles + '</p>';
    if (!ms.length) h += '<p class="dk-empty">Aucun deck suggéré maison pour l\'instant.</p>';
    h += '<ul class="dk-cards">' + ms.map(function (m) {
      return '<li class="dk-card dkm-model" data-dk-id="' + esc(m.id) + '"><div class="dk-ct"><h3>' + esc(m.nom) + '</h3></div><p class="dk-meta">' + esc(m.classe) + ' · niveau ' + m.min + ' et plus · ' + esc(THEME_LBL[m.theme] || '') + ' · ' + plural(m.sorts.length, 'sort', 'sorts') + '</p>' + (m.note ? '<p class="dk-note">' + esc(m.note) + '</p>' : '') +
        '<details class="dkm-det"><summary>Voir les sorts</summary><p class="dk-spells">' + (m.sorts.length ? spNames(m.sorts) : 'Aucun sort.') + '</p></details>' +
        '<div class="dk-btns"><button type="button" class="dk-btn" data-dkm-a="editmodel" data-dkm-m="' + esc(m.id) + '">Modifier</button><button type="button" class="dk-btn danger" data-dkm-a="delmodel" data-dkm-m="' + esc(m.id) + '">Supprimer</button></div></li>';
    }).join('') + '</ul>';
    return h + backBtn();
  }

  /* ---------- rendu et ouverture ---------- */
  function viewHTML() {
    if (MS.view === 'models') return modelsHTML();
    if (MS.view === 'choose') return chooseHTML();
    if (MS.view === 'compose') return composeHTML();
    if (MS.view === 'pick') return pickHTML();
    return playerHTML();
  }
  function focusKey(el) {
    if (!el || !el.getAttribute) return '';
    var a = ['data-dkm-a', 'data-dkm-f', 'data-dkm-lv'].filter(function (k) { return el.hasAttribute(k); })[0];
    if (!a) return '';
    return '[' + a + '="' + el.getAttribute(a) + '"]' + (el.hasAttribute('data-dkm-s') ? '[data-dkm-s="' + el.getAttribute('data-dkm-s').replace(/"/g, '\\"') + '"]' : '') + (el.hasAttribute('data-dkm-m') ? '[data-dkm-m="' + el.getAttribute('data-dkm-m') + '"]' : '') + (el.hasAttribute('data-dk-id') ? '[data-dk-id="' + el.getAttribute('data-dk-id') + '"]' : '');
  }
  function render() {
    if (!rootEl) return;
    var a = doc.activeElement, key = a && rootEl.contains(a) ? (a.id === 'dkmTitle' ? '#dkmTitle' : focusKey(a)) : '', body = rootEl.querySelector('.dk-body'), st = body ? body.scrollTop : 0, p = playerById(MS.pid);
    var title = MS.view === 'models' || (MS.draft && MS.draft.kind === 'model') ? 'Decks suggérés du MJ' : 'Decks' + (p ? ' de ' + esc(p.name) : '');
    rootEl.innerHTML = '<header class="dk-hd"><h2 id="dkmTitle" tabindex="-1">' + title + '</h2><button type="button" class="dk-x" data-dkm-a="close">Fermer</button></header><div class="dk-body" id="dkmBody">' + viewHTML() + '</div>';
    body = rootEl.querySelector('.dk-body'); if (body) body.scrollTop = st;
    if (key) { var n = rootEl.querySelector(key); if (n) { try { n.focus(); } catch (e) { /* ignoré */ } } }
  }
  function refresh() {
    try { ensurePanel(); } catch (e) { /* ignoré */ }
    if (!MS.open || !rootEl || rootEl.hidden) return;
    var a = doc.activeElement, typing = a && rootEl.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
    if (typing) return;
    render();
  }
  function ensureRoot() {
    if (rootEl) return;
    rootEl = doc.createElement('div'); rootEl.id = 'dkMj'; rootEl.className = 'dk'; rootEl.setAttribute('role', 'dialog'); rootEl.setAttribute('aria-modal', 'true'); rootEl.setAttribute('aria-labelledby', 'dkmTitle'); rootEl.hidden = true;
    rootEl.addEventListener('click', onClick); rootEl.addEventListener('input', onInput); rootEl.addEventListener('change', onChange);
    doc.body.appendChild(rootEl);
  }
  function openUI(view, pid, opener) {
    if (!isMj()) return;
    ensureRoot();
    MS.open = true; MS.view = view; MS.ask = null; MS.draft = null; MS.mode = ''; MS.q = ''; MS.lv = -1; MS.msg = ''; MS.err = false; MS.opener = opener || doc.activeElement;
    if (view === 'player') { MS.pid = pid; watch(pid); } else { unsub('pu'); unsub('mu'); }
    rootEl.hidden = false; doc.documentElement.classList.add('dk-lock');
    render();
    var t = rootEl.querySelector('#dkmTitle'); if (t) { try { t.focus(); } catch (e) { /* ignoré */ } }
  }
  function closeUI() {
    if (!rootEl) return;
    MS.open = false; rootEl.hidden = true; doc.documentElement.classList.remove('dk-lock'); MS.ask = null; MS.draft = null;
    unsub('pu'); unsub('mu');
    var o = MS.opener;
    if (!(o && doc.documentElement.contains(o))) o = doc.querySelector('#dkMjPanel summary');
    if (o) { try { o.focus(); } catch (e) { /* ignoré */ } }
    MS.opener = null; panSig = ''; ensurePanel();
  }
  function go(view) { MS.view = view; MS.ask = null; render(); var b = rootEl.querySelector('#dkmBody'); if (b) b.scrollTop = 0; var t = rootEl.querySelector('#dkmTitle'); if (t) { try { t.focus(); } catch (e) { /* ignoré */ } } }

  /* ---------- actions : proposer, imposer, modèles ---------- */
  function uniqueId() {
    var id;
    do { id = T.newId(); } while (Object.prototype.hasOwnProperty.call(MS.p.decks, id) || Object.prototype.hasOwnProperty.call(MS.m.propose, id) || Object.prototype.hasOwnProperty.call(MS.m.impose, id));
    return id;
  }
  function draftSpec(dr) { return { nom: dr.nom, classe: dr.classe, theme: dr.theme, note: dr.note, sorts: dr.sorts, favoris: dr.favoris }; }
  function checkDraft(dr) {
    if (!T.cleanName(dr.nom)) return 'Donne un nom au deck (1 à ' + LIM.nom + ' caractères).';
    return '';
  }
  function doPropose(dr) {
    var p = playerById(MS.pid), e = p && p.e, cl = e && X.clsOf(e, dr.classe), legal, id, d, bad;
    if (!loaded()) { waitMsg(); return false; }
    bad = checkDraft(dr); if (bad) { setMsg(bad, true); return false; }
    if (!cl) { setMsg('Cette classe n\'est pas sur sa fiche.', true); return false; }
    if (!T.canAdd(MS.m.propose, LIM.props)) { setMsg('Déjà ' + LIM.props + ' propositions : retires-en une avant d\'en envoyer une autre.', true); return false; }
    legal = X.legalIds(cl, dr.sorts);
    id = uniqueId();
    d = T.mjDeck({ nom: dr.nom, classe: dr.classe, theme: dr.theme, note: dr.note, sorts: legal, favoris: dr.favoris }, MS.pid, cl.lv, id, X.now());
    if (T.validDeck(d)) { setMsg('Deck invalide : ' + T.validDeck(d) + '.', true); return false; }
    MS.m.propose[id] = d;
    putM(MS.pid);
    setMsg('Proposition envoyée à ' + p.name + ' (' + plural(d.sorts.length, 'sort', 'sorts') + (dr.sorts.length > d.sorts.length ? ', ' + (dr.sorts.length - d.sorts.length) + ' écarté(s) car pas légaux pour sa classe' : '') + ').', false);
    return true;
  }
  function doImpose(dr) {
    var p = playerById(MS.pid), e = p && p.e, cl = e && X.clsOf(e, dr.classe), legal, keep, tr, id, d, r, eq, patch, bad, rest = 0;
    if (!loaded()) { waitMsg(); return false; }   /* ses decks pas lus : jamais d'imposition (le correctif ne doit pas tomber à côté d'un document qu'on ne connaît pas) */
    bad = checkDraft(dr); if (bad) { setMsg(bad, true); return false; }
    if (!cl) { setMsg('Cette classe n\'est pas sur sa fiche.', true); return false; }
    if (!T.canAdd(MS.m.impose, LIM.props)) { setMsg('Déjà ' + LIM.props + ' impositions dans la liste : retires-en une avant d\'en faire une autre.', true); return false; }
    if (T.liveDecks(MS.p.decks).length >= LIM.decks) { setMsg(p.name + ' a déjà ' + LIM.decks + ' decks : elle doit en supprimer un avant que tu en imposes un.', true); return false; }
    if (keys(MS.p.decks).length >= 2 * LIM.decks) { setMsg('Ses decks supprimés ne sont pas encore compactés : demande-lui d\'ouvrir « Mes decks » une fois, puis réessaie.', true); return false; }
    legal = X.legalIds(cl, dr.sorts); keep = legal;
    if (cl.mode === 'prep') { tr = T.trimToLimit(legal, dr.favoris, cl.quota); keep = tr.keep; }
    id = uniqueId();
    d = T.mjDeck({ nom: dr.nom, classe: dr.classe, theme: dr.theme, note: dr.note, sorts: keep, favoris: dr.favoris }, MS.pid, cl.lv, id, X.now());
    if (T.validDeck(d)) { setMsg('Deck invalide : ' + T.validDeck(d) + '.', true); return false; }
    if (cl.mode === 'prep') {
      r = X.sheetEquip(e, cl, keep);
      if (!r.ok) { setMsg(r.msg, true); return false; }
      try { rest = H().ed.rest(e) | 0; } catch (er) { rest = 0; }
      eq = { deck: id, rev: 1, lr: rest, at: X.now() };
    }
    patch = { v: 1, decks: {}, actif: id }; patch.decks[id] = T.pack(d); if (eq) patch.eq = eq;
    MS.p.decks[id] = d; MS.p.actif = id; if (eq) MS.p.eq = eq;
    MS.m.impose[id] = d;
    qPut('p_' + MS.pid, 'update', patch);
    putM(MS.pid);
    setMsg('Deck « ' + d.nom + ' » imposé à ' + p.name + ' : ' + (cl.mode === 'prep' ? 'équipé sur sa fiche (' + plural(keep.length, 'sort préparé', 'sorts préparés') + ').' : 'activé comme raccourci.') + (tr && tr.drop.length ? ' ' + plural(tr.drop.length, 'sort retiré', 'sorts retirés') + ' (au-dessus de sa limite).' : ''), false);
    return true;
  }
  function saveModel(dr) {
    var c, m, bad, id = dr.id || T.newModelId();
    m = { id: id, classe: dr.classe, min: dr.min, theme: dr.theme, nom: T.cleanName(dr.nom), sorts: dr.sorts.slice(), note: T.cleanNote(dr.note) };
    bad = T.modelValid(m); if (bad) { setMsg('Deck suggéré invalide : ' + bad + '.', true); return false; }
    c = cfgNow();
    if (!c.modeles[id] && keys(c.modeles).length >= LIM.modeles) { setMsg('Déjà ' + LIM.modeles + ' decks suggérés : supprime-en un.', true); return false; }
    if (!cfgSet(function (x) { x.modeles[id] = m; })) return false;
    setMsg('Deck suggéré « ' + m.nom + ' » enregistré.', false);
    return true;
  }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-dkm-a],[data-dkm-lv]') : null, a, pid, sid, mid, dr;
    if (!t || t.disabled) return;
    if (ev.preventDefault) ev.preventDefault();
    if (t.hasAttribute('data-dkm-lv')) { MS.lv = parseInt(t.getAttribute('data-dkm-lv'), 10); render(); return; }
    a = t.getAttribute('data-dkm-a'); pid = t.getAttribute('data-dkm-pid'); sid = t.getAttribute('data-dkm-s'); mid = t.getAttribute('data-dkm-m'); dr = MS.draft;
    if (a === 'player') { openUI('player', pid, t); return; }
    if (a === 'models') { openUI('models', '', t); return; }
    if (a === 'close') { closeUI(); return; }
    if (a === 'back') { MS.msg = ''; go('player'); return; }
    if (a === 'propose' || a === 'impose') { MS.mode = a; MS.msg = ''; MS.err = false; go('choose'); return; }
    if (a === 'compose') { MS.draft = newDraft('deck'); MS.msg = ''; go('compose'); return; }
    if (a === 'usemodel') {
      var p0 = playerById(MS.pid), found = null;
      (p0 ? p0.cls : []).forEach(function (c) { T.suggest(X.models(), X.customModels(), c.n, c.lv).liste.forEach(function (m) { if (m.id === mid && c.n === m.classe) found = m; }); });
      if (found) { MS.draft = fromModel(found, found.classe); var clm = p0 && X.clsOf(p0.e, found.classe); if (clm) MS.draft.sorts = X.legalIds(clm, MS.draft.sorts); MS.msg = ''; go('compose'); }   /* sorts toujours préparés (domaine, serment) : hors deck */
      return;
    }
    if (a === 'addspells') { MS.q = ''; MS.lv = -1; MS.msg = ''; go('pick'); return; }
    if (a === 'pickdone') { MS.msg = ''; go('compose'); return; }
    if (a === 'pick' && dr) { toggleSpell(dr, sid); fillPick(); if (MS.msg) render(); return; }
    if (a === 'rm' && dr) { toggleSpell(dr, sid); render(); return; }
    if (a === 'cancel') { var kmod = dr && dr.kind === 'model'; MS.draft = null; MS.msg = ''; go(kmod ? 'models' : (MS.mode ? 'choose' : 'player')); return; }
    if (a === 'send' && dr) {
      if (dr.kind === 'model') { if (saveModel(dr)) { MS.draft = null; go('models'); } else render(); return; }
      var bad = checkDraft(dr);
      if (bad) { setMsg(bad, true); render(); return; }
      if (MS.mode === 'impose') { MS.ask = { k: 'impose' }; render(); var ok0 = rootEl.querySelector('.dk-ask [data-dkm-a="no"]'); if (ok0) ok0.focus(); return; }
      if (doPropose(dr)) { MS.draft = null; MS.mode = ''; go('player'); } else render();
      return;
    }
    if (a === 'no') { MS.ask = null; render(); return; }
    if (a === 'ok') {
      var k = MS.ask; MS.ask = null;
      if (k && k.k === 'impose' && dr) { if (doImpose(dr)) { MS.draft = null; MS.mode = ''; go('player'); } else render(); return; }
      if (k && k.k === 'delmodel') { if (cfgSet(function (x) { delete x.modeles[k.id]; })) setMsg('Deck suggéré supprimé.', false); render(); return; }
      render(); return;
    }
    if (a === 'unprop') { if (!loaded()) { waitMsg(); render(); return; } var idp = t.getAttribute('data-dk-id'); delete MS.m.propose[idp]; putM(MS.pid); setMsg('Proposition retirée.', false); render(); return; }
    if (a === 'unimp') { if (!loaded()) { waitMsg(); render(); return; } var idi = t.getAttribute('data-dk-id'); delete MS.m.impose[idi]; putM(MS.pid); setMsg('Retirée de la liste (sa fiche et ses decks ne changent pas).', false); render(); return; }
    if (a === 'newmodel') { MS.draft = newDraft('model'); MS.mode = ''; MS.msg = ''; go('compose'); return; }
    if (a === 'editmodel') { var m = cfgNow().modeles[mid]; if (m) { MS.draft = { kind: 'model', id: m.id, nom: m.nom, note: m.note || '', theme: m.theme || 'autre', classe: m.classe, min: m.min, sorts: m.sorts.slice(), favoris: [] }; MS.msg = ''; go('compose'); } return; }
    if (a === 'delmodel') { var m2 = cfgNow().modeles[mid]; if (m2) { MS.ask = { k: 'delmodel', id: mid, nom: m2.nom }; render(); var no = rootEl.querySelector('.dk-ask [data-dkm-a="no"]'); if (no) no.focus(); } return; }
  }
  function onInput(ev) {
    var t = ev.target, f = t && t.getAttribute ? t.getAttribute('data-dkm-f') : '', dr = MS.draft;
    if (f === 'q') { MS.q = t.value; fillPick(); return; }
    if (!dr) return;
    if (f === 'nom') dr.nom = T.cut(t.value, LIM.nom);
    else if (f === 'note') dr.note = T.cut(t.value, LIM.note);
  }
  function onChange(ev) {
    var t = ev.target, f = t && t.getAttribute ? t.getAttribute('data-dkm-f') : '', dr = MS.draft, v;
    if (f === 'actif') { v = !!t.checked; cfgSet(function (c) { c.actif = v; }); return; }
    if (f === 'libre') { v = !!t.checked; cfgSet(function (c) { c.libre = v; }); return; }
    if (f === 'plibre') {
      if (!loaded()) { waitMsg(); render(); return; }
      MS.m.libre = t.value === '1' ? true : t.value === '0' ? false : null;
      putM(MS.pid);
      setMsg('Réglage enregistré pour cette joueuse.', false); render(); return;
    }
    if (!dr) return;
    if (f === 'theme' && THEMES.indexOf(t.value) >= 0) dr.theme = t.value;
    else if (f === 'classe' && CLASSES.indexOf(t.value) >= 0) { if (t.value !== dr.classe) { dr.classe = t.value; dr.sorts = []; dr.favoris = []; } render(); }
    else if (f === 'min') { dr.min = parseInt(t.value, 10) || 1; dr.sorts = dr.sorts.filter(function (id) { var r = X.spById(id); return r && r.l <= maxLvl(dr); }); render(); }
  }
  function onKey(ev) {
    if (!MS.open || !rootEl || rootEl.hidden) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (MS.ask) { MS.ask = null; render(); }
      else if (MS.view === 'pick') go('compose');
      else if (MS.view === 'compose') { var km = MS.draft && MS.draft.kind === 'model'; MS.draft = null; go(km ? 'models' : (MS.mode ? 'choose' : 'player')); }
      else if (MS.view === 'choose') go('player');
      else closeUI();
      return;
    }
    if (ev.key !== 'Tab') return;
    var f = [].filter.call(rootEl.querySelectorAll('button, input, select, textarea, summary'), function (x) { return !x.disabled && x.getBoundingClientRect().width > 0; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], cur = doc.activeElement;
    if (!rootEl.contains(cur)) { ev.preventDefault(); first.focus(); return; }
    if (ev.shiftKey && (cur === first || cur === rootEl.querySelector('#dkmTitle'))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  }
  doc.addEventListener('keydown', onKey);

  /* ---------- démarrage : panneau visible selon decks/cfg (ou « #decks » une fois) ---------- */
  function hashCheck() { try { if (/decks/i.test(root.location.hash || '') && isMj()) { setFlag(); panSig = ''; refresh(); } } catch (e) { /* ignoré */ } }
  T.onCfg.push(function () { panSig = ''; refresh(); });
  if (root.addEventListener) root.addEventListener('hashchange', hashCheck);
  root.setInterval(function () { if (isMj()) { try { ensurePanel(); } catch (e) { /* ignoré */ } } }, 2500);
  root.setTimeout(function () { hashCheck(); refresh(); }, 600);
  T.mj = { open: function (pid) { openUI(pid ? 'player' : 'models', pid || '', null); }, _state: function () { return { MS: MS, Q: Q }; } };
})(typeof window !== 'undefined' ? window : null);
