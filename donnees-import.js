/* Import MJ des données de l'ancienne plateforme (T4). Aucune donnée dans ce fichier.
   À lancer depuis import.html (page SANS la table de combat : ses abonnements exécuteraient les actions,
   réécriraient le combat ou supprimeraient des récits pendant l'import, revue I7).
   Après connexion en MJ : console du navigateur (F12) -> tylImporterDonnees(), puis choisir export.json
   (et, si possible, manifest.json) en sélection multiple. Écrit chaque document en 'set' par lots de 10
   via le shim (aucune clé service_role). Idempotent : un document déjà identique est ignoré ; un document
   présent mais différent n'est écrasé qu'après confirmation. Ne supprime JAMAIS rien.
   Collections transitoires (actions, sync) : ignorées avec un avertissement. journal est écrit avant story.
   Vérification finale : relecture de chaque collection et comparaison des empreintes (sha256 du JSON canonique). */
(function () {
  'use strict';
  var COLLS = ['combat', 'players', 'library', 'items', 'spells', 'mgifts', 'story', 'journal', 'notes',
    'session', 'campaign', 'assign', 'audio', 'tracks', 'playlists', 'rules'];
  var TRANSITOIRES = ['actions', 'sync']; /* actions en attente / horloge audio : jamais rejouées */
  /* Ordre d'écriture : journal avant story (story est la vue publiée du journal). */
  function ordre(a, b) {
    var pa = a === 'journal' ? 0 : a === 'story' ? 1 : 2, pb = b === 'journal' ? 0 : b === 'story' ? 1 : 2;
    return pa - pb || (a < b ? -1 : a > b ? 1 : 0);
  }
  var BATCH = 10, MAXDOC = 6000000, SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function isObj(v) { return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]'; }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* JSON canonique : clés triées récursivement. */
  function canon(v) {
    var i, ks, out;
    if (Object.prototype.toString.call(v) === '[object Array]') { out = []; for (i = 0; i < v.length; i++) out.push(canon(v[i])); return '[' + out.join(',') + ']'; }
    if (isObj(v)) { ks = Object.keys(v).sort(); out = []; for (i = 0; i < ks.length; i++) out.push(JSON.stringify(ks[i]) + ':' + canon(v[ks[i]])); return '{' + out.join(',') + '}'; }
    return JSON.stringify(v);
  }
  /* Taille de data::text côté jsonb (espace après ':' et ','), clés triées longueur puis octets. */
  function jtext(v) {
    var i, ks, out;
    if (Object.prototype.toString.call(v) === '[object Array]') { out = []; for (i = 0; i < v.length; i++) out.push(jtext(v[i])); return '[' + out.join(', ') + ']'; }
    if (isObj(v)) {
      ks = Object.keys(v).sort(function (a, b) { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0); }); out = [];
      for (i = 0; i < ks.length; i++) out.push(JSON.stringify(ks[i]) + ': ' + jtext(v[ks[i]]));
      return '{' + out.join(', ') + '}';
    }
    return JSON.stringify(v);
  }
  function utf8(s) {
    var b = [], i, c, d;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) { d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; } }
      if (c < 0x80) b.push(c);
      else if (c < 0x800) b.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) b.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else b.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return b;
  }
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(str) {
    var b = utf8(str), n = b.length, h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64), i, j, bl, a, e, t1, t2, s0, s1, v, hex = '';
    b.push(0x80); while (b.length % 64 !== 56) b.push(0);
    bl = n * 8; for (i = 7; i >= 0; i--) b.push(i > 3 ? 0 : (bl >>> (i * 8)) & 255);
    function rr(x, k) { return (x >>> k) | (x << (32 - k)); }
    for (i = 0; i < b.length; i += 64) {
      for (j = 0; j < 16; j++) w[j] = ((b[i + j * 4] << 24) | (b[i + j * 4 + 1] << 16) | (b[i + j * 4 + 2] << 8) | b[i + j * 4 + 3]) | 0;
      for (j = 16; j < 64; j++) {
        s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      v = h.slice();
      for (j = 0; j < 64; j++) {
        s1 = rr(v[4], 6) ^ rr(v[4], 11) ^ rr(v[4], 25); a = (v[4] & v[5]) ^ (~v[4] & v[6]);
        t1 = (v[7] + s1 + a + K[j] + w[j]) | 0;
        s0 = rr(v[0], 2) ^ rr(v[0], 13) ^ rr(v[0], 22); e = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
        t2 = (s0 + e) | 0;
        v = [(t1 + t2) | 0, v[0], v[1], v[2], (v[3] + t1) | 0, v[4], v[5], v[6]];
      }
      for (j = 0; j < 8; j++) h[j] = (h[j] + v[j]) | 0;
    }
    for (i = 0; i < 8; i++) hex += ('00000000' + (h[i] >>> 0).toString(16)).slice(-8);
    return hex;
  }
  function empreinte(d) { return sha256(canon(d)); }

  /* Validation du fichier. Structure invalide : err (rien n est écrit). Doc invalide : erreurs[] (les autres passent). */
  function analyser(texteExport, texteManifest) {
    var exp, man = null, docs = [], erreurs = [], warns = [], c, id, i, col, d, fp, mdoc, mc;
    try { exp = JSON.parse(texteExport); } catch (e) { return { err: 'export.json : JSON invalide' }; }
    if (!isObj(exp)) return { err: 'export.json : un objet { collection: { id: doc } } est attendu' };
    if (texteManifest) {
      try { man = JSON.parse(texteManifest); } catch (e2) { return { err: 'manifest.json : JSON invalide' }; }
      if (!isObj(man) || !isObj(man.collections)) return { err: 'manifest.json : format inattendu (collections manquant)' };
    }
    var cols = Object.keys(exp);
    if (!cols.length) return { err: 'export.json : aucune collection' };
    for (c = 0; c < cols.length; c++) {
      col = cols[c];
      if (TRANSITOIRES.indexOf(col) >= 0) continue;
      if (COLLS.indexOf(col) < 0) return { err: 'export.json : collection inconnue ou non autorisée « ' + col + ' »' };
      if (!isObj(exp[col])) return { err: 'export.json : la collection « ' + col + ' » doit être un objet { id: doc }' };
    }
    for (c = 0; c < cols.length; c++) {
      col = cols[c];
      if (TRANSITOIRES.indexOf(col) >= 0) {
        if (isObj(exp[col]) && Object.keys(exp[col]).length) warns.push(col + ' : collection transitoire ignorée (' + Object.keys(exp[col]).length + ' doc.)');
        continue;
      }
      var ids = Object.keys(exp[col]).sort();
      for (i = 0; i < ids.length; i++) {
        id = ids[i]; d = exp[col][id];
        if (!SEG_RE.test(id) || id === '.' || id === '..' || id.length > 200) { erreurs.push({ col: col, id: id, msg: 'id invalide' }); continue; }
        if (!isObj(d)) { erreurs.push({ col: col, id: id, msg: 'le document doit être un objet' }); continue; }
        if (utf8(jtext(d)).length > MAXDOC) { erreurs.push({ col: col, id: id, msg: 'document > 6 Mo (limite de la base)' }); continue; }
        if (canon(d).indexOf('\\u0000') >= 0) { erreurs.push({ col: col, id: id, msg: 'contient \\u0000 (refusé par jsonb)' }); continue; }
        fp = empreinte(d);
        if (man) {
          mc = man.collections[col]; mdoc = mc && mc.docs && mc.docs[id];
          if (!mdoc) warns.push(col + '/' + id + ' : absent du manifest');
          else if (mdoc.sha256 !== fp) return { err: 'Le fichier ne correspond pas au manifest (' + col + '/' + id + ' : empreinte différente). Fichier abîmé ou mauvais couple export/manifest : rien n\'a été écrit.' };
        }
        docs.push({ col: col, id: id, data: d, fp: fp });
      }
    }
    if (man) {
      Object.keys(man.collections).forEach(function (mcn) {
        if (TRANSITOIRES.indexOf(mcn) >= 0) return;
        var md = (man.collections[mcn] && man.collections[mcn].docs) || {};
        Object.keys(md).forEach(function (mid) { if (!isObj(exp[mcn]) || !hasOwn(exp[mcn], mid)) warns.push(mcn + '/' + mid + ' : dans le manifest mais absent du fichier'); });
      });
    }
    return { docs: docs, erreurs: erreurs, warns: warns, manifest: !!man };
  }

  function lireCollection(db, col) {
    return Promise.resolve(db.collection(col).get()).then(function (snap) {
      var m = {};
      (snap.docs || []).forEach(function (s) { var x = s.data(); if (x !== undefined) m[s.id] = empreinte(x); });
      return m;
    });
  }
  function seq(items, fn) {
    var p = Promise.resolve(), i;
    for (i = 0; i < items.length; i++) (function (it) { p = p.then(function () { return fn(it); }); })(items[i]);
    return p;
  }
  function parLots(liste, taille) { var r = [], i; for (i = 0; i < liste.length; i += taille) r.push(liste.slice(i, i + taille)); return r; }
  function msgErr(e) { return (e && e.message) ? (e.code ? e.code + ' : ' : '') + e.message : String(e); }

  /* Cœur : écrit puis vérifie. opts : { ecraser: bool, progress: fn(txt) }. Résout un rapport (ne rejette pas sur erreur de doc). */
  function executer(db, analyse, opts) {
    opts = opts || {};
    var rap = { ecrits: 0, ignores: 0, divergents: [], erreurs: analyse.erreurs.slice(), parCol: {}, avertissements: analyse.warns.slice(),
      verif: { ok: 0, manquants: [], differents: [], extras: [], illisibles: [] } };
    var parCol = {}, base = {};
    analyse.docs.forEach(function (x) { (parCol[x.col] = parCol[x.col] || []).push(x); });
    var cols = Object.keys(parCol).sort(ordre);
    function prog(t) { if (opts.progress) opts.progress(t); }
    cols.forEach(function (c) { rap.parCol[c] = { total: parCol[c].length, ecrits: 0, ignores: 0, erreurs: 0 }; });
    analyse.erreurs.forEach(function (x) { if (rap.parCol[x.col]) rap.parCol[x.col].erreurs++; });

    return seq(cols, function (c) {
      prog('Lecture de « ' + c + ' »…');
      return lireCollection(db, c).then(function (m) { base[c] = m; }, function (e) {
        base[c] = null; rap.erreurs.push({ col: c, id: '*', msg: 'lecture impossible : ' + msgErr(e) });
      });
    }).then(function () {
      var aEcrire = [];
      cols.forEach(function (c) {
        if (base[c] === null) return; /* lecture impossible : on n'écrit pas à l'aveugle */
        parCol[c].forEach(function (x) {
          if (!hasOwn(base[c], x.id)) aEcrire.push(x);
          else if (base[c][x.id] === x.fp) { rap.ignores++; rap.parCol[c].ignores++; }
          else {
            rap.divergents.push(c + '/' + x.id);
            if (opts.ecraser) aEcrire.push(x); else { rap.ignores++; rap.parCol[c].ignores++; }
          }
        });
      });
      var lots = parLots(aEcrire, BATCH), fait = 0;
      return seq(lots, function (lot) {
        return Promise.all(lot.map(function (x) {
          var p;
          try { p = Promise.resolve(db.doc(x.col + '/' + x.id).set(x.data)); } catch (e) { p = Promise.reject(e); }
          return p.then(function () { rap.ecrits++; rap.parCol[x.col].ecrits++; }, function (e) {
            rap.erreurs.push({ col: x.col, id: x.id, msg: msgErr(e) }); rap.parCol[x.col].erreurs++;
          });
        })).then(function () { fait += lot.length; prog('Écriture : ' + fait + ' / ' + aEcrire.length); });
      });
    }).then(function () {
      return seq(cols, function (c) {
        prog('Vérification de « ' + c + ' »…');
        return lireCollection(db, c).then(function (m) {
          var voulu = {};
          parCol[c].forEach(function (x) {
            voulu[x.id] = 1;
            if (!hasOwn(m, x.id)) rap.verif.manquants.push(c + '/' + x.id);
            else if (m[x.id] !== x.fp) rap.verif.differents.push(c + '/' + x.id);
            else rap.verif.ok++;
          });
          Object.keys(m).forEach(function (id) { if (!voulu[id]) rap.verif.extras.push(c + '/' + id); });
        }, function (e) { rap.verif.illisibles.push(c + ' : ' + msgErr(e)); });
      });
    }).then(function () {
      var v = rap.verif;
      rap.conforme = !rap.erreurs.length && !v.manquants.length && !v.differents.length && !v.illisibles.length;
      return rap;
    });
  }

  function traiter(db, textes, opts) {
    var a = analyser(textes.export, textes.manifest || null);
    if (a.err) return Promise.resolve({ invalide: a.err });
    return executer(db, a, opts);
  }

  /* ---------- Interface ---------- */
  function liste(titre, arr, max) {
    if (!arr.length) return '';
    var h = '<p><b>' + esc(titre) + ' (' + arr.length + ')</b></p><ul>', i;
    for (i = 0; i < arr.length && i < max; i++) h += '<li>' + esc(typeof arr[i] === 'string' ? arr[i] : arr[i].col + '/' + arr[i].id + ' : ' + arr[i].msg) + '</li>';
    if (arr.length > max) h += '<li>… et ' + esc(arr.length - max) + ' autres</li>';
    return h + '</ul>';
  }
  function rapportHtml(r) {
    if (r.invalide) return '<p><b>Fichier refusé, rien n\'a été écrit.</b></p><p>' + esc(r.invalide) + '</p>';
    var v = r.verif, h = '<p><b>' + (r.conforme ? 'Import conforme.' : 'Import terminé avec des écarts.') + '</b></p>';
    h += '<p>Documents écrits : ' + esc(r.ecrits) + ' · ignorés (déjà identiques ou non écrasés) : ' + esc(r.ignores) + ' · erreurs : ' + esc(r.erreurs.length) + '</p>';
    h += '<p>Vérification : ' + esc(v.ok) + ' identiques · ' + esc(v.manquants.length) + ' manquants · ' + esc(v.differents.length) + ' différents · ' + esc(v.extras.length) + ' en base hors fichier (conservés)</p>';
    h += '<table><tr><th>Collection</th><th>Total</th><th>Écrits</th><th>Ignorés</th><th>Erreurs</th></tr>';
    Object.keys(r.parCol).sort().forEach(function (c) {
      var x = r.parCol[c]; h += '<tr><td>' + esc(c) + '</td><td>' + esc(x.total) + '</td><td>' + esc(x.ecrits) + '</td><td>' + esc(x.ignores) + '</td><td>' + esc(x.erreurs) + '</td></tr>';
    });
    h += '</table>' + liste('Erreurs', r.erreurs, 50) + liste('Manquants en base', v.manquants, 50) + liste('Différents en base', v.differents, 50) +
      liste('Divergents à l\'import', r.divergents, 50) + liste('Collections illisibles', v.illisibles, 20) + liste('Avertissements', r.avertissements, 20) +
      liste('En base hors fichier', v.extras, 20);
    return h;
  }
  function panneau() {
    var old = document.getElementById ? document.getElementById('tyl-import-donnees') : null;
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var p = document.createElement('div');
    p.id = 'tyl-import-donnees';
    p.setAttribute('role', 'dialog');
    p.style.cssText = 'position:fixed;inset:5% 10%;background:#fff;color:#111;border:2px solid #3c6b4f;border-radius:8px;padding:16px;overflow:auto;z-index:99999;font:14px/1.4 sans-serif';
    var t = document.createElement('h3'); t.textContent = 'Import des données';
    var corps = document.createElement('div'); corps.innerHTML = '<p>En attente du fichier…</p>';
    var b = document.createElement('button'); b.textContent = 'Fermer';
    b.addEventListener('click', function () { if (p.parentNode) p.parentNode.removeChild(p); });
    p.appendChild(t); p.appendChild(corps); p.appendChild(b); document.body.appendChild(p);
    return { set: function (h) { corps.innerHTML = h; } };
  }
  function lireFichier(f) {
    return new Promise(function (ok, ko) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result)); };
      r.onerror = function () { ko(new Error(f.name + ' : lecture impossible')); };
      r.readAsText(f);
    });
  }
  function choisir(db, files, ui) {
    var fe = null, fm = null, i, n;
    for (i = 0; i < files.length; i++) {
      n = String(files[i].name || '');
      if (/manifest\.json$/i.test(n)) fm = files[i]; else if (/export\.json$/i.test(n)) fe = files[i];
    }
    if (!fe) { ui.set(rapportHtml({ invalide: 'Aucun fichier export.json dans la sélection (manifest.json facultatif).' })); return Promise.resolve(null); }
    return Promise.all([lireFichier(fe), fm ? lireFichier(fm) : Promise.resolve(null)]).then(function (tx) {
      var a = analyser(tx[0], tx[1]);
      if (a.err) { ui.set(rapportHtml({ invalide: a.err })); return null; }
      var ecraser = false;
      return lireDivergents(db, a).then(function (div) {
        if (div.length && typeof window.confirm === 'function') {
          ecraser = window.confirm(div.length + ' document(s) existent déjà en base avec un contenu différent du fichier (ex. ' + div.slice(0, 3).join(', ') + ').\nOK = les écraser par la version du fichier.\nAnnuler = les laisser tels quels.');
        }
        ui.set('<p>Import en cours…</p>');
        return executer(db, a, { ecraser: ecraser, progress: function (t) { ui.set('<p>' + esc(t) + '</p>'); } });
      }).then(function (r) { ui.set(rapportHtml(r)); return r; });
    }).then(null, function (e) { ui.set('<p><b>Import interrompu.</b> ' + esc(msgErr(e)) + '</p>'); return null; });
  }
  function lireDivergents(db, a) {
    var cols = {}, div = [];
    a.docs.forEach(function (x) { cols[x.col] = 1; });
    return seq(Object.keys(cols), function (c) {
      return lireCollection(db, c).then(function (m) {
        a.docs.forEach(function (x) { if (x.col === c && hasOwn(m, x.id) && m[x.id] !== x.fp) div.push(c + '/' + x.id); });
      }, function () { /* lecture impossible : signalée par executer */ });
    }).then(function () { return div; });
  }
  function tylImporterDonnees() {
    if (!window.claude || !window.claude.use) { console.error('Plateforme absente : connecte-toi d\'abord.'); return; }
    var ui = panneau();
    if (window.__tylImportPage !== true) {
      ui.set('<p><b>Impossible ici.</b> Ouvre import.html (même adresse que le site, page sans la table de combat), connecte-toi en MJ, puis relance tylImporterDonnees().</p>');
      return;
    }
    /* Sélecteur ouvert dans le même appel que la commande (sinon le navigateur peut le bloquer, revue M13) ;
       le rôle MJ est vérifié une fois les fichiers choisis. */
    ui.set('<p>Choisis export.json (et manifest.json si tu l\'as).</p>');
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json'; inp.multiple = true; inp.style.display = 'none';
    inp.addEventListener('change', function () {
      var files = inp.files;
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      Promise.all([Promise.resolve(window.claude.use('db')), Promise.resolve(window.claude.use('user'))]).then(function (r) {
        var db = r[0], u = r[1];
        if (!db || !u) throw new Error('Pas de connexion à la base.');
        return Promise.resolve(u.isOwner()).then(function (mj) {
          if (!mj) throw new Error('Import réservé au compte MJ.');
          return choisir(db, files, ui);
        });
      }).then(null, function (e) { ui.set('<p><b>Impossible.</b> ' + esc(msgErr(e)) + '</p>'); });
    });
    document.body.appendChild(inp); inp.click();
  }
  tylImporterDonnees.analyser = analyser;
  tylImporterDonnees.traiter = traiter;
  tylImporterDonnees.empreinte = empreinte;
  tylImporterDonnees.choisir = choisir;
  tylImporterDonnees.panneau = panneau;
  window.tylImporterDonnees = tylImporterDonnees;
})();
