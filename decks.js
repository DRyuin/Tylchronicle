/* decks.js : decks de sorts de la joueuse (Table de combat Tylchronicle). ES5, sans bibliothèque, auto-exécuté.
   1. Modèle pur (testé sous Node : shimtest/decks-pure-test.js) : limites de la migration 021, validation, fusion par rev, avertissements,
      équipement (limite de préparation), classes à sorts connus, paliers et decks suggérés.
   2. Interface (navigateur seulement) : écran plein écran « Mes decks » (#dkRoot), stockage decks/p_<pid> (la joueuse n'écrit que SON document),
      lecture de decks/cfg et decks/m_<pid>, anti-rebond d'écriture 1 s, file locale hors ligne, pierres tombales (jamais de suppression de ligne).
   Tout ce qui touche à la fiche passe par l'éditeur de sorts existant (spedSave, via le pont tylDK.bind d'app.js) : aucune logique de plafonds en double.
   Le bouton « Mes decks » n'existe QUE si decks/cfg existe avec actif:true. Sans cela, rien ne change. */
(function (root) {
  'use strict';

  var api = {};
  var LIM = { decks: 12, sorts: 60, nom: 40, note: 140, octets: 65536, cles: 24, props: 12, modeles: 80, octetsM: 131072, octetsCfg: 262144 };
  var CLASSES = ['Barde', 'Clerc', 'Druide', 'Druide (enfant de la mer)', 'Paladin', 'Rôdeur', 'Ensorceleur', 'Occultiste', 'Magicien'];
  var THEMES = ['combat', 'controle', 'soutien', 'exploration', 'social', 'autre'];
  var THEME_LBL = { combat: 'Combat', controle: 'Contrôle', soutien: 'Soutien', exploration: 'Exploration', social: 'Social / infiltration', autre: 'Autre' };
  var KNOWN = { 'Barde': 1, 'Ensorceleur': 1, 'Occultiste': 1, 'Rôdeur': 1, 'Druide (enfant de la mer)': 1 };
  var PREP = { 'Clerc': 1, 'Druide': 1, 'Paladin': 1, 'Magicien': 1 };
  var ID_RE = /^d_[a-z0-9]{4,16}$/;
  var SPELL_RE = /^[A-Za-z0-9 ,'’:/.()_-]{1,60}$/;
  var SRC_RE = /^(moi|mj|modele:[A-Za-z0-9_-]{1,40})$/;

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function keys(o) { return isObj(o) ? Object.keys(o) : []; }
  function fold(s) { s = String(s == null ? '' : s).toLowerCase(); try { s = s.normalize('NFD'); } catch (e) { /* ancien navigateur */ } return s.replace(/[̀-ͯ]/g, ''); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  api.LIM = LIM; api.CLASSES = CLASSES; api.THEMES = THEMES; api.THEME_LBL = THEME_LBL;

  /* ---------- identifiants, textes ---------- */
  function spellIdOk(s) { return typeof s === 'string' && SPELL_RE.test(s); }
  function newId(rnd) {
    var a = 'abcdefghijklmnopqrstuvwxyz0123456789', s = 'd_', i;
    for (i = 0; i < 7; i++) s += a.charAt(Math.floor((rnd ? rnd() : Math.random()) * 36) % 36);
    return s;
  }
  function plain(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^ +| +$/g, ''); }
  /* texte compté et coupé par points de code (la base compte char_length) : jamais de demi-emoji, un demi-emoji isolé est retiré (PostgreSQL le refuse) */
  function cps(s) { return (String(s == null ? '' : s).match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) || []).filter(function (c) { return c.length === 2 || !/[\uD800-\uDFFF]/.test(c); }); }
  function cpLen(s) { return typeof s === 'string' ? cps(s).length : 0; }
  function wellFormed(s) { return typeof s === 'string' && cps(s).join('') === s; }
  function cut(s, n) { return cps(s).slice(0, n).join(''); }
  function cleanName(s) { return cut(plain(s), LIM.nom).replace(/ +$/, ''); }
  function cleanNote(s) { return cut(plain(s), LIM.note); }
  api.cpLen = cpLen; api.cut = cut; api.spellIdOk = spellIdOk; api.newId = newId; api.cleanName = cleanName; api.cleanNote = cleanNote;

  /* ---------- validation (miroir de private.decks_item_ok, migration 021) ---------- */
  function listOk(a, max) {
    var i, seen = {};
    if (!Array.isArray(a) || a.length > max) return false;
    for (i = 0; i < a.length; i++) { if (!spellIdOk(a[i]) || has(seen, a[i])) return false; seen[a[i]] = 1; }
    return true;
  }
  function validDeck(d) {
    var i;
    if (!isObj(d)) return 'deck mal formé';
    if (typeof d.id !== 'string' || !ID_RE.test(d.id)) return 'identifiant de deck invalide';
    if (typeof d.nom !== 'string' || !d.nom.replace(/\s+/g, '') || cpLen(d.nom) > LIM.nom || !wellFormed(d.nom) || /[\u0000-\u001f\u007f]/.test(d.nom)) return 'nom invalide (1 à ' + LIM.nom + ' caractères)';
    if (d.note != null && (typeof d.note !== 'string' || cpLen(d.note) > LIM.note || !wellFormed(d.note) || /[\u0000-\u001f\u007f]/.test(d.note))) return 'note invalide (' + LIM.note + ' caractères au plus)';
    if (CLASSES.indexOf(d.classe) < 0) return 'classe inconnue';
    if (!isInt(d.niveau) || d.niveau < 1 || d.niveau > 20) return 'niveau invalide (1 à 20)';
    if (d.theme != null && THEMES.indexOf(d.theme) < 0) return 'thème inconnu';
    if (!listOk(d.sorts, LIM.sorts)) return LIM.sorts + ' sorts au plus, identifiants valides et sans doublon';
    if (d.favoris != null) {
      if (!listOk(d.favoris, LIM.sorts)) return 'favoris invalides';
      for (i = 0; i < d.favoris.length; i++) if (d.sorts.indexOf(d.favoris[i]) < 0) return 'favoris : sous-ensemble des sorts du deck';
    }
    if (d.rev != null && (!isInt(d.rev) || d.rev < 0 || d.rev > 999999999)) return 'rev invalide';
    if (d.src != null && (typeof d.src !== 'string' || !SRC_RE.test(d.src))) return 'origine invalide';
    if (d.maj != null && (!isInt(d.maj) || d.maj < 0)) return 'date invalide';
    return '';
  }
  function pack(d) {   // forme envoyée à la base : seulement les champs connus (la base refuse les autres)
    var o = { id: d.id, nom: d.nom, perso: d.perso, classe: d.classe, niveau: d.niveau, sorts: d.sorts.slice(), favoris: (d.favoris || []).slice(), theme: d.theme || 'autre', note: d.note || '', rev: d.rev || 0, src: d.src || 'moi', maj: d.maj || 0 };
    if (typeof o.perso !== 'string') delete o.perso;
    return o;
  }
  function cleanDeck(d) {
    if (validDeck(d)) return null;
    var o = pack(d); if (d.perso == null) delete o.perso; return o;
  }
  function cleanDoc(raw) {
    var o = { decks: {}, actif: '', eq: null, vus: {}, palier: 0 };
    if (!isObj(raw)) return o;
    keys(raw.decks).forEach(function (k) {
      if (!ID_RE.test(k)) return;
      var d = raw.decks[k];
      if (d === null) o.decks[k] = null;
      else if (isObj(d) && d.id === k) { var c = cleanDeck(d); if (c) o.decks[k] = c; }
    });
    if (typeof raw.actif === 'string' && (raw.actif === '' || ID_RE.test(raw.actif))) o.actif = raw.actif;
    if (isObj(raw.eq) && (raw.eq.deck === '' || (typeof raw.eq.deck === 'string' && ID_RE.test(raw.eq.deck)))) {
      o.eq = { deck: raw.eq.deck, rev: isInt(raw.eq.rev) ? raw.eq.rev : 0, lr: isInt(raw.eq.lr) ? raw.eq.lr : 0, at: isInt(raw.eq.at) ? raw.eq.at : 0 };
    }
    keys(raw.vus).forEach(function (k) { if (ID_RE.test(k) && (raw.vus[k] === 'ok' || raw.vus[k] === 'non')) o.vus[k] = raw.vus[k]; });
    if (isInt(raw.palier) && raw.palier >= 0 && raw.palier <= 20) o.palier = raw.palier;
    return o;
  }
  function liveDecks(map) {
    return keys(map).filter(function (k) { return isObj(map[k]); }).map(function (k) { return map[k]; })
      .sort(function (a, b) { return String(a.nom).localeCompare(String(b.nom), 'fr', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1); });
  }
  api.validDeck = validDeck; api.cleanDoc = cleanDoc; api.liveDecks = liveDecks; api.pack = pack;

  /* ---------- fusion par rev (plusieurs appareils) ---------- */
  function mergeDecks(local, remote, dirty) {
    var out = {}, conflicts = [], all = {};
    keys(local).concat(keys(remote)).forEach(function (k) { all[k] = 1; });
    Object.keys(all).forEach(function (k) {
      var l = has(local || {}, k) ? local[k] : undefined, r = has(remote || {}, k) ? remote[k] : undefined;
      if (dirty && dirty[k]) {
        if (l === null) out[k] = null;                                  // suppression locale en attente d'envoi
        else if (l && r && r.rev > l.rev) { out[k] = r; conflicts.push(k); }   // modifié ailleurs avec une rev plus haute : le plus récent gagne
        else out[k] = l === undefined ? r : l;
      } else out[k] = r !== undefined ? r : l;
    });
    return { decks: out, conflicts: conflicts };
  }
  api.mergeDecks = mergeDecks;

  /* ---------- règles : limite de préparation, avertissements, comparaison ---------- */
  function trimToLimit(sorts, favoris, n) {
    var keep = (sorts || []).slice(), drop = [], fav = favoris || [], i;
    for (i = keep.length - 1; i >= 0 && keep.length > n; i--) if (fav.indexOf(keep[i]) < 0) { drop.unshift(keep[i]); keep.splice(i, 1); }
    while (keep.length > n) drop.unshift(keep.pop());
    return { keep: keep, drop: drop };
  }
  function warnings(deck, spOf) {
    var conc = [], cout = [], rit = [], bon = [], rea = [], inc = [];
    ((deck && deck.sorts) || []).forEach(function (id) {
      var r = spOf(id);
      if (!r) { inc.push(id); return; }
      if (r.k) conc.push(id);
      if (r.m && /\b\d[\d,.]*\s*(gp|po)\b/i.test(String(r.m))) cout.push(id);
      if (r.q) rit.push(id);
      if (/bonus/i.test(String(r.t))) bon.push(id);
      else if (/r[ée]action/i.test(String(r.t))) rea.push(id);
    });
    var w = [];
    if (conc.length > 1) w.push({ k: 'conc', ids: conc });
    if (cout.length) w.push({ k: 'cout', ids: cout });
    if (rit.length) w.push({ k: 'rituel', ids: rit });
    if (bon.length) w.push({ k: 'bonus', ids: bon });
    if (rea.length) w.push({ k: 'reaction', ids: rea });
    if (inc.length) w.push({ k: 'inconnu', ids: inc });
    return w;
  }
  function diffSets(a, b) {
    a = a || []; b = b || [];
    return { onlyA: a.filter(function (x) { return b.indexOf(x) < 0; }), onlyB: b.filter(function (x) { return a.indexOf(x) < 0; }), both: a.filter(function (x) { return b.indexOf(x) >= 0; }) };
  }
  function restAllows(eq, lr, libre) { return !!libre || !eq || lr > (eq.lr || 0); }
  function libreOf(cfg, m) {
    if (m && typeof m.libre === 'boolean') return m.libre;
    return !!(cfg && cfg.libre === true);
  }
  api.trimToLimit = trimToLimit; api.warnings = warnings; api.diffSets = diffSets; api.restAllows = restAllows; api.libreOf = libreOf;

  /* ---------- classes à sorts connus (tranche 2) ---------- */
  function mode(classe) { return has(KNOWN, classe) ? 'known' : has(PREP, classe) ? 'prep' : ''; }
  function knownState(sorts, mine, conseil) {
    var o = { connus: [], aApprendre: [], perdus: [] };
    (sorts || []).forEach(function (id) { if (mine && mine[id]) o.connus.push(id); else (conseil ? o.aApprendre : o.perdus).push(id); });
    return o;
  }
  function conseilFor(C, classe, lv) {
    if (!isObj(C) || !isObj(C[classe])) return null;
    var ks = keys(C[classe]).map(Number).filter(function (n) { return isInt(n); }).sort(function (a, b) { return a - b; }), cur = 0, nxt = 0, i;
    for (i = 0; i < ks.length; i++) { if (ks[i] <= lv) cur = ks[i]; else { nxt = ks[i]; break; } }
    return { niveau: cur, txt: cur ? String(C[classe][cur]) : '', suivant: nxt ? { niveau: nxt, txt: String(C[classe][nxt]) } : null };
  }
  api.mode = mode; api.knownState = knownState; api.conseilFor = conseilFor;

  /* ---------- paliers et decks suggérés (tranche 3) ---------- */
  var PALIERS = [1, 3, 5, 7, 9, 11, 13, 17], PAL_LBL = { 1: '1-2', 3: '3-4', 5: '5-6', 7: '7-8', 9: '9-10', 11: '11-12', 13: '13-16', 17: '17-20' };
  function palier(lv) {
    var p = 1, i;
    if (!isInt(lv)) return 1;
    for (i = 0; i < PALIERS.length; i++) if (PALIERS[i] <= lv) p = PALIERS[i];
    return p;
  }
  function modelOk(m) {
    return isObj(m) && typeof m.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(m.id) && CLASSES.indexOf(m.classe) >= 0 && isInt(m.min) && m.min >= 1 && m.min <= 20 &&
      typeof m.nom === 'string' && !!plain(m.nom) && Array.isArray(m.sorts) && m.sorts.length <= LIM.sorts && m.sorts.every(spellIdOk);
  }
  function suggest(models, custom, classe, niveau) {
    var all = [], best = 0, liste;
    (models || []).forEach(function (m) { if (modelOk(m)) all.push(m); });
    (custom || []).forEach(function (m) { if (modelOk(m)) { var c = clone(m); c.mj = true; all.push(c); } });
    all = all.filter(function (m) { return m.classe === classe && m.min <= niveau; });
    all.forEach(function (m) { if (palier(m.min) > best) best = palier(m.min); });
    liste = all.filter(function (m) { return palier(m.min) === best; });
    return { palier: best, liste: liste };
  }
  function fromModel(m, niveau, id, maj, pid) {
    var d = { id: id, nom: cleanName(m.nom), classe: m.classe, niveau: niveau, sorts: (m.sorts || []).slice(0, LIM.sorts), favoris: [], theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : 'autre', note: cleanNote(m.note), rev: 1, src: 'modele:' + m.id, maj: maj };
    if (typeof pid === 'string') d.perso = pid;
    return d;
  }
  function nouveauPalier(vu, courant) { return isInt(vu) && vu > 0 && courant > vu; }
  api.palier = palier; api.PAL_LBL = PAL_LBL; api.modelOk = modelOk; api.suggest = suggest; api.fromModel = fromModel; api.nouveauPalier = nouveauPalier;

  /* ---------- tranche 4 : documents du MJ (m_<pid>, cfg), propositions, impositions, modèles maison ---------- */
  var MODEL_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  function newModelId(rnd) {
    var a = 'abcdefghijklmnopqrstuvwxyz0123456789', s = 'mj_', i;
    for (i = 0; i < 8; i++) s += a.charAt(Math.floor((rnd ? rnd() : Math.random()) * 36) % 36);
    return s;
  }
  function liveMap(raw) {
    var o = {};
    keys(raw).forEach(function (k) { var d = raw[k]; if (ID_RE.test(k) && isObj(d) && d.id === k) { var c = cleanDeck(d); if (c) o[k] = c; } });
    return o;
  }
  function cleanM(raw) {
    var o = { propose: {}, impose: {}, libre: null };
    if (!isObj(raw)) return o;
    o.propose = liveMap(raw.propose); o.impose = liveMap(raw.impose);
    if (typeof raw.libre === 'boolean') o.libre = raw.libre;
    return o;
  }
  function packMap(map) { var o = {}; keys(map).forEach(function (k) { if (isObj(map[k]) && !validDeck(map[k])) o[k] = pack(map[k]); }); return o; }
  function mBody(m) {
    var b = { v: 1, propose: packMap(m && m.propose), impose: packMap(m && m.impose) };
    if (m && typeof m.libre === 'boolean') b.libre = m.libre;
    return b;
  }
  function canAdd(map, max) { return liveDecks(map || {}).length < max && keys(map).length < 2 * max; }
  function modelValid(m) {
    var i, seen = {};
    if (!isObj(m)) return 'modèle mal formé';
    if (typeof m.id !== 'string' || !MODEL_ID_RE.test(m.id)) return 'identifiant de modèle invalide';
    if (CLASSES.indexOf(m.classe) < 0) return 'classe inconnue';
    if (!isInt(m.min) || m.min < 1 || m.min > 20) return 'niveau minimum invalide (1 à 20)';
    if (m.theme != null && THEMES.indexOf(m.theme) < 0) return 'thème inconnu';
    if (typeof m.nom !== 'string' || !m.nom.replace(/\s+/g, '') || cpLen(m.nom) > LIM.nom || !wellFormed(m.nom) || /[\u0000-\u001f\u007f]/.test(m.nom)) return 'nom invalide (1 à ' + LIM.nom + ' caractères)';
    if (m.note != null && (typeof m.note !== 'string' || cpLen(m.note) > LIM.note || !wellFormed(m.note) || /[\u0000-\u001f\u007f]/.test(m.note))) return 'note invalide (' + LIM.note + ' caractères au plus)';
    if (!Array.isArray(m.sorts) || m.sorts.length > LIM.sorts) return LIM.sorts + ' sorts au plus';
    for (i = 0; i < m.sorts.length; i++) { if (!spellIdOk(m.sorts[i]) || has(seen, m.sorts[i])) return 'identifiant de sort invalide ou en double'; seen[m.sorts[i]] = 1; }
    return '';
  }
  function modelPack(m) {
    var o = { id: m.id, classe: m.classe, min: m.min, theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : 'autre', nom: m.nom, sorts: m.sorts.slice(), note: m.note || '' };
    return o;
  }
  function cleanCfg(raw) {
    var o = { actif: false, libre: false, modeles: {} };
    if (!isObj(raw)) return o;
    o.actif = raw.actif === true; o.libre = raw.libre === true;
    keys(raw.modeles).forEach(function (k) { var m = raw.modeles[k]; if (isObj(m) && m.id === k && !modelValid(m)) o.modeles[k] = modelPack(m); });
    return o;
  }
  function cfgBody(c) {
    var b = { v: 1, actif: !!(c && c.actif), libre: !!(c && c.libre), modeles: {} }, n = 0;
    keys(c && c.modeles).sort().forEach(function (k) { var m = c.modeles[k]; if (n < LIM.modeles && isObj(m) && m.id === k && !modelValid(m)) { b.modeles[k] = modelPack(m); n++; } });
    return b;
  }
  function mjDeck(spec, pid, niveau, id, maj) {
    var seen = {}, sorts = [], fav = [];
    (spec.sorts || []).forEach(function (s) { if (spellIdOk(s) && !has(seen, s) && sorts.length < LIM.sorts) { seen[s] = 1; sorts.push(s); } });
    (spec.favoris || []).forEach(function (s) { if (has(seen, s) && fav.indexOf(s) < 0) fav.push(s); });
    var d = { id: id, nom: cleanName(spec.nom) || 'Deck du MJ', classe: spec.classe, niveau: Math.max(1, Math.min(20, isInt(niveau) ? niveau : 1)), sorts: sorts, favoris: fav, theme: THEMES.indexOf(spec.theme) >= 0 ? spec.theme : 'autre', note: cleanNote(spec.note), rev: 1, src: 'mj', maj: maj || 0 };
    if (typeof pid === 'string' && pid) d.perso = pid;
    return d;
  }
  function reponses(m, vus) {
    var r = { propose: [], impose: [] };
    if (!isObj(m)) return r;
    vus = isObj(vus) ? vus : {};
    r.propose = liveDecks(m.propose || {}).filter(function (d) { return !has(vus, d.id); });
    r.impose = liveDecks(m.impose || {}).filter(function (d) { return !has(vus, d.id); });
    return r;
  }
  function pruneVus(vus, m) {
    var o = {};
    keys(vus).forEach(function (k) { if (m && ((isObj(m.propose) && has(m.propose, k)) || (isObj(m.impose) && has(m.impose, k)))) o[k] = vus[k]; });
    return o;
  }
  function acceptDeck(prop, id, pid, niveau, legal) {
    var c = mjDeck({ nom: prop.nom, classe: prop.classe, theme: prop.theme, note: prop.note, sorts: (prop.sorts || []).filter(legal), favoris: prop.favoris }, pid, niveau, id, prop.maj);
    return c;
  }
  function rangSort(id, v) { return v && v.fav && v.fav[id] ? 0 : v && v.set && v.set[id] ? 1 : v ? 2 : 1; }
  function equipBloque(ctx, reposRequis, libre) { return ctx === 'cs' && !!reposRequis && !libre; }
  api.newModelId = newModelId; api.cleanM = cleanM; api.mBody = mBody; api.canAdd = canAdd; api.modelValid = modelValid; api.modelPack = modelPack; api.cleanCfg = cleanCfg; api.cfgBody = cfgBody;
  api.mjDeck = mjDeck; api.reponses = reponses; api.pruneVus = pruneVus; api.acceptDeck = acceptDeck; api.rangSort = rangSort; api.equipBloque = equipBloque; api.cleanDeck = cleanDeck;

  /* ---------- exports Node ---------- */
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.tylDK = api;

  /* =====================================================================
     INTERFACE (navigateur)
     ===================================================================== */
  var doc = root.document;
  var LS = 'tylchronicle-decks-v1';
  var H = null, DB = null, started = false;
  var S = { cfg: null, m: null, pid: '', exists: false, doc: cleanDoc(null), dirty: {}, meta: false, metaSeq: 0, timer: null, retry: null, busy: false, fails: 0, banner: '', ready: false, loaded: false, cuRetry: null, tick: null, sig: '', cu: null, pu: null, mu: null, purged: false };
  var UI = { open: false, ctx: 'fiche', view: 'list', id: '', ask: null, msg: '', err: false, form: false, q: '', lv: -1, sch: '', conc: false, rit: false, inc: '', opener: null };
  var rootEl = null;

  function esc(s) { var f = H && H.esc; return f ? f(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; }); }
  function now() { return Math.floor(Date.now() / 1000); }
  function role() { try { return H ? H.role() : ''; } catch (e) { return ''; } }
  function entry() { try { return H ? H.entry() : null; } catch (e) { return null; } }
  function spById(id) { try { return H.spById(id) || null; } catch (e) { return null; } }

  /* ----- classes lanceuses de la fiche (lues dans l'éditeur de sorts existant) ----- */
  function classesOf(e) {
    var lv = {}, out = [];
    if (!e || !e.x || !H || !H.ed) return out;
    try {
      H.ed.levels(e.x).forEach(function (c) { lv[c.n] = c.lv; });
      H.ed.ents(e).forEach(function (en) {
        if (CLASSES.indexOf(en.n) < 0) return;
        out.push({ n: en.n, mode: mode(en.n), quota: en.c.n || 0, cant: en.c.cant || 0, maxL: en.maxL || 0, alw: en.alw || [], lv: lv[en.n] || 1, book: en.c.book || 0, en: en });
      });
    } catch (er) { return []; }
    return out;
  }
  function clsOf(e, name) { var l = classesOf(e), i; for (i = 0; i < l.length; i++) if (l[i].n === name) return l[i]; return null; }
  function available() {
    if (role() !== 'joueur' || !S.cfg || S.cfg.actif !== true) return false;
    var e = entry(); if (!e || !e.x) return false;
    return classesOf(e).some(function (c) { return c.maxL >= 1; });
  }
  function activeDeck() { if (!S.cfg || S.cfg.actif !== true) return null; var d = S.doc.decks[S.doc.actif]; return isObj(d) ? d : null; }   /* sans decks/cfg.actif (pas lu, erreur, désactivé) : aucun deck actif, aucun filtre, aucun tri */
  function libre() { return libreOf(S.cfg, S.m); }
  function useLr() { try { var e = entry(); return e ? (H.ed.rest(e) | 0) : 0; } catch (er) { return 0; } }

  /* ----- bouton d'accès (fiche et panneau « Mon combat ») ----- */
  function btnHTML(ctx) {
    if (!available()) return '';
    var a = activeDeck();
    return '<button type="button" class="dk-open" data-dk-open="' + esc(ctx || 'fiche') + '" aria-haspopup="dialog"><span aria-hidden="true">🃏</span> Mes decks' + (a ? '<span class="dk-open-a"> · ' + esc(a.nom) + '</span>' : '') + '</button>' + (ctx === 'cs' ? '' : filterBtn());
  }
  function filterBtn() {
    var d = activeDeck(), cl = d && clsOf(entry(), d.classe);
    if (!d || !cl || cl.mode !== 'known') return '';
    return '<button type="button" class="dk-open dk-filter" data-dk-filter aria-pressed="' + filterOn() + '">' + (filterOn() ? 'Deck seulement : oui' : 'Deck seulement : non') + '</button>';
  }
  function paintBar() {
    var box = doc.getElementById('pvSpellBox'), bar = doc.getElementById('pvDkBar'), h = btnHTML('fiche');
    if (!box) return;
    if (!bar) {
      if (!h) return;
      bar = doc.createElement('div'); bar.id = 'pvDkBar'; bar.className = 'dk-bar';
      var ed = doc.getElementById('pvSpEd');
      if (ed && ed.parentNode === box) box.insertBefore(bar, ed); else box.appendChild(bar);
    }
    if (bar.getAttribute('data-sig') !== h) { bar.setAttribute('data-sig', h); bar.innerHTML = h; }
    bar.hidden = !h;
  }

  /* ----- stockage local (file hors ligne) ----- */
  function lsKey(pid) { return LS + ':' + pid; }   /* une file hors ligne par personnage */
  function persist() {
    if (!S.pid) return;
    try {
      localStorage.setItem(lsKey(S.pid), JSON.stringify({ pid: S.pid, doc: S.doc, dirty: S.dirty, meta: S.meta }));
      var old = JSON.parse(localStorage.getItem(LS) || 'null');   /* ancienne entrée unique : retirée une fois reprise */
      if (isObj(old) && old.pid === S.pid) localStorage.removeItem(LS);
    } catch (e) { /* mémoire seulement */ }
  }
  function loadLocal(pid) {
    S.doc = cleanDoc(null); S.dirty = {}; S.meta = false;
    try {
      var o = JSON.parse(localStorage.getItem(lsKey(pid)) || 'null');
      if (!isObj(o)) o = JSON.parse(localStorage.getItem(LS) || 'null');
      if (isObj(o) && o.pid === pid) {
        S.doc = cleanDoc(o.doc); S.meta = o.meta === true;
        keys(o.dirty).forEach(function (k) { if (has(S.doc.decks, k)) S.dirty[k] = 1; });
      }
    } catch (e) { /* ignoré */ }
  }

  /* ----- écritures : anti-rebond 1 s, une seule écriture en vol, pierres tombales ----- */
  function schedule(ms) { if (S.timer) root.clearTimeout(S.timer); S.timer = root.setTimeout(function () { S.timer = null; flush(); }, ms == null ? 1000 : ms); }
  function touch(id) {
    var d = S.doc.decks[id];
    if (isObj(d) && !S.dirty[id]) d.rev = (d.rev || 0) + 1;
    if (isObj(d)) d.maj = now();
    S.dirty[id] = 1; persist(); schedule();
  }
  function touchMeta() { S.meta = true; S.metaSeq++; persist(); schedule(); }
  function flush() {
    if (!S.pid || !DB) return;
    if (!S.loaded) return;   /* ses decks de la base pas encore reçus : on garde la file locale, onP relance l'envoi (jamais d'écriture à l'aveugle) */
    if (S.busy) { S.again = true; return; }
    var pid = S.pid, ids = keys(S.dirty), patch = {}, sent = {}, bad = '', i, id, d, tombs = 0, live = {};
    if (!ids.length && !S.meta) return;
    for (i = 0; i < ids.length; i++) {
      id = ids[i]; d = S.doc.decks[id];
      if (d === null) { patch[id] = null; sent[id] = -1; }
      else if (isObj(d)) { bad = validDeck(d); if (bad) { delete S.dirty[id]; setMsg('Deck non enregistré : ' + bad + '.', true); continue; } patch[id] = pack(d); sent[id] = d.rev; }
      else delete S.dirty[id];
    }
    keys(S.doc.decks).forEach(function (k) { if (S.doc.decks[k] === null) tombs++; else live[k] = pack(S.doc.decks[k]); });
    var full = !S.exists || tombs >= 6, metaSeq = S.metaSeq, body;
    if (full) { body = { v: 1, decks: live, actif: S.doc.actif || '', vus: S.doc.vus || {}, palier: S.doc.palier || 0 }; if (S.doc.eq) body.eq = S.doc.eq; }
    else {
      body = { v: 1 };
      if (keys(patch).length) body.decks = patch;
      if (S.meta) { body.actif = S.doc.actif || ''; body.vus = S.doc.vus || {}; body.palier = S.doc.palier || 0; if (S.doc.eq) body.eq = S.doc.eq; }
      if (keys(body).length < 2) { S.dirty = {}; persist(); return; }
    }
    if (JSON.stringify(body).length > LIM.octets - 4096) { setMsg('Trop de données dans les decks : supprime un deck ou des sorts.', true); return; }
    S.busy = true;
    var ref = DB.collection('decks').doc('p_' + pid), pr;
    try { pr = full ? ref.set(body) : ref.update(body); } catch (er) { pr = Promise.reject(er); }
    Promise.resolve(pr).then(function () {
      if (pid !== S.pid) return;   /* réponse d'un autre personnage */
      S.busy = false; S.fails = 0; S.exists = true; S.banner = '';
      Object.keys(sent).forEach(function (k) { var cur = S.doc.decks[k]; if (S.dirty[k] && (cur === null ? -1 : (cur && cur.rev)) === sent[k]) delete S.dirty[k]; });
      if (S.meta && metaSeq === S.metaSeq) S.meta = false;
      if (full) keys(S.doc.decks).forEach(function (k) { if (S.doc.decks[k] === null && !S.dirty[k]) delete S.doc.decks[k]; });
      persist();
      if (S.again || keys(S.dirty).length || S.meta) { S.again = false; schedule(300); }
      repaint();
    }, function (er) {
      if (pid !== S.pid) return;
      S.fails++;
      var c = er && er.code;
      /* update refusé : le shim ne dit pas pourquoi (document absent OU limite de la base). On relit : absent => premier envoi complet ; présent => refus, JAMAIS de set de secours */
      if (!full && c === 'invalid_argument') {
        Promise.resolve().then(function () { return ref.get(); }).then(function (sn) {
          if (pid !== S.pid) return;
          S.busy = false;
          if (sn && sn.exists) { onP(sn); failed('invalid_argument'); }
          else { S.exists = false; schedule(200); }
        }, function (e2) { if (pid !== S.pid) return; S.busy = false; failed(e2 && e2.code); });
        return;
      }
      S.busy = false; failed(c);
    });
  }
  function failed(c) {
    S.banner = c === 'invalid_argument' ? 'Enregistrement refusé : tes decks restent sur cet appareil.' : 'Hors ligne : tes changements sont gardés et seront envoyés dès que possible.';
    persist();
    if (S.fails < 8) { if (S.retry) root.clearTimeout(S.retry); S.retry = root.setTimeout(function () { S.retry = null; flush(); }, Math.min(30000, 2000 * S.fails)); }
    repaint();
  }
  if (root.addEventListener) root.addEventListener('online', function () { if (S.pid && (keys(S.dirty).length || S.meta)) { S.fails = 0; schedule(300); } });

  /* ----- lecture en direct (cfg, m_<pid>, p_<pid>) ----- */
  function unsub(k) { try { if (S[k]) S[k](); } catch (e) { /* ignoré */ } S[k] = null; }
  function startCfg() {
    if (S.cu || !DB) return;
    try {
      S.cu = DB.collection('decks').doc('cfg').onSnapshot(function (sn) {
        var was = available(), wasA = !!(S.cfg && S.cfg.actif === true);
        S.cfg = sn && sn.exists ? sn.data() : null; S.ready = true;
        if (was !== available() || wasA !== !!(S.cfg && S.cfg.actif === true)) repaint(true);
        for (var i = 0; i < api.onCfg.length; i++) { try { api.onCfg[i](); } catch (er) { /* ignoré */ } }
      }, function () {
        S.cfg = null; S.ready = false; S.cu = null; repaint(true);
        if (!S.cuRetry) S.cuRetry = root.setTimeout(function () { S.cuRetry = null; startCfg(); }, 5000);   /* nouvel essai : « Mes decks » ne disparaît pas jusqu'au rechargement */
        for (var i = 0; i < api.onCfg.length; i++) { try { api.onCfg[i](); } catch (er) { /* ignoré */ } }
      });
    } catch (e) { S.cfg = null; S.ready = false; }
  }
  function onP(sn) {
    var raw = sn && sn.exists ? sn.data() : null, rd = cleanDoc(raw), mg;
    S.exists = !!raw; S.loaded = true;
    mg = mergeDecks(S.doc.decks, rd.decks, S.dirty);
    S.doc.decks = mg.decks;
    mg.conflicts.forEach(function (k) { delete S.dirty[k]; });
    if (mg.conflicts.length) S.banner = 'Un deck a été modifié ailleurs : la version la plus récente est gardée.';
    if (!S.meta) { S.doc.actif = rd.actif; S.doc.eq = rd.eq; S.doc.vus = rd.vus; S.doc.palier = rd.palier; }
    persist();
    if (keys(S.dirty).length || S.meta) schedule(300);
    repaint(true);
  }
  function switchPid(pid) {
    unsub('pu'); unsub('mu');
    if (S.timer) { root.clearTimeout(S.timer); S.timer = null; }
    if (S.retry) { root.clearTimeout(S.retry); S.retry = null; }
    S.pid = pid; S.exists = false; S.loaded = false; S.m = null; S.banner = ''; S.fails = 0; S.busy = false; S.again = false;
    if (!pid) { S.doc = cleanDoc(null); S.dirty = {}; S.meta = false; return; }
    loadLocal(pid);
    if (!DB) return;
    try {
      S.pu = DB.collection('decks').doc('p_' + pid).onSnapshot(onP, function () { /* absent ou refusé : on garde la copie locale */ });
      S.mu = DB.collection('decks').doc('m_' + pid).onSnapshot(function (sn) { S.m = sn && sn.exists ? sn.data() : null; repaint(); }, function () { S.m = null; });
    } catch (e) { /* ignoré */ }
  }
  function sync() {
    if (role() !== 'joueur') return;
    var e = entry(), pid = e && e.id ? String(e.id) : '';
    if (pid !== S.pid) switchPid(pid);
  }

  function repaint(force) {
    paintBar();
    var fs = (function () { var d = activeDeck(); return d ? d.id + '|' + d.sorts.join(',') + '|' + (d.favoris || []).join(',') + '|' + filterOn() : ''; })();
    if (fs !== S.fsig) { var first = S.fsig === undefined; S.fsig = fs; if (!first || fs) applyFilter(); }
    if (UI.open && rootEl && !rootEl.hidden) {
      var a = doc.activeElement, typing = a && rootEl.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
      if (force !== 'now' && typing) return;
      render();
    }
  }

  /* ----- messages ----- */
  function setMsg(t, err) { UI.msg = t || ''; UI.err = !!err; }

  /* ----- actions sur les decks ----- */
  function liveCount() { return liveDecks(S.doc.decks).length; }
  function createDeck(nom, classe, extra) {
    var e = entry(), cl = clsOf(e, classe), id, d;
    if (!e || !cl) return null;
    if (liveCount() >= LIM.decks) { setMsg('Tu as déjà ' + LIM.decks + ' decks : supprime-en un avant d\'en créer un autre.', true); return null; }
    do { id = newId(); } while (has(S.doc.decks, id));
    d = { id: id, nom: cleanName(nom) || 'Nouveau deck', perso: S.pid, classe: classe, niveau: Math.max(1, Math.min(20, cl.lv)), sorts: [], favoris: [], theme: 'autre', note: '', rev: 0, src: 'moi', maj: now() };
    if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
    S.doc.decks[id] = d; touch(id);
    if (!S.doc.palier && liveCount() === 1) markSeen();
    return d;
  }
  function dupDeck(id) {
    var s = S.doc.decks[id], nid;
    if (!isObj(s)) return;
    if (liveCount() >= LIM.decks) { setMsg('Tu as déjà ' + LIM.decks + ' decks : supprime-en un avant d\'en dupliquer un.', true); return; }
    do { nid = newId(); } while (has(S.doc.decks, nid));
    var c = clone(s); c.id = nid; c.nom = cleanName(cut(s.nom, LIM.nom - 9) + ' (copie)'); c.rev = 0; c.src = 'moi'; c.maj = now();
    S.doc.decks[nid] = c; touch(nid);
  }
  function delDeck(id) {
    if (!has(S.doc.decks, id)) return;
    S.doc.decks[id] = null; S.dirty[id] = 1;
    if (S.doc.actif === id) { S.doc.actif = ''; touchMeta(); }
    persist(); schedule();
  }
  function toggleSpell(d, sid) {
    var i = d.sorts.indexOf(sid), f;
    if (i >= 0) { d.sorts.splice(i, 1); f = d.favoris.indexOf(sid); if (f >= 0) d.favoris.splice(f, 1); }
    else { if (d.sorts.length >= LIM.sorts) { setMsg('Un deck contient ' + LIM.sorts + ' sorts au plus.', true); return false; } d.sorts.push(sid); }
    touch(d.id); return true;
  }
  function toggleFav(d, sid) {
    if (d.sorts.indexOf(sid) < 0) return;
    var f = d.favoris.indexOf(sid);
    if (f >= 0) d.favoris.splice(f, 1); else d.favoris.push(sid);
    touch(d.id);
  }

  /* ----- classes à sorts connus : raccourci, filtre, conseil ----- */
  function addKnown(d) {
    var e = entry(), cl = clsOf(e, d.classe), M, n = 0;
    if (!e || !cl) return;
    M = H.ed.model(e);
    H.sp().forEach(function (r) {
      if (r.l < 1 || !M.mine[r.e] || d.sorts.indexOf(r.e) >= 0 || cl.alw.indexOf(r.e) >= 0 || !H.ed.ok(cl.en, r) || d.sorts.length >= LIM.sorts) return;
      d.sorts.push(r.e); n++;
    });
    if (n) touch(d.id);
    setMsg(n ? n + ' sort' + (n > 1 ? 's' : '') + ' connu' + (n > 1 ? 's' : '') + ' ajouté' + (n > 1 ? 's' : '') + '.' : 'Tous tes sorts connus sont déjà dans ce deck.', false);
  }
  function learn(d) {
    var e = entry(), cl = clsOf(e, d.classe), ed = H.ed, M, dr, ids, n = 0;
    if (!e || !cl) return;
    M = ed.model(e); dr = ed.draft(e.id); ids = knownOf(d).aApprendre;
    ids.forEach(function (id) { var r = spById(id); if (r && r.l > 0 && !M.mine[id] && !ed.lock(M, r) && ed.ok(cl.en, r) && dr.add.indexOf(id) < 0) { dr.add.push(id); dr.as[id] = cl.n; n++; } });
    ed.norm(M, dr); ed.put();
    var u = ed.ui(e.id); u.open = true; u.msg = ''; u.err = false; u.ask = false;
    closeUI();
    var tab = doc.getElementById('pvTab-sorts'); if (tab) { try { tab.click(); } catch (er) { /* ignoré */ } }
    try { ed.refresh(e.id, '.sped-hd h3'); } catch (er2) { /* ignoré */ }
  }
  /* filtre de l'onglet Sorts (fiche et « Mon combat ») : seulement pour un deck ACTIF de classe à sorts connus, désactivable */
  var FLT = 'tylchronicle-decks-filtre';
  function filterOn() { try { return localStorage.getItem(FLT) !== '0'; } catch (e) { return true; } }
  function filterDeck() {
    var d = activeDeck(), cl = d && clsOf(entry(), d.classe);
    return d && cl && cl.mode === 'known' && filterOn() ? d : null;
  }
  function only(r) {
    if (!r || r.l === 0) return true;
    var d = filterDeck();
    return !d || d.sorts.indexOf(r.e) >= 0;
  }
  function applyFilter() { try { if (H.spells) H.spells(); if (H.render) H.render(); } catch (e) { /* ignoré */ } }
  /* onglet Sorts du panneau « Mon combat » : puces « Deck actif / Tous ». Classes à sorts connus : le deck filtre ; classes préparées : la liste préparée EST
     le deck, « Deck actif » masque seulement les sorts de la classe qui ne sont pas dans le deck (les tours, les toujours préparés et les sorts d'ailleurs restent). */
  function deckView(rows) {
    var d = activeDeck(), cl = d && clsOf(entry(), d.classe), set = {}, fav = {}, on, out;
    if (!d || !cl || !Array.isArray(rows)) return null;
    d.sorts.forEach(function (id) { set[id] = 1; });
    (d.favoris || []).forEach(function (id) { fav[id] = 1; });
    on = filterOn(); out = rows;
    if (on) out = rows.filter(function (r) {
      if (!r || r.l === 0 || set[r.e]) return true;
      if (cl.mode === 'known') return false;
      try { return cl.alw.indexOf(r.e) >= 0 || !H.ed.ok(cl.en, r); } catch (er) { return true; }
    });
    return { nom: d.nom, on: on, set: set, fav: fav, rows: out };
  }
  function setFilter(on) { try { localStorage.setItem(FLT, on ? '1' : '0'); } catch (e) { /* ignoré */ } paintBar(); applyFilter(); }
  function rank(r) {
    var d = activeDeck(), set = {}, fav = {};
    if (!d || !r) return 1;
    d.sorts.forEach(function (id) { set[id] = 1; }); (d.favoris || []).forEach(function (id) { fav[id] = 1; });
    return rangSort(r.e, { set: set, fav: fav });
  }
  doc.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-dk-filter]') : null;
    if (!t) return;
    ev.preventDefault();
    try { localStorage.setItem(FLT, filterOn() ? '0' : '1'); } catch (e) { /* ignoré */ }
    paintBar(); applyFilter();
  });

  /* ----- équipement ----- */
  function legalIds(cl, ids) {
    return ids.filter(function (id) { var r = spById(id); return r && r.l > 0 && cl.alw.indexOf(id) < 0 && H.ed.ok(cl.en, r); });   /* les sorts toujours préparés sont hors limite et hors deck */
  }
  function planEquip(d) {
    var e = entry(), cl = clsOf(e, d.classe), p = { cl: cl, ok: false };
    if (!e || !cl) { p.msg = 'Cette classe n\'est plus sur ta fiche.'; return p; }
    var legal = legalIds(cl, d.sorts), tr = trimToLimit(legal, d.favoris, cl.quota);
    p.ok = true; p.keep = tr.keep; p.drop = tr.drop; p.illegal = d.sorts.length - legal.length;
    p.rest = cl.mode === 'prep' && !restAllows(S.doc.eq, useLr(), libre());
    return p;
  }
  /* écrit les sorts préparés sur la fiche e (joueuse ou MJ) en passant par l'éditeur de sorts existant : même chemin que « Enregistrer » */
  function sheetEquip(e, cl, keep) {
    var ed = H.ed, u, dd, M, bad, locked = [], tset = {}, pend = ed.draft(e.id);
    if (pend.add.length || pend.del.length) return { ok: false, msg: 'Il y a des changements de sorts non enregistrés dans l\'éditeur de sorts : enregistre-les ou annule-les d\'abord.' };
    M = ed.model(e); dd = { add: [], del: [], as: {} };
    keep.forEach(function (id) { tset[id] = 1; if (!M.mine[id]) { dd.add.push(id); dd.as[id] = cl.n; } });
    H.sp().forEach(function (r) {
      if (r.l < 1 || !M.mine[r.e] || tset[r.e]) return;
      var lk = ed.lock(M, r);
      if (lk) { if (lk.k === 'note') locked.push(r.n); return; }
      var en2 = ed.entOf(M, r, cl.n);
      if (en2 && en2.n === cl.n) dd.del.push(r.e);
    });
    ed.norm(M, dd);
    bad = ed.over(M, dd);
    if (bad) return { ok: false, msg: bad };
    ed.setDraft(e.id, dd); ed.put(); ed.save(e.id);
    u = ed.ui(e.id);
    pend = ed.draft(e.id);
    if (u.err || pend.add.length || pend.del.length) {
      var why = u.msg || 'Équipement impossible.';
      ed.setDraft(e.id, { add: [], del: [], as: {} }); ed.put(); ed.refresh(e.id);
      return { ok: false, msg: why };
    }
    return { ok: true, locked: locked };
  }
  function doEquip(d, keep) {
    var e = entry(), cl = clsOf(e, d.classe), r, locked;
    if (!e || !cl) { setMsg('Cette classe n\'est plus sur ta fiche.', true); return false; }
    if (cl.mode === 'known') { S.doc.actif = d.id; touchMeta(); setMsg('Deck « ' + d.nom + ' » activé : il filtre tes sorts.', false); return true; }
    r = sheetEquip(e, cl, keep);
    if (!r.ok) { setMsg(r.msg, true); return false; }
    locked = r.locked;
    S.doc.actif = d.id; S.doc.eq = { deck: d.id, rev: d.rev || 0, lr: useLr(), at: now() }; touchMeta();
    setMsg('Deck « ' + d.nom + ' » équipé : ' + keep.length + ' sort' + (keep.length > 1 ? 's' : '') + ' préparé' + (keep.length > 1 ? 's' : '') + '.' + (locked.length ? ' ' + locked.length + ' sort' + (locked.length > 1 ? 's' : '') + ' noté' + (locked.length > 1 ? 's' : '') + ' ailleurs non touché' + (locked.length > 1 ? 's' : '') + '.' : ''), false);
    return true;
  }
  function askEquip(id) {
    var d = S.doc.decks[id], p;
    if (!isObj(d)) return;
    p = planEquip(d);
    if (!p.ok) { setMsg(p.msg, true); return; }
    if (p.cl.mode === 'known') { doEquip(d, d.sorts.slice()); return; }
    if (equipBloque(UI.ctx, p.rest, libre())) { setMsg('Changement bloqué en combat : tu as déjà changé de deck depuis ton dernier repos long. Attends un repos long ou demande au MJ d\'autoriser le changement libre.', true); return; }
    if (p.drop.length || p.rest) { UI.ask = { k: 'equip', id: id, keep: p.keep, drop: p.drop, rest: p.rest }; setMsg('', false); return; }
    doEquip(d, p.keep);
  }

  /* ----- vues ----- */
  function isConseil(d) { return /^modele:|^mj$/.test(String(d.src || '')); }
  function knownOf(d) {
    var e = entry(), M = e && H.ed.model(e);
    return knownState(d.sorts, M ? M.mine : {}, isConseil(d));
  }
  function counter(d, cl) {
    if (!cl) return '<span class="dk-count muted">classe absente de la fiche</span>';
    if (cl.mode === 'known') return '<span class="dk-count" aria-live="polite">Sorts du deck : <b>' + d.sorts.length + '</b> <small>(sorts connus : ' + cl.quota + ')</small></span>';
    var over = d.sorts.length > cl.quota;
    return '<span class="dk-count' + (over ? ' dk-bad' : d.sorts.length === cl.quota ? ' dk-full' : '') + '" aria-live="polite">Préparés : <b>' + d.sorts.length + ' / ' + cl.quota + '</b></span>';
  }
  function themeSel(v) { return THEMES.map(function (t) { return '<option value="' + t + '"' + (t === v ? ' selected' : '') + '>' + esc(THEME_LBL[t]) + '</option>'; }).join(''); }
  function tagsOf(r) {
    var t = ['Niv. ' + r.l, r.s];
    if (r.k) t.push('Concentration'); if (r.q) t.push('Rituel');
    if (/bonus/i.test(String(r.t))) t.push('Action bonus'); else if (/r[ée]action/i.test(String(r.t))) t.push('Réaction');
    if (r.m && /\b\d[\d,.]*\s*(gp|po)\b/i.test(String(r.m))) t.push('Matière coûteuse');
    return t.map(function (x) { return '<span class="dk-tag">' + esc(x) + '</span>'; }).join('');
  }
  function listHTML() {
    var e = entry(), decks = liveDecks(S.doc.decks), act = activeDeck(), h = '', cls = classesOf(e);
    h += '<div class="dk-intro"><p class="dk-active">' + (act ? 'Deck actif : <b>' + esc(act.nom) + '</b>' : 'Aucun deck actif.') + '</p><p class="dk-lim muted">' + decks.length + ' / ' + LIM.decks + ' decks</p></div>';
    if (S.banner) h += '<p class="dk-banner" role="status">' + esc(S.banner) + '</p>';
    h += bannerHTML();
    h += mjHTML();
    h += '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dk-a="new"' + (decks.length >= LIM.decks ? ' disabled' : '') + '>+ Nouveau deck</button>' + suggBtn() + '</div>';
    if (UI.form) {
      h += '<form class="dk-form" data-dk-form="new"><label>Nom du deck<input type="text" data-dk-f="newname" maxlength="' + LIM.nom + '" autocomplete="off" placeholder="Exploration, Combat…"></label>' +
        (cls.length > 1 ? '<label>Classe<select data-dk-f="newclass">' + cls.map(function (c) { return '<option>' + esc(c.n) + '</option>'; }).join('') + '</select></label>' : '') +
        '<div class="dk-btns"><button type="submit" class="dk-btn primary" data-dk-a="create">Créer</button><button type="button" class="dk-btn" data-dk-a="cancelnew">Annuler</button></div></form>';
    }
    if (UI.msg) h += '<p class="dk-msg' + (UI.err ? ' err' : '') + '" role="status">' + esc(UI.msg) + '</p>';
    if (UI.ask) h += askHTML();
    if (!decks.length) h += '<p class="dk-empty">Aucun deck pour l\'instant. Un deck est une liste de sorts à préparer pour une situation (Combat, Exploration…).</p>';
    h += '<ul class="dk-cards">' + decks.map(function (d) {
      var cl = clsOf(e, d.classe), on = act && act.id === d.id;
      return '<li class="dk-card' + (on ? ' on' : '') + '" data-dk-id="' + esc(d.id) + '"><div class="dk-ct"><h3>' + esc(d.nom) + '</h3>' + (on ? '<span class="dk-pill">Actif</span>' : '') + '</div>' +
        '<p class="dk-meta">' + esc(d.classe) + ' · niv. ' + d.niveau + ' · ' + esc(THEME_LBL[d.theme] || '') + '</p>' + (d.note ? '<p class="dk-note">' + esc(d.note) + '</p>' : '') + '<p>' + counter(d, cl) + '</p>' +
        '<div class="dk-btns"><button type="button" class="dk-btn" data-dk-a="edit" data-dk-id="' + esc(d.id) + '">Ouvrir</button>' +
        '<button type="button" class="dk-btn' + (on ? '' : ' primary') + '" data-dk-a="equip" data-dk-id="' + esc(d.id) + '">' + (cl && cl.mode === 'known' ? 'Activer' : 'Équiper') + '</button>' +
        '<button type="button" class="dk-btn" data-dk-a="dup" data-dk-id="' + esc(d.id) + '">Dupliquer</button>' +
        (act && !on ? '<button type="button" class="dk-btn" data-dk-a="cmp" data-dk-id="' + esc(d.id) + '">Comparer avec l\'actif</button>' : '') +
        '<button type="button" class="dk-btn danger" data-dk-a="del" data-dk-id="' + esc(d.id) + '">Supprimer</button></div></li>';
    }).join('') + '</ul>';
    return h;
  }
  /* propositions et impositions du MJ (decks/m_<pid>, lecture seule pour la joueuse ; ses réponses vont dans p_.vus) */
  function mjHTML() {
    var m = S.m ? cleanM(S.m) : null, r = reponses(m, S.doc.vus), h = '', e = entry(), nm = function (id) { var x = spById(id); return esc(x ? x.n : id); };
    if (!r.propose.length && !r.impose.length) return '';
    r.impose.forEach(function (d) {
      h += '<div class="dk-banner dk-mj" role="status"><p><b>Le MJ t\'a imposé le deck « ' + esc(d.nom) + ' »</b> : il est déjà équipé sur ta fiche. Tu peux le modifier ou en changer quand tu veux.</p>' +
        '<div class="dk-btns"><button type="button" class="dk-btn" data-dk-a="seenimp" data-dk-id="' + esc(d.id) + '">Compris</button></div></div>';
    });
    if (r.propose.length) {
      h += '<section class="dk-grp dk-mj" aria-label="Propositions du MJ"><h4>Propositions du MJ</h4><ul class="dk-cards">' + r.propose.map(function (d) {
        var cl = clsOf(e, d.classe);
        return '<li class="dk-card dk-prop" data-dk-id="' + esc(d.id) + '"><div class="dk-ct"><h3>' + esc(d.nom) + '</h3><span class="dk-pill dk-pill-mj">du MJ</span></div>' +
          '<p class="dk-meta">' + esc(d.classe) + ' · ' + esc(THEME_LBL[d.theme] || '') + ' · ' + d.sorts.length + ' sort' + (d.sorts.length > 1 ? 's' : '') + '</p>' + (d.note ? '<p class="dk-note">' + esc(d.note) + '</p>' : '') +
          '<p class="dk-spells">' + d.sorts.map(nm).join(', ') + '</p>' + (cl ? '' : '<p class="dk-msg err">Cette classe n\'est pas sur ta fiche.</p>') +
          '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dk-a="accept" data-dk-id="' + esc(d.id) + '"' + (!cl || liveCount() >= LIM.decks ? ' disabled' : '') + '>Accepter (copier dans mes decks)</button>' +
          '<button type="button" class="dk-btn" data-dk-a="refuse" data-dk-id="' + esc(d.id) + '">Refuser</button></div></li>';
      }).join('') + '</ul></section>';
    }
    return h;
  }
  function answer(id, v) {
    S.doc.vus = pruneVus(S.doc.vus, cleanM(S.m)); S.doc.vus[id] = v; touchMeta();
  }
  function acceptProp(id) {
    var m = cleanM(S.m), prop = m.propose[id], e = entry(), cl = prop && clsOf(e, prop.classe), nid, d, legal, n0;
    if (!prop || !cl) { setMsg('Cette proposition ne correspond à aucune classe de ta fiche.', true); return; }
    if (liveCount() >= LIM.decks) { setMsg('Tu as déjà ' + LIM.decks + ' decks : supprime-en un avant d\'accepter.', true); return; }
    legal = function (sid) { var r = spById(sid); return !!r && r.l > 0 && cl.alw.indexOf(sid) < 0 && H.ed.ok(cl.en, r); };
    do { nid = newId(); } while (has(S.doc.decks, nid));
    d = acceptDeck(prop, nid, S.pid, Math.max(1, Math.min(20, cl.lv)), legal); n0 = prop.sorts.length - d.sorts.length;
    d.maj = now();
    S.doc.decks[nid] = d; S.dirty[nid] = 1; answer(id, 'ok'); persist(); schedule();
    setMsg('Deck « ' + d.nom + ' » ajouté à tes decks (copie : tes autres decks ne changent pas).' + (n0 ? ' ' + n0 + ' sort' + (n0 > 1 ? 's' : '') + ' écarté' + (n0 > 1 ? 's' : '') + ' (pas légal' + (n0 > 1 ? 's' : '') + ' pour ta classe ou toujours préparé' + (n0 > 1 ? 's' : '') + ').' : ''), false);
  }
  function cmpHTML() {
    var A = S.doc.decks[UI.cmpA], B = S.doc.decks[UI.cmpB], others, ds, nm, sec;
    if (!isObj(A)) return '<p class="dk-empty">Aucun deck actif à comparer.</p><div class="dk-btns"><button type="button" class="dk-btn" data-dk-a="back">← Mes decks</button></div>';
    others = liveDecks(S.doc.decks).filter(function (d) { return d.id !== A.id; });
    if (!isObj(B) || B.id === A.id) B = others[0] || null;
    if (!B) return '<p class="dk-empty">Il faut un deuxième deck pour comparer.</p><div class="dk-btns"><button type="button" class="dk-btn" data-dk-a="back">← Mes decks</button></div>';
    UI.cmpB = B.id; ds = diffSets(A.sorts, B.sorts);
    nm = function (id) { var r = spById(id); return '<li>' + esc(r ? r.n : id) + '</li>'; };
    sec = function (k, t, l) { return '<section class="dk-cmp" data-dk-cmp="' + k + '"><h4>' + t + ' <span class="muted">(' + l.length + ')</span></h4>' + (l.length ? '<ul class="dk-names">' + l.map(nm).join('') + '</ul>' : '<p class="muted">Aucun</p>') + '</section>'; };
    return '<h3 class="dk-h3">Comparer deux decks</h3><p>Deck actif : <b>' + esc(A.nom) + '</b> · ' + A.sorts.length + ' sort' + (A.sorts.length > 1 ? 's' : '') + '</p>' +
      '<label class="dk-lab">Comparer avec<select data-dk-f="cmpb">' + others.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === B.id ? ' selected' : '') + '>' + esc(d.nom) + '</option>'; }).join('') + '</select></label>' +
      sec('onlyA', 'Seulement dans « ' + esc(A.nom) + ' »', ds.onlyA) + sec('onlyB', 'Seulement dans « ' + esc(B.nom) + ' »', ds.onlyB) + sec('both', 'Dans les deux', ds.both) +
      '<div class="dk-btns dk-end"><button type="button" class="dk-btn" data-dk-a="back">← Mes decks</button></div>';
  }
  function suggBtn() { return '<button type="button" class="dk-btn" data-dk-a="sugg">Partir d\'un deck suggéré</button>'; }
  function models() { return root.TD_DECKS && Array.isArray(root.TD_DECKS.modeles) ? root.TD_DECKS.modeles : []; }
  function customModels() { var m = S.cfg && isObj(S.cfg.modeles) ? S.cfg.modeles : {}; return keys(m).map(function (k) { return m[k]; }); }
  function curPalier() {
    var best = 0;
    classesOf(entry()).forEach(function (c) { if (c.maxL >= 1 && palier(c.lv) > best) best = palier(c.lv); });
    return best;
  }
  function hasNewSuggestions() {
    return classesOf(entry()).some(function (c) { return c.maxL >= 1 && suggest(models(), customModels(), c.n, c.lv).liste.length > 0 && palier(c.lv) > S.doc.palier; });
  }
  function markSeen() { var p = curPalier(); if (p && S.doc.palier !== p) { S.doc.palier = p; touchMeta(); } }
  function bannerHTML() {
    var p = curPalier();
    if (!nouveauPalier(S.doc.palier, p) || !hasNewSuggestions()) return '';
    return '<div class="dk-banner" role="status"><p><b>Nouveaux decks suggérés</b> pour ton niveau (palier ' + PAL_LBL[p] + '). Tes decks ne changent pas : tu choisis si tu en copies un.</p><div class="dk-btns"><button type="button" class="dk-btn primary" data-dk-a="sugg">Voir</button><button type="button" class="dk-btn" data-dk-a="seen">Plus tard</button></div></div>';
  }
  function suggHTML() {
    var e = entry(), cls = classesOf(e).filter(function (c) { return c.maxL >= 1; }), cl, sg, h, by = {}, nm, mn;
    if (!cls.length) return '<p class="dk-empty">Pas de sorts à préparer à ce niveau.</p>';
    if (!UI.sc || !cls.some(function (c) { return c.n === UI.sc; })) UI.sc = cls[0].n;
    cl = clsOf(e, UI.sc); sg = suggest(models(), customModels(), cl.n, cl.lv);
    nm = function (id) { var r = spById(id); return r ? esc(r.n) : ''; };
    h = '<h3 class="dk-h3">Partir d\'un deck suggéré</h3><p class="dk-meta">' + esc(cl.n) + ' niveau ' + cl.lv + (sg.palier ? ' · palier ' + PAL_LBL[sg.palier] : '') + '</p>';
    if (cls.length > 1) h += '<div class="dk-chips" role="group" aria-label="Classe">' + cls.map(function (c) { return '<button type="button" class="dk-chip' + (c.n === UI.sc ? ' on' : '') + '" data-dk-a="sc" data-dk-c="' + esc(c.n) + '" aria-pressed="' + (c.n === UI.sc) + '">' + esc(c.n) + '</button>'; }).join('') + '</div>';
    h += '<p class="muted">Tu copies un deck, puis tu le modifies comme tu veux. Le modèle ne change jamais. ' + (cl.mode === 'known' ? 'Pour ta classe, un deck est un raccourci : les sorts que tu ne connais pas encore sont signalés « à apprendre ».' : 'Il respecte ta limite de préparation.') + '</p>';
    if (UI.msg) h += '<p class="dk-msg' + (UI.err ? ' err' : '') + '" role="status">' + esc(UI.msg) + '</p>';
    if (!sg.liste.length) h += '<p class="dk-empty">Aucun deck suggéré pour ta classe à ce niveau.</p>';
    sg.liste.forEach(function (m) { (by[m.theme] = by[m.theme] || []).push(m); });
    THEMES.forEach(function (t) {
      if (!by[t]) return;
      h += '<section class="dk-grp" aria-label="' + esc(THEME_LBL[t]) + '"><h4>' + esc(THEME_LBL[t]) + '</h4><ul class="dk-cards">' + by[t].map(function (m) {
        mn = root.TD_DECKS && root.TD_DECKS.mineurs && root.TD_DECKS.mineurs[m.classe] && root.TD_DECKS.mineurs[m.classe][m.theme];
        return '<li class="dk-card" data-dk-id="' + esc(m.id) + '"><div class="dk-ct"><h3>' + esc(m.nom) + '</h3>' + (m.mj ? '<span class="dk-pill dk-pill-mj">du MJ</span>' : '') + '</div>' +
          (m.note ? '<p class="dk-note">' + esc(m.note) + '</p>' : '') + '<p class="dk-spells">' + m.sorts.map(function (id) { return nm(id) || esc(id); }).join(', ') + '</p>' +
          (mn && cl.cant ? '<p class="dk-meta">Tours de magie conseillés : ' + mn.slice(0, cl.cant).map(nm).filter(Boolean).join(', ') + '</p>' : '') +
          '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dk-a="usemodel" data-dk-m="' + esc(m.id) + '"' + (liveCount() >= LIM.decks ? ' disabled' : '') + '>Partir de ce deck</button></div></li>';
      }).join('') + '</ul></section>';
    });
    return h + '<div class="dk-btns dk-end"><button type="button" class="dk-btn" data-dk-a="back">← Mes decks</button></div>';
  }
  function useModel(mid) {
    var e = entry(), m = null, id, d, keep;
    classesOf(e).forEach(function (c) { suggest(models(), customModels(), c.n, c.lv).liste.forEach(function (x) { if (x.id === mid && c.n === x.classe) m = x; }); });
    if (!m) return null;
    if (liveCount() >= LIM.decks) { setMsg('Tu as déjà ' + LIM.decks + ' decks : supprime-en un avant d\'en copier un.', true); return null; }
    var cl0 = clsOf(e, m.classe);
    keep = m.sorts.filter(function (x) { return !!spById(x) && cl0.alw.indexOf(x) < 0; });   /* inconnus de SP ou toujours préparés (domaine, serment) : écartés */
    do { id = newId(); } while (has(S.doc.decks, id));
    d = fromModel({ id: m.id, nom: m.nom, classe: m.classe, theme: m.theme, note: m.note, sorts: keep }, Math.max(1, Math.min(20, clsOf(e, m.classe).lv)), id, now(), S.pid);
    S.doc.decks[id] = d; S.dirty[id] = 1; persist(); schedule();
    markSeen();
    return d;
  }
  function askHTML() {
    var a = UI.ask, d = a && S.doc.decks[a.id], t = '', names;
    if (!a) return '';
    if (a.k === 'del') t = '<p><b>Supprimer « ' + esc(d ? d.nom : '') + ' » ?</b> Les sorts préparés sur ta fiche ne changent pas.</p>';
    else if (a.k === 'equip') {
      names = (a.drop || []).map(function (id) { var r = spById(id); return r ? r.n : id; });
      t = '<p><b>Équiper « ' + esc(d ? d.nom : '') + ' » ?</b></p>';
      if (a.drop && a.drop.length) t += '<p>Ce deck dépasse ta limite de préparation : <b>retire ' + a.drop.length + ' sort' + (a.drop.length > 1 ? 's' : '') + '</b> (' + esc(names.join(', ')) + '), les derniers non favoris d\'abord.</p>';
      if (a.rest) t += '<p>Tu changes tes sorts préparés <b>sans repos long</b> depuis ton dernier équipement. Le MJ doit être d\'accord.</p>';
    }
    return '<div class="dk-ask" role="alertdialog" aria-label="Confirmation">' + t + '<div class="dk-btns"><button type="button" class="dk-btn primary" data-dk-a="ok">' + (a.k === 'del' ? 'Oui, supprimer' : 'Oui, équiper') + '</button><button type="button" class="dk-btn" data-dk-a="no">Non</button></div></div>';
  }
  function warnHTML(d) {
    var w = warnings(d, spById), cl = clsOf(entry(), d.classe), h = '', nm = function (ids) { return ids.map(function (id) { var r = spById(id); return esc(r ? r.n : id); }).join(', '); };
    w.forEach(function (x) {
      var t = x.k === 'conc' ? '<b>' + x.ids.length + ' sorts de concentration</b> (' + nm(x.ids) + ') : tu ne peux en maintenir qu\'un à la fois.' :
        x.k === 'cout' ? 'Matière coûteuse : ' + nm(x.ids) + '.' : x.k === 'rituel' ? 'Rituel : ' + nm(x.ids) + '.' : x.k === 'bonus' ? 'Action bonus : ' + nm(x.ids) + '.' :
        x.k === 'reaction' ? 'Réaction : ' + nm(x.ids) + '.' : 'Sort introuvable (ignoré) : ' + esc(x.ids.join(', ')) + '.';
      h += '<li class="dk-w dk-w-' + x.k + '">' + t + '</li>';
    });
    if (cl && cl.n === 'Magicien') h += '<li class="dk-w dk-w-grimoire">Magicien : vérifie ton grimoire, les sorts préparés doivent y figurer.</li>';
    return h ? '<ul class="dk-warn" aria-label="Avertissements">' + h + '</ul>' : '';
  }
  function conseils() { return root.TD_DECKS && root.TD_DECKS.conseils || null; }
  function knownHTML(d, cl, ks) {
    var h = '', c = conseilFor(conseils(), d.classe, cl.lv);
    if (ks.aApprendre.length) h += '<p class="dk-learn"><b>' + ks.aApprendre.length + ' sort' + (ks.aApprendre.length > 1 ? 's' : '') + ' à apprendre</b> pour ce deck (montée de niveau ou remplacement de sort).</p><div class="dk-btns"><button type="button" class="dk-btn" data-dk-a="learn">Apprendre dans l\'éditeur de sorts</button></div>';
    if (ks.perdus.length) h += '<p class="dk-gonep muted">' + ks.perdus.length + ' sort' + (ks.perdus.length > 1 ? 's' : '') + ' du deck ne sont plus connus (grisés) : ils sont ignorés quand le deck filtre ta liste.</p>';
    if (c && (c.txt || c.suivant)) {
      h += '<div class="dk-advice" aria-label="Conseil de montée de niveau"><h4>Conseil de montée de niveau</h4>' + (c.txt ? '<p>' + esc(c.txt) + '</p>' : '') + (c.suivant ? '<p class="muted">Plus tard (niveau ' + c.suivant.niveau + ') : ' + esc(c.suivant.txt) + '</p>' : '') + '</div>';
    }
    return h;
  }
  function editHTML() {
    var d = S.doc.decks[UI.id], e = entry(), cl, h, byL = {}, lv, ks = { connus: [], aApprendre: [], perdus: [] };
    if (!isObj(d)) return '<p class="dk-empty">Deck introuvable.</p><div class="dk-btns"><button type="button" class="dk-btn" data-dk-a="back">Retour</button></div>';
    cl = clsOf(e, d.classe);
    if (cl && cl.mode === 'known') ks = knownOf(d);
    d.sorts.forEach(function (id) { var r = spById(id), l = r ? r.l : 0; (byL[l] = byL[l] || []).push(id); });
    h = '<h3 class="dk-h3">' + esc(d.nom) + '</h3><p class="dk-meta">' + esc(d.classe) + ' · niv. ' + d.niveau + '</p>' +
      '<p class="dk-active">' + (activeDeck() ? (activeDeck().id === d.id ? 'Ce deck est <b>actif</b>.' : 'Deck actif : <b>' + esc(activeDeck().nom) + '</b>') : 'Aucun deck actif.') + '</p>' +
      '<label class="dk-lab">Nom<input type="text" data-dk-f="nom" maxlength="' + LIM.nom + '" value="' + esc(d.nom) + '" autocomplete="off"></label>' +
      '<label class="dk-lab">Note courte<input type="text" data-dk-f="note" maxlength="' + LIM.note + '" value="' + esc(d.note || '') + '" autocomplete="off" placeholder="pour tenir la ligne"></label>' +
      '<label class="dk-lab">Thème<select data-dk-f="theme">' + themeSel(d.theme) + '</select></label>' +
      '<p>' + counter(d, cl) + '</p>';
    if (cl && cl.mode === 'prep' && d.sorts.length > cl.quota) h += '<p class="dk-over" role="status">Ce deck dépasse ta limite de ' + cl.quota + ' sorts préparés : « Équiper » te proposera de retirer les derniers non favoris.</p>';
    if (cl && cl.alw.length) h += '<p class="dk-alw muted">Toujours préparés (hors limite, pas besoin de les mettre dans un deck) : ' + cl.alw.map(function (id) { var r = spById(id); return esc(r ? r.n : id); }).join(', ') + '.</p>';
    if (UI.msg) h += '<p class="dk-msg' + (UI.err ? ' err' : '') + '" role="status">' + esc(UI.msg) + '</p>';
    if (UI.ask) h += askHTML();
    h += warnHTML(d);
    if (cl && cl.mode === 'known') h += knownHTML(d, cl, ks);
    h += '<div class="dk-btns"><button type="button" class="dk-btn" data-dk-a="addspells">+ Ajouter des sorts</button>' + (cl && cl.mode === 'known' ? '<button type="button" class="dk-btn" data-dk-a="addknown">+ Ajouter mes sorts connus</button>' : '') + (activeDeck() && activeDeck().id === d.id ? '<button type="button" class="dk-btn" data-dk-a="unequip">Désactiver</button>' : '') + (activeDeck() && activeDeck().id !== d.id ? '<button type="button" class="dk-btn" data-dk-a="cmp" data-dk-id="' + esc(d.id) + '">Comparer avec l\'actif</button>' : '') + '<button type="button" class="dk-btn primary" data-dk-a="equip" data-dk-id="' + esc(d.id) + '">' + (cl && cl.mode === 'known' ? 'Activer' : 'Équiper') + '</button></div>';
    if (!d.sorts.length) h += '<p class="dk-empty">Aucun sort dans ce deck. Utilise « Ajouter des sorts ».</p>';
    Object.keys(byL).sort(function (a, b) { return a - b; }).forEach(function (l) {
      h += '<section class="dk-grp" aria-label="Niveau ' + l + '"><h4>Niveau ' + l + '</h4><ul class="dk-list">' + byL[l].map(function (id) {
        var r = spById(id), fav = d.favoris.indexOf(id) >= 0, kn = cl && cl.mode === 'known' ? (ks.connus.indexOf(id) >= 0 ? '' : ks.aApprendre.indexOf(id) >= 0 ? 'learn' : 'gone') : '';
        return '<li class="dk-row' + (kn === 'gone' ? ' dk-gone' : '') + '" data-dk-s="' + esc(id) + '" data-dk-l="' + (r ? r.l : 0) + '"><div class="dk-rn"><b>' + esc(r ? r.n : id) + '</b>' + (r ? '<span class="dk-tags">' + tagsOf(r) + (kn === 'learn' ? '<span class="dk-tag dk-tag-learn">à apprendre</span>' : kn === 'gone' ? '<span class="dk-tag">plus connu</span>' : '') + '</span>' : '<span class="dk-tags"><span class="dk-tag">introuvable</span></span>') + '</div>' +
          '<div class="dk-ra"><button type="button" class="dk-ic" data-dk-a="fav" data-dk-s="' + esc(id) + '" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Retirer des favoris : ' : 'Marquer favori : ') + esc(r ? r.n : id) + '">' + (fav ? '★' : '☆') + '</button>' +
          '<button type="button" class="dk-ic" data-dk-a="rm" data-dk-s="' + esc(id) + '" aria-label="Retirer du deck : ' + esc(r ? r.n : id) + '">✕</button></div></li>';
      }).join('') + '</ul></section>';
    });
    h += '<div class="dk-btns dk-end"><button type="button" class="dk-btn" data-dk-a="back">← Mes decks</button></div>';
    return h;
  }

  /* sélecteur de sorts */
  function incKind(r) { var t = fold(r.t); return /bonus/.test(t) ? 'bonus' : /reaction/.test(t) ? 'reaction' : /^1 action$/.test(t) ? 'action' : 'longue'; }
  function pool(d) {
    var e = entry(), cl = clsOf(e, d.classe), M, q = fold(UI.q).trim();
    if (!cl) return [];
    M = H.ed.model(e);
    return H.sp().filter(function (r) {
      if (r.l < 1 || cl.alw.indexOf(r.e) >= 0 || !H.ed.ok(cl.en, r)) return false;
      if (UI.lv >= 0 && r.l !== UI.lv) return false;
      if (q && fold(r.n + ' ' + r.e).indexOf(q) < 0) return false;
      if (UI.sch && r.s !== UI.sch) return false;
      if (UI.conc && !r.k) return false;
      if (UI.rit && !r.q) return false;
      if (UI.inc && incKind(r) !== UI.inc) return false;
      if (cl.mode === 'known' && UI.mine && !M.mine[r.e]) return false;
      return true;
    }).sort(function (a, b) { return a.l - b.l || a.n.localeCompare(b.n, 'fr'); });
  }
  function pickRows(d) {
    var rows = pool(d), M = H.ed.model(entry()), cl = clsOf(entry(), d.classe), cap = 150, h;
    if (!rows.length) return '<li class="dk-empty">Aucun sort ne correspond.</li>';
    h = rows.slice(0, cap).map(function (r) {
      var on = d.sorts.indexOf(r.e) >= 0, learn = cl && cl.mode === 'known' && !M.mine[r.e];
      return '<li class="dk-row' + (on ? ' on' : '') + '" data-dk-s="' + esc(r.e) + '" data-dk-l="' + r.l + '" data-dk-sc="' + esc(r.s) + '"><div class="dk-rn"><b>' + esc(r.n) + '</b><span class="dk-tags">' + tagsOf(r) + (learn ? '<span class="dk-tag">à apprendre</span>' : '') + '</span></div>' +
        '<button type="button" class="dk-btn dk-pk' + (on ? ' primary' : '') + '" data-dk-a="pick" data-dk-s="' + esc(r.e) + '" aria-pressed="' + on + '">' + (on ? '✓ Dans le deck' : '+ Ajouter') + '<span class="dk-sr"> ' + esc(r.n) + '</span></button></li>';
    }).join('');
    if (rows.length > cap) h += '<li class="dk-empty">' + (rows.length - cap) + ' autres sorts : affine la recherche.</li>';
    return h;
  }
  function pickHTML() {
    var d = S.doc.decks[UI.id], cl = d && clsOf(entry(), d.classe), mx, i, h, schools = [];
    if (!isObj(d) || !cl) return '<p class="dk-empty">Deck introuvable.</p>';
    mx = cl.maxL;
    H.sp().forEach(function (r) { if (r.s && schools.indexOf(r.s) < 0) schools.push(r.s); });
    schools.sort(function (a, b) { return a.localeCompare(b, 'fr'); });
    h = '<h3 class="dk-h3">Ajouter des sorts à « ' + esc(d.nom) + ' »</h3><p>' + counter(d, cl) + '</p>' +
      '<input type="search" class="dk-q" data-dk-f="q" value="' + esc(UI.q) + '" placeholder="Chercher un sort" aria-label="Chercher un sort" autocomplete="off">' +
      '<div class="dk-chips" role="group" aria-label="Niveau"><button type="button" class="dk-chip' + (UI.lv < 0 ? ' on' : '') + '" data-dk-lv="-1" aria-pressed="' + (UI.lv < 0) + '">Tous</button>';
    for (i = 1; i <= mx; i++) h += '<button type="button" class="dk-chip' + (UI.lv === i ? ' on' : '') + '" data-dk-lv="' + i + '" aria-pressed="' + (UI.lv === i) + '">Niv. ' + i + '</button>';
    h += '</div><div class="dk-chips" role="group" aria-label="Filtres">' +
      '<button type="button" class="dk-chip' + (UI.conc ? ' on' : '') + '" data-dk-a="tog-conc" aria-pressed="' + !!UI.conc + '">Concentration</button>' +
      '<button type="button" class="dk-chip' + (UI.rit ? ' on' : '') + '" data-dk-a="tog-rit" aria-pressed="' + !!UI.rit + '">Rituel</button>' +
      (cl.mode === 'known' ? '<button type="button" class="dk-chip' + (UI.mine ? ' on' : '') + '" data-dk-a="tog-mine" aria-pressed="' + !!UI.mine + '">Mes sorts connus</button>' : '') + '</div>' +
      '<div class="dk-sel"><label>École<select data-dk-f="sch"><option value="">Toutes</option>' + schools.map(function (s) { return '<option value="' + esc(s) + '"' + (UI.sch === s ? ' selected' : '') + '>' + esc(s.charAt(0).toUpperCase() + s.slice(1)) + '</option>'; }).join('') + '</select></label>' +
      '<label>Incantation<select data-dk-f="inc">' + [['', 'Toutes'], ['action', 'Action'], ['bonus', 'Action bonus'], ['reaction', 'Réaction'], ['longue', 'Plus longue (minutes, heures)']].map(function (o) { return '<option value="' + o[0] + '"' + (UI.inc === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>';
    if (UI.msg) h += '<p class="dk-msg' + (UI.err ? ' err' : '') + '" role="status">' + esc(UI.msg) + '</p>';
    h += '<ul class="dk-list" id="dkPickList">' + pickRows(d) + '</ul><div class="dk-btns dk-end"><button type="button" class="dk-btn primary" data-dk-a="back">Terminé</button></div>';
    return h;
  }
  function fillPick() {
    var d = S.doc.decks[UI.id], ul = rootEl && rootEl.querySelector('#dkPickList'), c = rootEl && rootEl.querySelector('.dk-count');
    if (!ul || !isObj(d)) return;
    var fa = doc.activeElement, fk = fa && ul.contains(fa) && fa.getAttribute ? fa.getAttribute('data-dk-s') : '', i, nb;
    ul.innerHTML = pickRows(d);
    if (c) c.outerHTML = counter(d, clsOf(entry(), d.classe));
    if (fk) { nb = ul.querySelectorAll('[data-dk-a="pick"]'); for (i = 0; i < nb.length; i++) if (nb[i].getAttribute('data-dk-s') === fk) { try { nb[i].focus(); } catch (e) { /* ignoré */ } break; } }   /* le focus clavier ne retombe pas sur body */
  }

  /* ----- rendu et événements ----- */
  function viewHTML() {
    if (UI.view === 'edit') return editHTML();
    if (UI.view === 'pick') return pickHTML();
    if (UI.view === 'sugg') return suggHTML();
    if (UI.view === 'cmp') return cmpHTML();
    return listHTML();
  }
  function focusKey(el) {
    if (!el || !el.getAttribute) return '';
    var a = ['data-dk-a', 'data-dk-f', 'data-dk-lv'].filter(function (k) { return el.hasAttribute(k); })[0];
    if (!a) return '';
    return '[' + a + '="' + el.getAttribute(a) + '"]' + (el.hasAttribute('data-dk-s') ? '[data-dk-s="' + el.getAttribute('data-dk-s').replace(/"/g, '\\"') + '"]' : '') + (el.hasAttribute('data-dk-id') ? '[data-dk-id="' + el.getAttribute('data-dk-id') + '"]' : '');
  }
  function render() {
    if (!rootEl) return;
    var a = doc.activeElement, key = a && rootEl.contains(a) ? (a.id === 'dkTitle' ? '#dkTitle' : focusKey(a)) : '', body = rootEl.querySelector('.dk-body'), st = body ? body.scrollTop : 0, e = entry();
    rootEl.innerHTML = '<header class="dk-hd"><h2 id="dkTitle" tabindex="-1">Mes decks</h2><button type="button" class="dk-x" data-dk-a="close">Fermer</button></header>' +
      '<div class="dk-body" id="dkBody">' + (e ? viewHTML() : '<p class="dk-empty">Fiche introuvable.</p>') + '</div>';
    body = rootEl.querySelector('.dk-body'); if (body) body.scrollTop = st;
    if (key) { var n = rootEl.querySelector(key); if (n) { try { n.focus(); } catch (er) { /* ignoré */ } } }
  }
  function openUI(opener) {
    if (!available()) return;
    if (!rootEl) {
      rootEl = doc.createElement('div'); rootEl.id = 'dkRoot'; rootEl.className = 'dk'; rootEl.setAttribute('role', 'dialog'); rootEl.setAttribute('aria-modal', 'true'); rootEl.setAttribute('aria-labelledby', 'dkTitle'); rootEl.hidden = true;
      rootEl.addEventListener('click', onClick); rootEl.addEventListener('input', onInput); rootEl.addEventListener('change', onChange); rootEl.addEventListener('submit', function (ev) { ev.preventDefault(); onClick({ target: rootEl.querySelector('[data-dk-a="create"]'), preventDefault: function () {} }); });
      doc.body.appendChild(rootEl);
    }
    UI.open = true; UI.ctx = (opener && opener.getAttribute && opener.getAttribute('data-dk-open')) || 'fiche'; UI.view = 'list'; UI.id = ''; UI.ask = null; UI.form = false; UI.msg = ''; UI.err = false; UI.opener = opener || doc.activeElement;
    rootEl.hidden = false; doc.documentElement.classList.add('dk-lock');
    render();
    var t = rootEl.querySelector('#dkTitle'); if (t) { try { t.focus(); } catch (e) { /* ignoré */ } }
  }
  function closeUI() {
    if (!rootEl) return;
    UI.open = false; rootEl.hidden = true; doc.documentElement.classList.remove('dk-lock'); UI.ask = null;
    var o = UI.opener;
    if (!(o && doc.documentElement.contains(o))) o = doc.querySelector('[data-dk-open]');
    if (o) { try { o.focus(); } catch (e) { /* ignoré */ } }
    UI.opener = null;
  }
  function go(view, id) { UI.view = view; if (id != null) UI.id = id; UI.ask = null; UI.msg = ''; UI.err = false; render(); var b = rootEl.querySelector('#dkBody'); if (b) b.scrollTop = 0; var t = rootEl.querySelector('#dkTitle'); if (t) { try { t.focus(); } catch (e) { /* ignoré */ } } }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-dk-a],[data-dk-lv]') : null, a, id, sid, d;
    if (!t || t.disabled) return;
    if (ev.preventDefault) ev.preventDefault();
    if (t.hasAttribute('data-dk-lv')) { UI.lv = parseInt(t.getAttribute('data-dk-lv'), 10); render(); return; }
    a = t.getAttribute('data-dk-a'); id = t.getAttribute('data-dk-id') || UI.id; sid = t.getAttribute('data-dk-s'); d = S.doc.decks[id];
    if (a === 'close') { closeUI(); return; }
    if (a === 'new') { UI.form = true; UI.msg = ''; render(); var f = rootEl.querySelector('[data-dk-f="newname"]'); if (f) f.focus(); return; }
    if (a === 'cancelnew') { UI.form = false; render(); return; }
    if (a === 'create') {
      var nm = rootEl.querySelector('[data-dk-f="newname"]'), cs = rootEl.querySelector('[data-dk-f="newclass"]'), e = entry(), cls = classesOf(e);
      var nd = createDeck(nm ? nm.value : '', cs ? cs.value : (cls[0] && cls[0].n));
      UI.form = false;
      if (nd) { go('edit', nd.id); return; }
      render(); return;
    }
    if (a === 'edit') { go('edit', id); return; }
    if (a === 'cmp') { UI.cmpA = S.doc.actif; UI.cmpB = id; go('cmp'); return; }
    if (a === 'accept') { acceptProp(id); render(); return; }
    if (a === 'refuse') { answer(id, 'non'); setMsg('Proposition refusée.', false); render(); return; }
    if (a === 'seenimp') { answer(id, 'ok'); render(); return; }
    if (a === 'sugg') { markSeen(); UI.sc = ''; go('sugg'); return; }
    if (a === 'seen') { markSeen(); render(); return; }
    if (a === 'sc') { UI.sc = t.getAttribute('data-dk-c'); render(); return; }
    if (a === 'usemodel') { var nd2 = useModel(t.getAttribute('data-dk-m')); if (nd2) go('edit', nd2.id); else render(); return; }
    if (a === 'back') { if (UI.view === 'pick') go('edit'); else go('list'); return; }
    if (a === 'dup') { dupDeck(id); render(); return; }
    if (a === 'del') { UI.ask = { k: 'del', id: id }; render(); var no = rootEl.querySelector('[data-dk-a="no"]'); if (no) no.focus(); return; }
    if (a === 'no') { UI.ask = null; render(); return; }
    if (a === 'ok') {
      var k = UI.ask; UI.ask = null;
      if (k && k.k === 'del') { delDeck(k.id); if (UI.view !== 'list') UI.view = 'list'; setMsg('Deck supprimé.', false); }
      else if (k && k.k === 'equip') { var dd = S.doc.decks[k.id]; if (isObj(dd)) doEquip(dd, k.keep); }
      render(); return;
    }
    if (a === 'equip') { askEquip(id); render(); var ak = rootEl.querySelector('.dk-ask [data-dk-a="no"]'); if (ak) ak.focus(); return; }
    if (a === 'addspells') { UI.q = ''; UI.lv = -1; UI.sch = ''; UI.conc = false; UI.rit = false; UI.inc = ''; UI.mine = clsOf(entry(), d && d.classe) ? clsOf(entry(), d.classe).mode === 'known' : false; go('pick'); return; }
    if (a === 'addknown') { addKnown(d); render(); return; }
    if (a === 'learn') { learn(d); return; }
    if (a === 'unequip') { S.doc.actif = ''; touchMeta(); setMsg('Deck désactivé : aucun filtre sur tes sorts.', false); applyFilter(); render(); return; }
    if (a === 'tog-conc') { UI.conc = !UI.conc; render(); return; }
    if (a === 'tog-rit') { UI.rit = !UI.rit; render(); return; }
    if (a === 'tog-mine') { UI.mine = !UI.mine; render(); return; }
    d = S.doc.decks[UI.id];
    if (a === 'pick' && isObj(d)) { toggleSpell(d, sid); fillPick(); if (UI.msg) render(); return; }
    if (a === 'fav' && isObj(d)) { toggleFav(d, sid); render(); return; }
    if (a === 'rm' && isObj(d)) { toggleSpell(d, sid); render(); return; }
  }
  function onInput(ev) {
    var t = ev.target, f = t && t.getAttribute ? t.getAttribute('data-dk-f') : '', d = S.doc.decks[UI.id];
    if (f === 'q') { UI.q = t.value; fillPick(); return; }
    if (!isObj(d)) return;
    if (f === 'nom') { var n = cleanName(t.value); if (n && n !== d.nom) { d.nom = n; touch(d.id); } }
    else if (f === 'note') { var no = cleanNote(t.value); if (no !== d.note) { d.note = no; touch(d.id); } }
  }
  function onChange(ev) {
    var t = ev.target, f = t && t.getAttribute ? t.getAttribute('data-dk-f') : '', d = S.doc.decks[UI.id];
    if (f === 'sch') { UI.sch = t.value; render(); return; }
    if (f === 'inc') { UI.inc = t.value; render(); return; }
    if (f === 'cmpb') { UI.cmpB = t.value; render(); return; }
    if (!isObj(d)) return;
    if (f === 'theme' && THEMES.indexOf(t.value) >= 0 && t.value !== d.theme) { d.theme = t.value; touch(d.id); }
    if (f === 'nom' && !cleanName(t.value)) t.value = d.nom;
  }
  function onKey(ev) {
    if (!UI.open || !rootEl || rootEl.hidden) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (UI.ask) { UI.ask = null; render(); } else if (UI.view !== 'list') { if (UI.view === 'pick') go('edit'); else go('list'); } else closeUI();
      return;
    }
    if (ev.key !== 'Tab') return;
    var f = [].filter.call(rootEl.querySelectorAll('button, input, select, textarea, [tabindex="-1"]#dkTitle'), function (x) { return !x.disabled && x.getBoundingClientRect().width > 0 && x.id !== 'dkTitle'; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], cur = doc.activeElement;
    if (!rootEl.contains(cur)) { ev.preventDefault(); first.focus(); return; }
    if (ev.shiftKey && (cur === first || cur === rootEl.querySelector('#dkTitle'))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  }
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-dk-open]') : null;
    if (!t) return;
    ev.preventDefault(); openUI(t);
  });

  /* ----- pont avec app.js ----- */
  api.bind = function (h) { H = h; };
  api.attach = function (db) { DB = db; startCfg(); if (!started) { started = true; } sync(); };
  api.onEntry = function () { try { sync(); paintBar(); } catch (e) { /* ignoré */ } };
  api.btnHTML = btnHTML; api.only = only; api.deckView = deckView; api.setFilter = setFilter; api.rank = rank;
  api.onCfg = [];
  api.open = function () { openUI(null); };
  api._state = function () { return { S: S, UI: UI }; };
  /* interne : partagé avec decks-mj.js (vue MJ) */
  api.x = { H: function () { return H; }, DB: function () { return DB; }, S: S, esc: esc, now: now, role: role, spById: spById, classesOf: classesOf, clsOf: clsOf, models: models, customModels: customModels, tagsOf: tagsOf, legalIds: legalIds, themeSel: themeSel, sheetEquip: sheetEquip, counter: counter, warnHTML: warnHTML };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' && globalThis.document ? globalThis : null));
