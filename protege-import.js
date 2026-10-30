/* Import MJ des contenus protégés et des secrets du MJ (aucun contenu dans ce fichier).
   Après connexion en MJ (import.html de préférence) : console du navigateur (F12), taper  tylImporterProtege()
   (ou tylImporterSecrets(), identique) puis choisir protege/mi.json, protege/clp.json et/ou protege/secrets-mj.json
   (sélection multiple). Écrit via le shim (aucune clé service_role) :
     mi.json         -> protected/mi      (lisible par les membres)
     clp.json        -> protected/clp     (lisible par les membres)
     secrets-mj.json -> campaign/secrets  (lisible par le MJ SEUL : collection campaign, RLS)
   Recharger la page ensuite. Refusé par la RLS si le compte n'est pas MJ. Messages en console uniquement (aucun HTML). */
(function () {
  'use strict';
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return v !== null && typeof v === 'object' && !isArr(v); }
  function items(d, nom) {
    if (!isObj(d) || !isArr(d.items) || !d.items.length) throw new Error(nom + ' : format inattendu (items[] vide)');
    return d.items.length + ' éléments';
  }
  function secrets(d, nom) {
    if (!isObj(d) || !isObj(d.cpd) || !isArr(d.cpd.missions) || !d.cpd.missions.length) throw new Error(nom + ' : format inattendu (cpd.missions[] attendu)');
    if (d.tpl !== undefined && !isArr(d.tpl)) throw new Error(nom + ' : format inattendu (tpl doit être une liste)');
    if (d.ui !== undefined && !isObj(d.ui)) throw new Error(nom + ' : format inattendu (ui doit être un objet)');
    return d.cpd.missions.length + ' missions, ' + (d.tpl ? d.tpl.length : 0) + ' modèles de carte';
  }
  var NOMS = {
    'mi.json': { path: 'protected/mi', check: items },
    'clp.json': { path: 'protected/clp', check: items },
    'secrets-mj.json': { path: 'campaign/secrets', check: secrets }
  };
  function lire(f) {
    return new Promise(function (ok, ko) {
      var r = new FileReader();
      r.onload = function () { try { ok(JSON.parse(String(r.result))); } catch (e) { ko(new Error(f.name + ' : JSON invalide')); } };
      r.onerror = function () { ko(new Error(f.name + ' : lecture impossible')); };
      r.readAsText(f);
    });
  }
  function envoyer(db, files) {
    var jobs = [];
    Array.prototype.forEach.call(files, function (f) {
      var cible = NOMS[f.name];
      if (!cible) { console.warn('ignoré : ' + f.name + ' (attendu : mi.json, clp.json ou secrets-mj.json)'); return; }
      jobs.push(lire(f).then(function (d) {
        var resume = cible.check(d, f.name);
        return db.doc(cible.path).set(d).then(function () { console.log('OK ' + cible.path + ' (' + resume + ')'); return cible.path; });
      }));
    });
    return Promise.all(jobs);
  }
  function importer() {
    if (!window.claude || !window.claude.use) { console.error('Plateforme absente : connecte-toi d\'abord.'); return; }
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json'; inp.multiple = true; inp.style.display = 'none';
    inp.addEventListener('change', function () {
      Promise.resolve(window.claude.use('db')).then(function (db) {
        if (!db) throw new Error('Pas de connexion à la base.');
        return envoyer(db, inp.files);
      }).then(function (r) { console.log('Import terminé (' + r.length + ' doc). Recharge la page.'); },
        function (e) { console.error('Import échoué : ' + (e && e.code === 'invalid_argument' ? 'refusé (compte MJ requis, migrations appliquées ?)' : (e && e.message) || e)); })
        .then(function () { if (inp.parentNode) inp.parentNode.removeChild(inp); });
    });
    document.body.appendChild(inp); inp.click();
  }
  window.tylImporterProtege = importer;
  window.tylImporterSecrets = importer;
})();
