(function () {
'use strict';
var K = 'tylchronicle-ui164', st = {};
try { st = JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch (e) { st = {}; }
if (!st.p || typeof st.p !== 'object') st.p = {};
function save() { try { localStorage.setItem(K, JSON.stringify(st)); } catch (e) { /* stockage indisponible */ } }
function key(d) {
var side = d.parentNode && d.parentNode.classList;
if (!side || !side.contains('side')) return '';
var all = d.parentNode.querySelectorAll(':scope > details.panel');
return (side.contains('side-l') ? 'l' : 'r') + Array.prototype.indexOf.call(all, d);
}
Array.prototype.forEach.call(document.querySelectorAll('#viewCombat > .side > details.panel'), function (d) {
var k = key(d);
if (k && typeof st.p[k] === 'boolean' && d.open !== st.p[k]) d.open = st.p[k];
});
var how = document.getElementById('pvHow');
if (how && st.how === 1) how.open = true;
document.addEventListener('toggle', function (e) {
var d = e.target;
if (!d || d.tagName !== 'DETAILS') return;
if (d.id === 'pvHow') { st.how = d.open ? 1 : 0; save(); return; }
if (d.parentNode && d.parentNode.parentNode && d.parentNode.parentNode.id === 'viewCombat' && d.classList.contains('panel')) {
var k = key(d);
if (k && st.p[k] !== d.open) { st.p[k] = d.open; save(); }
}
}, true);
var m = document.getElementById('barMore');
if (m) {
document.addEventListener('click', function (e) { if (m.open && !m.contains(e.target)) m.open = false; });
document.addEventListener('keydown', function (e) {
if (e.key === 'Escape' && m.open) { m.open = false; try { m.querySelector('summary').focus(); } catch (x) { /* ignoré */ } }
});
}
})();
