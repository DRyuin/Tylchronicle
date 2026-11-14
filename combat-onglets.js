/* combat-onglets.js : onglets du panneau « Mon combat » (Infos / Armes / Sorts / Sac) et économie d'action (Simplifié, joueuse). ES5.
   1. Modèle pur (testé sous Node) : types Action / Bonus / Réaction / Gratuit, règle de grisage (gate), lecture du Sac depuis l'équipement de la fiche,
      type d'un sort, résumé d'un sort, navigation clavier des onglets.
   2. Constructeurs de HTML (reçoivent un contexte cx fourni par combat-joueuse.js ; tout texte injecté passe par cx.esc).
   Aucune action réseau ici : combat-joueuse.js envoie hp / roll / eco (actions existantes) ; emplacements et fiche passent par app.js (tkCast, libSave).

   RÈGLES DE TABLE (à changer ici, une ligne chacune) :
   - POTION_SOIN_TYPE : type par défaut des potions de soin. 'b' = Action bonus (règle de TABLE voulue par Corentin) ; la règle officielle 5e est 'a' (Action).
   - OBJET_TYPE : type par défaut des autres objets utilisables ('a' = Action, règle officielle).
   - BONUS_SWITCH : montre, pour chaque objet utilisable, l'interrupteur « Utiliser en Bonus » (le choix est gardé dans la fiche : x.bagt).
   Règle d'économie : une pastille (Action / Bonus / Réaction) cochée grise tous les contrôles de ce type dans tous les onglets ; « Gratuit » ne coche rien.
   Une capacité ou un objet qui permet d'utiliser une Action en Bonus (potion de table, Ruse, Second souffle...) se règle par son type : Bonus. */
(function (root) {
  'use strict';

  var POTION_SOIN_TYPE = 'b';
  var OBJET_TYPE = 'a';
  var BONUS_SWITCH = true;

  var api = {};
  var cfg = { POTION_SOIN_TYPE: POTION_SOIN_TYPE, OBJET_TYPE: OBJET_TYPE, BONUS_SWITCH: BONUS_SWITCH };
  var TY = { a: 'Action', b: 'Bonus', r: 'Réaction', g: 'Gratuit' };
  var WHY = { a: 'Action utilisée', b: 'Bonus utilisé', r: 'Réaction utilisée' };
  var MSG = { a: 'Action déjà utilisée', b: 'Action bonus déjà utilisée', r: 'Réaction déjà utilisée' };
  var TABS = [['infos', 'Infos'], ['armes', 'Armes'], ['sorts', 'Sorts'], ['sac', 'Sac']];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function fold(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[’\u0060]/g, '\'').replace(/[àâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[îï]/g, 'i').replace(/[ôö]/g, 'o').replace(/[ùûü]/g, 'u').replace(/ç/g, 'c');
  }

  /* ---------- économie d'action ---------- */
  /* st : { used:{a,b,r}, fight, myTurn, atkN, atkMax, weapon }
     retourne { off, why, tick } : off = grisé, why = texte affiché, tick = cocher la pastille en utilisant l'élément */
  function gate(type, st) {
    var none = { off: false, why: '', tick: false };
    if (type !== 'a' && type !== 'b' && type !== 'r') return none;
    st = st || {};
    var u = st.used || {}, fight = !!st.fight;
    if (type === 'r') {
      if (!fight) return { off: true, why: 'Pas de combat', tick: false };
      if (u.r) return { off: true, why: WHY.r, tick: false };
      return { off: false, why: '', tick: true };
    }
    if (u[type]) {
      /* attaque supplémentaire : l'Action déjà cochée par une attaque reste utilisable pour les attaques suivantes */
      if (type === 'a' && st.weapon && st.atkN > 0 && st.atkN < st.atkMax) return none;
      return { off: true, why: WHY[type], tick: false };
    }
    if (!fight) return none;
    if (!st.myTurn) return { off: true, why: 'Pas ton tour', tick: false };
    return { off: false, why: '', tick: true };
  }
  /* message court quand on tente d'utiliser un contrôle grisé (clavier) */
  function denyMsg(type, why) { return /utilis/.test(String(why || '')) && MSG[type] ? MSG[type] + '.' : (why ? why + '.' : 'Impossible.'); }

  /* ---------- sorts ---------- */
  function spellType(r) { var t = fold(r && r.t); return /bonus/.test(t) ? 'b' : /reaction/.test(t) ? 'r' : 'a'; }
  function castLabel(r) {
    var t = String((r && r.t) || '').replace(/^1\s+/, ''), k = spellType(r);
    if (k === 'b') return 'Action bonus';
    if (k === 'r') return 'Réaction';
    return /^action$/i.test(t) || !t ? 'Action' : t.charAt(0).toUpperCase() + t.slice(1);
  }
  function summary(x) {
    var t = String(x || '').replace(/\s+/g, ' ').trim();
    if (t.length <= 150) return t;
    var cut = t.slice(0, 150), dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
    if (dot > 60) return cut.slice(0, dot + 1);
    var sp = cut.lastIndexOf(' ');
    return cut.slice(0, sp > 60 ? sp : 150) + '…';
  }
  function rollText(r) {
    var o = [];
    if (r.at) o.push('jet d\'attaque');
    if (r.dm) o.push('dégâts ' + r.dm + (r.dt ? ' ' + r.dt : ''));
    if (r.hd) o.push('soin ' + r.hd);
    if (r.sv) o.push('sauvegarde ' + r.sv);
    return o.join(' · ');
  }
  function levelName(l) { return l ? 'Niveau ' + l : 'Tours de magie'; }

  /* ---------- sac : l'équipement de la fiche (x.equip) est un texte, une ligne ou une virgule par objet ---------- */
  var USABLE_RE = /potion|elixir|philtre|fiole|antidote|baume|onguent|parchemin|ration|bombe|grenade|huile|poison|herbe|champignon/;
  var MONEY_RE = /^\d+\s*(po|pa|pc|pp|pe|gp|sp|cp|pieces?|piece)\b/;
  var DICE_RE = /(\d+d\d+(?:\s*[+\-−]\s*\d+)?)/i;

  /* découpe en segments { s, e, t } (offsets dans le texte) : saut de ligne, virgule ou point-virgule hors parenthèses */
  function segments(text) {
    var tx = String(text == null ? '' : text), out = [], depth = 0, from = 0, i, c;
    function push(a, b) {
      var raw = tx.slice(a, b), lead = raw.length - raw.replace(/^\s+/, '').length, t = raw.replace(/^\s+|\s+$/g, '');
      if (t) out.push({ s: a + lead, e: a + lead + t.length, t: t });
    }
    for (i = 0; i < tx.length; i++) {
      c = tx.charAt(i);
      if (c === '(' || c === '[') depth++;
      else if ((c === ')' || c === ']') && depth > 0) depth--;
      if (c === '\n' || (depth === 0 && (c === ',' || c === ';'))) { push(from, i); from = i + 1; depth = c === '\n' ? 0 : depth; }
    }
    push(from, tx.length);
    return out;
  }
  function healOf(name, seg) {
    var f = fold(name);
    if (!/potions? (de |d')?(soins?|guerison)/.test(f)) return '';
    var d = DICE_RE.exec(seg);
    if (d) return d[1].replace(/\s+/g, '').replace(/−/g, '-');
    if (/supr[e]?m/.test(f)) return '10d4+20';
    if (/superieur/.test(f)) return '8d4+8';
    if (/importan|majeur/.test(f)) return '4d4+4';
    return '2d4+2';
  }
  function parseSeg(sg) {
    var t = sg.t, qty = 1, mode = 'none', name = t, m;
    if (MONEY_RE.test(fold(t))) return { name: t, qty: 1, mode: 'none', usable: false, heal: '', dice: '', money: true };
    if ((m = /\(\s*[x×]\s*(\d+)\s*\)\s*$/i.exec(t))) { qty = parseInt(m[1], 10); mode = 'paren'; name = t.slice(0, m.index).replace(/\s+$/, ''); }
    else if ((m = /\s[x×]\s*(\d+)\s*$/i.exec(t))) { qty = parseInt(m[1], 10); mode = 'tail'; name = t.slice(0, m.index).replace(/\s+$/, ''); }
    else if ((m = /^(\d+)\s*[x×]?\s+(?=\S)/i.exec(t))) { qty = parseInt(m[1], 10); mode = 'lead'; name = t.slice(m[0].length); }
    if (!name) name = t;
    var f = fold(name), heal = healOf(name, t), dm = DICE_RE.exec(t);
    return { name: name, qty: qty, mode: mode, usable: USABLE_RE.test(f), heal: heal, dice: heal || (dm ? dm[1].replace(/\s+/g, '').replace(/−/g, '-') : ''), money: false };
  }
  function slug(name) { return fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'objet'; }
  function parseBag(text) {
    var seen = {};
    return segments(text).map(function (sg) {
      var it = parseSeg(sg), k = slug(it.name);
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > 1) k += '-' + seen[k];
      it.key = k; it.s = sg.s; it.e = sg.e; it.raw = sg.t;
      return it;
    });
  }
  /* réécrit seulement le segment de l'objet (les autres lignes restent identiques) */
  function setQty(text, key, q) {
    var tx = String(text == null ? '' : text), it = parseBag(tx).filter(function (x) { return x.key === key; })[0];
    if (!it) return tx;
    q = Math.max(0, Math.min(999, q | 0));
    var seg = it.raw, ns;
    if (it.mode === 'paren') ns = seg.replace(/\(\s*([x×])\s*\d+\s*\)\s*$/i, '($1' + q + ')');
    else if (it.mode === 'tail') ns = seg.replace(/([x×])\s*\d+\s*$/i, '$1' + q);
    else if (it.mode === 'lead') ns = seg.replace(/^\d+/, String(q));
    else ns = seg + ' (x' + q + ')';
    return tx.slice(0, it.s) + ns + tx.slice(it.e);
  }
  /* type d'un objet : réglage de la fiche (a | b) d'abord, sinon le défaut de la table */
  function bagType(it, over) {
    var o = over && typeof over === 'object' && it ? over[it.key] : '';
    if (o === 'a' || o === 'b') return o;
    return it && it.heal ? POTION_SOIN_TYPE : OBJET_TYPE;
  }

  /* ---------- onglets : navigation clavier (flèches avec retour, Début, Fin) ---------- */
  function nextTab(cur, key) {
    var ids = TABS.map(function (t) { return t[0]; }), i = ids.indexOf(cur);
    if (i < 0) i = 0;
    if (key === 'ArrowRight' || key === 'ArrowDown') return ids[(i + 1) % ids.length];
    if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[(i + ids.length - 1) % ids.length];
    if (key === 'Home') return ids[0];
    if (key === 'End') return ids[ids.length - 1];
    return null;
  }
  function validTab(id) { return TABS.some(function (t) { return t[0] === id; }) ? id : 'infos'; }

  api.cfg = cfg; api.TY = TY; api.WHY = WHY; api.TABS = TABS;
  api.gate = gate; api.denyMsg = denyMsg;
  api.spellType = spellType; api.castLabel = castLabel; api.summary = summary; api.rollText = rollText; api.levelName = levelName;
  api.parseBag = parseBag; api.setQty = setQty; api.bagType = bagType;
  api.nextTab = nextTab; api.validTab = validTab;

  /* =================== constructeurs de HTML (cx : esc, st(extra), ...) =================== */
  function badge(ty) { return '<span class="cs-ty cs-ty-' + ty + '" data-ty="' + ty + '">' + escDef(TY[ty]) + '</span>'; }
  function escDef(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; }); }

  /* bouton utilisable typé : o = { attrs, ty, label, aria, primary, extra (état pour gate), off (raison de grisage imposée, prioritaire sur l'économie) } */
  function actBtn(cx, o) {
    var g = o.off ? { off: true, why: o.off, tick: false } : gate(o.ty, cx.st(o.extra)), e = cx.esc;
    var aria = o.aria + (g.off ? ' : ' + g.why : '');
    return { g: g, html: '<button type="button" class="btn cs-pj-b cs-act' + (o.primary ? ' primary' : '') + (g.off ? ' cs-off' : '') + '" ' + o.attrs + ' data-cs-ty="' + o.ty + '"' +
      (g.off ? ' disabled aria-disabled="true" data-cs-why="' + e(g.why) + '"' : '') + ' aria-label="' + e(aria) + '"><span>' + e(o.label) + '</span>' +
      (g.off ? '<small class="cs-why">' + e(g.why) + '</small>' : '') + '</button>' };
  }
  api.actBtn = actBtn;

  /* decks de sorts (decks.js) : puces « Deck actif / Tous » ; sans cx.deck, aucune puce et le rendu reste celui d'avant */
  function deckRank(id, dk) { return dk.fav && dk.fav[id] ? 0 : dk.set && dk.set[id] ? 1 : 2; }
  function deckChips(cx) {
    var e = cx.esc, dk = cx.deck;
    return '<div class="dk-chips cs-dkc" role="group" aria-label="Sorts affichés">' +
      '<button type="button" class="dk-chip' + (dk.on ? ' on' : '') + '" data-cs-dk="on" aria-pressed="' + (dk.on ? 'true' : 'false') + '">Deck actif : ' + e(dk.nom) + '</button>' +
      '<button type="button" class="dk-chip' + (dk.on ? '' : ' on') + '" data-cs-dk="off" aria-pressed="' + (dk.on ? 'false' : 'true') + '">Tous</button></div>';
  }
  function spellsHTML(cx) {
    var e = cx.esc, rows = cx.spells || [], h = '', lvls = [], i, dk = cx.deck || null, chips = dk ? deckChips(cx) : '';
    if (!rows.length) return chips + (dk ? '<p class="muted">Aucun sort du deck sur ta fiche. Touche « Tous » pour voir tous tes sorts.</p>' : '<p class="muted">Aucun sort repéré sur ta fiche. Ouvre l\'onglet « Sorts &amp; objets » de ta page pour les choisir.</p>');
    h = chips;
    rows.forEach(function (r) { if (lvls.indexOf(r.l) < 0) lvls.push(r.l); });
    lvls.sort(function (a, b) { return a - b; });
    for (i = 0; i < lvls.length; i++) {
      var L = lvls[i];
      h += '<section class="cs-grp" aria-label="' + e(levelName(L)) + '"><h3>' + e(levelName(L)) + (L ? ' <small class="muted">' + e(cx.slotsLine ? cx.slotsLine(L) : '') + '</small>' : '') + '</h3><ul class="cs-list">';
      rows.filter(function (r) { return r.l === L; }).map(function (r, ix) { return { r: r, ix: ix }; }).sort(function (a, b) { return dk ? (deckRank(a.r.e, dk) - deckRank(b.r.e, dk)) || (a.ix - b.ix) : a.ix - b.ix; }).map(function (o) { return o.r; }).forEach(function (r) {
        var ty = spellType(r), lv = cx.levels(r), pick = cx.slotPick(r, lv), none = !lv.length, comp = String(r.c || '').split(',').map(function (x) { return x.replace(/^\s+|\s+$/g, ''); }).filter(Boolean).join(', ');
        var b = actBtn(cx, { attrs: 'data-cs-cast="' + e(r.e) + '"', ty: ty, label: 'Lancer', aria: 'Lancer ' + r.n, primary: true, off: none ? cx.noSlot(r) : '' });
        h += '<li class="cs-row' + (b.g.off ? ' cs-off' : '') + '" data-cs-spell="' + e(r.e) + '"><div class="cs-rn"><b>' + e(r.n) + '</b>' + (dk && dk.fav && dk.fav[r.e] ? ' <span class="cs-fav" role="img" aria-label="Favori">★</span>' : '') + ' ' + badge(ty) + (r.k ? ' <span class="cs-tag">Concentration</span>' : '') + '</div>' +
          '<div class="cs-ri">Incantation : ' + e(castLabel(r)) + ' · Portée : ' + e(r.r || '—') + ' · Composantes : ' + e(comp || '—') + (r.d ? ' · Durée : ' + e(r.d) : '') + '</div>' +
          (rollText(r) ? '<div class="cs-ri">' + e(rollText(r)) + '</div>' : '') +
          '<div class="cs-rs">' + e(summary(r.x)) + '</div><div class="cs-rb">';
        if (L > 0 && lv.length > 1) {
          h += '<label class="cs-sl"><span>Emplacement</span><select data-cs-slot="' + e(r.e) + '" aria-label="Niveau d\'emplacement pour ' + e(r.n) + '">' + lv.map(function (x) { return '<option value="' + x + '"' + (x === pick ? ' selected' : '') + '>Niv. ' + x + '</option>'; }).join('') + '</select></label>';
        }
        h += b.html;
        if (cx.pend && cx.pend.e === r.e) {
          h += actBtn(cx, { attrs: 'data-cs-sdmg="' + e(r.e) + '"', ty: 'g', label: cx.pend.nat === 20 ? 'Dégâts critiques' : 'Dégâts', aria: 'Lancer les dégâts de ' + r.n }).html;
        }
        h += '</div></li>';
      });
      h += '</ul></section>';
    }
    return h;
  }
  api.spellsHTML = spellsHTML;

  function bagHTML(cx) {
    var e = cx.esc, items = cx.bag.items, over = cx.bag.over;
    if (!items.length) return '<p class="muted">Rien dans ton équipement. Ajoute des objets sur ta fiche (« Équipement »), un par ligne, par exemple « Potion de soin (x2) ».</p>';
    return '<ul class="cs-list">' + items.map(function (it) {
      var ty = bagType(it, over), qtyTxt = it.money ? '' : '<span class="cs-qty" aria-label="Quantité ' + it.qty + '">× ' + it.qty + '</span>';
      if (!it.usable) return '<li class="cs-row cs-plain" data-cs-item="' + e(it.key) + '"><div class="cs-rn"><b>' + e(it.name) + '</b> ' + qtyTxt + '</div></li>';
      var b = actBtn(cx, { attrs: 'data-cs-use="' + e(it.key) + '"', ty: ty, label: 'Utiliser', aria: 'Utiliser ' + it.name, primary: true, off: it.qty < 1 ? 'Épuisé' : '' });
      return '<li class="cs-row' + (b.g.off ? ' cs-off' : '') + '" data-cs-item="' + e(it.key) + '"><div class="cs-rn"><b>' + e(it.name) + '</b> ' + qtyTxt + ' ' + badge(ty) + '</div>' +
        (it.heal ? '<div class="cs-ri">Soin ' + e(it.heal) + '</div>' : (it.dice ? '<div class="cs-ri">Jet ' + e(it.dice) + '</div>' : '')) +
        '<div class="cs-rb">' + (BONUS_SWITCH ? '<button type="button" class="cs-sw" role="switch" aria-checked="' + (ty === 'b' ? 'true' : 'false') + '" data-cs-bt="' + e(it.key) + '"><i aria-hidden="true"></i><span>Utiliser en Bonus</span></button>' : '') + b.html + '</div></li>';
    }).join('') + '</ul>';
  }
  api.bagHTML = bagHTML;

  function tabsHTML(cur) {
    return '<div class="cs-tabs" role="tablist" aria-label="Mon combat">' + TABS.map(function (t) {
      var on = t[0] === cur;
      return '<button type="button" class="cs-tab" role="tab" id="cst-' + t[0] + '" data-cs-tab="' + t[0] + '" aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="csp-' + t[0] + '" tabindex="' + (on ? '0' : '-1') + '">' + escDef(t[1]) + '</button>';
    }).join('') + '</div>';
  }
  api.tabsHTML = tabsHTML;

  /* capacités limitées (suivi des ressources existant) : pastille de type si la description le dit, grisée quand ce type est utilisé.
     Idempotent ; le suivi (#pvTrack) est réécrit par app.js à chaque rendu, on re-décore après. */
  function decorateTrack(track, st) {
    if (!track || !track.querySelectorAll) return;
    Array.prototype.forEach.call(track.querySelectorAll('.tkl'), function (row) {
      Array.prototype.forEach.call(row.querySelectorAll('.cs-ty-tk, .cs-why'), function (x) { if (x.parentNode) x.parentNode.removeChild(x); });
      var nm = row.querySelector('.tkn'), d = fold(nm ? nm.getAttribute('title') || '' : ''), ty = /action bonus/.test(d) ? 'b' : /reaction/.test(d) ? 'r' : '';
      var off = ty ? gate(ty, st) : { off: false };
      row.classList.toggle('cs-off', !!off.off);
      Array.prototype.forEach.call(row.querySelectorAll('button.pip'), function (p) {
        if (off.off) { if (!p.disabled) { p.disabled = true; p.setAttribute('data-cs-dis', '1'); } p.setAttribute('aria-disabled', 'true'); }
        else if (p.getAttribute('data-cs-dis')) { p.disabled = false; p.removeAttribute('data-cs-dis'); p.removeAttribute('aria-disabled'); }
      });
      if (ty && nm) {
        var s = root.document.createElement('span'); s.className = 'cs-ty cs-ty-' + ty + ' cs-ty-tk'; s.setAttribute('data-ty', ty); s.textContent = TY[ty]; nm.appendChild(s);
        if (off.off) { var w = root.document.createElement('span'); w.className = 'cs-why'; w.textContent = off.why; nm.appendChild(w); }
      }
    });
  }
  api.decorateTrack = decorateTrack;

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.tylTabs = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' && globalThis.document ? globalThis : null));
