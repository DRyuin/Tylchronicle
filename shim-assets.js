/* shim-assets.js : remplace le capability assets par Supabase Storage (bucket public « assets »).
   Usage : var assets = window.__tylAssets(supabaseClient, ctx); */
(function () {
  var BUCKET = 'assets';
  var MAX = 20 * 1024 * 1024;

  function mkErr(code, msg, orig) {
    var e = new Error(msg || code);
    e.code = code;
    if (orig) { e.cause = orig; }
    return e;
  }

  function mapErr(err) {
    var m = String((err && (err.message || err.error)) || '').toLowerCase();
    var st = String((err && (err.statusCode || err.status)) || '');
    if (st === '413' || m.indexOf('exceeded the maximum') >= 0 || m.indexOf('too large') >= 0 || m.indexOf('payload') >= 0) {
      return mkErr('resource_exhausted', 'fichier trop gros', err);
    }
    if (st === '400' || st === '401' || st === '403' || st === '404' || m.indexOf('row-level security') >= 0 ||
        m.indexOf('violates') >= 0 || m.indexOf('unauthorized') >= 0 || m.indexOf('mime') >= 0 || m.indexOf('not allowed') >= 0) {
      return mkErr('invalid_argument', (err && err.message) || 'refusé', err);
    }
    return mkErr('upstream_error', (err && err.message) || 'erreur de stockage', err);
  }

  function newId() {
    var a = new Uint8Array(16), s = '', i, h;
    var c = (typeof crypto !== 'undefined') ? crypto : (typeof self !== 'undefined' ? self.crypto : null);
    if (!c || !c.getRandomValues) { throw mkErr('upstream_error', 'crypto indisponible'); }
    c.getRandomValues(a);
    for (i = 0; i < a.length; i++) { h = a[i].toString(16); s += (h.length < 2 ? '0' : '') + h; }
    return s;
  }

  function idOf(ref) {
    var s = String(ref == null ? '' : ref);
    var k = s.lastIndexOf('/');
    if (k >= 0) { s = s.slice(k + 1); }
    if (!/^[\w-]{4,64}$/.test(s)) { throw mkErr('invalid_argument', 'identifiant invalide'); }
    return s;
  }

  window.__tylAssets = function (client, ctx) {
    function bucket() { return client.storage.from(BUCKET); }

    function upload(blob, options) {
      var id, type;
      try {
        if (!blob || typeof blob.size !== 'number') { throw mkErr('invalid_argument', 'blob attendu'); }
        if (blob.size < 1) { throw mkErr('invalid_argument', 'fichier vide'); }
        if (blob.size > MAX) { throw mkErr('resource_exhausted', 'fichier trop gros (20 Mo max)'); }
        type = (options && options.type) || blob.type || 'application/octet-stream';
        id = newId();
      } catch (e0) { return Promise.reject(e0); }
      var p;
      try { p = bucket().upload(id, blob, { contentType: type, upsert: false }); } catch (e1) { return Promise.reject(mapErr(e1)); }
      return Promise.resolve(p).then(function (r) {
        if (r && r.error) { throw mapErr(r.error); }
        return { id: id, url: (window.TYL_BLOB || '/_blob/') + id, sizeBytes: blob.size, contentType: type };
      }, function (e) { throw (e && e.code ? e : mapErr(e)); });
    }

    function list() {
      var p;
      try { p = bucket().list('', { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } }); } catch (e1) { return Promise.reject(mapErr(e1)); }
      return Promise.resolve(p).then(function (r) {
        if (r && r.error) { throw mapErr(r.error); }
        var rows = (r && r.data) || [], assets = [], total = 0, i, o, md, sz;
        for (i = 0; i < rows.length; i++) {
          o = rows[i];
          if (!o || !o.name || o.id === null) { continue; } /* dossiers : id null */
          md = o.metadata || {};
          sz = +md.size || 0;
          total += sz;
          assets.push({ id: o.name, url: (window.TYL_BLOB || '/_blob/') + o.name, sizeBytes: sz, contentType: md.mimetype || '', createdAt: o.created_at || '' });
        }
        return { assets: assets, usage: { files: assets.length, bytes: total, maxFiles: 100000, maxBytes: 1073741824 } };
      }, function (e) { throw (e && e.code ? e : mapErr(e)); });
    }

    function del(ref) {
      var id, p;
      try { id = idOf(ref); } catch (e0) { return Promise.reject(e0); }
      try { p = bucket().remove([id]); } catch (e1) { return Promise.reject(mapErr(e1)); }
      return Promise.resolve(p).then(function (r) {
        if (r && r.error) { throw mapErr(r.error); }
        return { deleted: !!(r && r.data && r.data.length) };
      }, function (e) { throw (e && e.code ? e : mapErr(e)); });
    }

    return { upload: upload, list: list, delete: del };
  };
})();
