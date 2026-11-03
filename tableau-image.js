/* tableau-image.js : images du tableau (lecture du CONTENU, refus du SVG, réduction, ré-encodage canvas, envoi au bucket). ES5, sans bibliothèque.
   Chargé à la demande par tableau.js. Aucune écriture en base : seul assets.upload (réservé au MJ par le bucket). */
(function (root) {
  'use strict';
  var M = root.tylBoardModel, doc = root.document;
  if (!M || !doc) return;
  var LIM = M.LIM, IMG_TRIES = M.IMG_TRIES, sniffType = M.sniffType, fitSize = M.fitSize, imgVerdict = M.imgVerdict;
  var TOO_BIG = 'Image refusée : dimensions trop grandes (40 mégapixels et 12 000 px de côté au plus).';
  var TOK_TRIES = [{ q: 0.82, side: 256 }, { q: 0.7, side: 256 }, { q: 0.5, side: 200 }];
  function readHead(file) {
    return new Promise(function (res, rej) {
      var fr = new root.FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); }; fr.onerror = function () { rej(new Error('lecture')); };
      fr.readAsArrayBuffer(file.slice(0, 262144));   /* en-tête : type + dimensions (JPEG : marqueur SOF) */
    });
  }
  function decode(file) {
    return new Promise(function (res, rej) {
      var u = root.URL.createObjectURL(file), im = new root.Image();
      im.onload = function () { root.URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { root.URL.revokeObjectURL(u); rej(new Error('décodage')); };
      im.src = u;
    });
  }
  function toBlob(cv, type, q) { return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, type, q); }); }
  function hasAlpha(cv) {
    try { var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, i; for (i = 3; i < d.length; i += 4) if (d[i] < 250) return true; } catch (e) { return false; }
    return false;
  }
  function encode(im, tries) {
    var best = null, i = 0, alpha = false, nat = { w: im.naturalWidth || im.width, h: im.naturalHeight || im.height }, TR = tries || IMG_TRIES;
    function tryOne() {
      var t = TR[i], sz = fitSize(nat.w, nat.h, t.side), cv = doc.createElement('canvas'), g;
      cv.width = sz.w; cv.height = sz.h; g = cv.getContext('2d');
      if (i === 0) { g.drawImage(im, 0, 0, sz.w, sz.h); alpha = hasAlpha(cv); }
      if (!alpha) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, sz.w, sz.h); }
      g.drawImage(im, 0, 0, sz.w, sz.h);
      return toBlob(cv, alpha ? 'image/webp' : 'image/jpeg', t.q).then(function (b) {
        cv.width = cv.height = 0;   /* libère la mémoire du canvas d'essai (iOS : plafond de mémoire canvas) */
        if (!b) throw new Error('encodage');
        if (!best || b.size < best.size) best = b;
        i++;
        if (b.size <= (tries ? LIM.tokImg : LIM.imgTarget) || i >= TR.length) return { blob: best, w: sz.w, h: sz.h, nat: nat };
        return tryOne();
      });
    }
    return tryOne();
  }
  /* Lit le contenu, refuse SVG et faux fichiers, réduit, envoie au bucket : { id, w, h, size }. small = jeton (256 px, 60 Ko). */
  function prepare(file, small, assets) {
    if (file.size > 30 * 1024 * 1024) return Promise.reject(new Error('Fichier trop gros (30 Mo maximum).'));
    return readHead(file).then(function (head) {
      var ty = sniffType(head);
      if (ty === 'svg') throw new Error('SVG non accepté : exporte-le en PNG ou JPEG.');
      if (!ty) throw new Error('Ce fichier n\'est pas une image reconnue (PNG, JPEG, WebP, GIF ou AVIF).');
      var d = M.imgDims(head);   /* dimensions lues dans l'en-tête : une « bombe de décompression » est refusée AVANT tout décodage */
      if (d && M.imgTooBig(d.w, d.h)) throw new Error(TOO_BIG);
      return decode(file);
    }).then(function (im) {
      if (M.imgTooBig(im.naturalWidth || im.width || 0, im.naturalHeight || im.height || 0)) throw new Error(TOO_BIG);   /* formats sans dimensions lisibles en tête (AVIF…) */
      return encode(im, small ? TOK_TRIES : null);
    }).then(function (r) {
      if (small ? r.blob.size > LIM.tokImg : imgVerdict(r.blob.size) === 'refuse') throw new Error(small ? 'Image de jeton trop lourde (plus de 60 Ko) : choisis une image plus simple.' : 'Image trop lourde même réduite (plus de 800 Ko) : choisis une image plus simple.');
      return Promise.resolve(assets.upload(r.blob)).then(function (up) {
        var id = up && up.id ? String(up.id) : '';
        if (!/^[\w-]{4,64}$/.test(id)) throw new Error('Envoi refusé.');
        return { id: id, w: r.w, h: r.h, size: r.blob.size };
      });
    });
  }
  function error(e) {
    var m = e && e.message ? String(e.message) : 'Image refusée.';
    return /^(SVG|Ce fichier|Image |Envoi|Fichier)/.test(m) ? m : 'Image refusée ou illisible (' + m.slice(0, 60) + ').';
  }
  /* Collage : fichier image d'un évènement « paste », ou lecture du presse-papiers (bouton). */
  function pasted(ev) {
    var cd = ev.clipboardData, f = null, i;
    if (cd && cd.files && cd.files.length) f = cd.files[0];
    else if (cd && cd.items) for (i = 0; i < cd.items.length; i++) if (cd.items[i].kind === 'file') { f = cd.items[i].getAsFile(); break; }
    return f;
  }
  function clip(add, msg) {
    try {
      root.navigator.clipboard.read().then(function (items) {
        var i, j, it, ty;
        for (i = 0; i < items.length; i++) { it = items[i]; for (j = 0; j < it.types.length; j++) { ty = it.types[j]; if (/^image\//.test(ty)) { it.getType(ty).then(function (b) { add(b); }); return; } } }
        msg('Aucune image dans le presse-papiers.', true);
      }, function () { msg('Presse-papiers non autorisé : utilise Ctrl+V.', true); });
    } catch (e) { msg('Presse-papiers indisponible.', true); }
  }
  root.tylBoardImg = { prepare: prepare, error: error, pasted: pasted, clip: clip };
})(typeof window !== 'undefined' ? window : this);
