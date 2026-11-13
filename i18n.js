/* Kingdom 3914 — website languages (English is the default; VN now, AR later)
   How it works: the pages are written in English. In another language, every English text
   on the page is swapped for its translation from the dictionary (lang-vi.js), including text
   that appears later (pop-ups, messages). Admins can fix any translation on the site itself:
   Edit mode → 🌐 Fix translations → click a text. Fixes are saved in Site text as tr_<lang>_<id>. */
(function () {
  'use strict';
  var LANGS = { en: { label: 'EN', name: 'English', html: 'en' }, vi: { label: 'VN', name: 'Tiếng Việt', html: 'vi' } };
  var KEY = 'k3914-lang', FIXKEY = 'k3914-trfix';
  function sget(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  var lang = sget(KEY); if (!LANGS[lang]) lang = 'en';
  var on = lang !== 'en';
  document.documentElement.setAttribute('lang', LANGS[lang].html);

  /* load the dictionary and the heading font that has Vietnamese letters */
  if (on) {
    document.write('<script src="lang-' + lang + '.js?v=1"><\/script>');
    document.write('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+SC:wght@600;700&display=swap">');
  }
  var css = '.lang-sw{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--line);background:var(--panel2)}' +
    '.lang-sw button{min-height:30px;min-width:38px;padding:4px 10px;border-radius:999px;border:0;background:none;color:var(--soft);font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}' +
    '.lang-sw button[aria-pressed="true"]{background:rgba(231,198,144,.18);color:var(--gold)}' +
    '.lang-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 6px 6px 12px;color:var(--soft);font-weight:700;font-size:14px}' +
    '.topbar .lang-sw{order:2}@media(max-width:680px){.topbar .lang-sw{margin-left:auto}}' +
    '.lock-card .lang-sw{align-self:center}' +
    'html[lang=vi] h1,html[lang=vi] h2,html[lang=vi] .brand b,html[lang=vi] .acct-av,html[lang=vi] .lock-card h2,html[lang=vi] .rb3 .sec-head h2{font-family:"Cormorant SC","Cinzel",Georgia,serif!important;letter-spacing:.01em}' +
    'html[lang=vi] .rb3{--display:"Cormorant SC","Cinzel",Georgia,serif}' +
    'body.tr-fix [data-tr],body.tr-fix [data-tr-src]{outline:1.5px dashed rgba(143,179,255,.85);outline-offset:2px;cursor:text}' +
    'body.tr-fix [data-tr]:hover,body.tr-fix [data-tr-src]:hover{background:rgba(143,179,255,.12)}' +
    '.tr-pill{position:fixed;left:max(14px,env(safe-area-inset-left,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:70;display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid rgba(143,179,255,.6);background:#11182A;color:#C9D8FF;font-weight:700;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:pointer;font-family:inherit}' +
    '.tr-pill[aria-pressed="true"]{background:#8FB3FF;color:#0B1020}';
  document.write('<style>' + css + '</style>');

  /* ---------- the dictionary ---------- */
  var over = {}, pats = null;
  function dict() { return (window.I18N_LANG && window.I18N_LANG[lang]) || {}; }
  function patterns() {
    if (pats) return pats;
    var src = (window.I18N_PATTERNS && window.I18N_PATTERNS[lang]) || [];
    pats = src.map(function (p) { return [new RegExp('^' + p[0] + '$'), p[1]]; });
    return pats;
  }
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  /* dates and weekdays written the local way: "Mon 16 Nov" → "T2 16/11" */
  var DATES = (window.I18N_DATES || {});
  function dates(s) {
    var D = DATES[lang] || (window.I18N_DATES && window.I18N_DATES[lang]); if (!D) return s;
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    return s
      .replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?: (\d{4}))?/g, function (m, d, mo, y) { return d + '/' + (MON.indexOf(mo) + 1) + (y ? '/' + y : ''); })
      .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/g, function (m, mo, y) { return D.month + ' ' + (FULL.indexOf(mo) + 1) + ' ' + y; })
      .replace(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) (\d{4})\b/g, function (m, mo, y) { return D.month.toUpperCase() + ' ' + (FULL.map(function (x) { return x.toUpperCase(); }).indexOf(mo) + 1) + ' ' + y; })
      .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b(?= \d)/g, function (m, w) { return D.wd[WD[w]]; });
  }
  /* translation of one English text, or null if there is none */
  function tr(en, depth) {
    if (!on) return null;
    var k = norm(en); if (!k) return null;
    depth = depth || 0;
    if (over[k]) return over[k];
    var d = dict(); if (d[k]) return d[k];
    var p = patterns();
    for (var i = 0; i < p.length; i++) {
      var mm = k.match(p[i][0]);
      if (mm) return p[i][1].replace(/\$(\d)/g, function (x, n) { return mm[n] || ''; }).replace(/\{(\d)\}/g, function (x, n) { return t(mm[n] || ''); });
    }
    if (depth > 3) return null;
    /* "· text", "text ·", "text:" — translate the text and keep the marks */
    var e = k.match(/^([·•–—]\s+)?([\s\S]*?)(\s+[·•–—]|:)?$/);
    if (e && (e[1] || e[3]) && e[2]) { var inner = tr(e[2], depth + 1); if (inner != null) return (e[1] || '') + inner + (e[3] || ''); }
    /* "A · B · C": translate each part */
    if (k.indexOf(' · ') > 0) {
      var parts = k.split(' · '), any = false;
      parts = parts.map(function (x) { var v = tr(x, depth + 1); if (v != null) { any = true; return v; } return x; });
      if (any) return parts.join(' · ');
    }
    /* several sentences: translate each */
    var sents = k.split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sents.length > 1) {
      var any2 = false;
      sents = sents.map(function (x) { var v = tr(x, depth + 1); if (v != null) { any2 = true; return v; } return x; });
      if (any2) return sents.join(' ');
    }
    var dd = dates(k); if (dd !== k) return dd;
    return null;
  }
  function t(en) { var v = tr(en); return v == null ? en : v; }

  /* ---------- swapping text on the page ---------- */
  var orig = new WeakMap(), mine = new WeakMap(), attrOrig = new WeakMap();
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  function skip(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      var n = e.nodeName;
      if (n === 'SCRIPT' || n === 'STYLE' || n === 'TEXTAREA' || n === 'NOSCRIPT') return true;
      if (e.hasAttribute('data-notr') || e.isContentEditable) return true;
    }
    return false;
  }
  function doText(node) {
    var v = node.nodeValue; if (!v || !/[A-Za-z]/.test(v)) return;
    var src = (mine.get(node) === v && orig.has(node)) ? orig.get(node) : v;
    var m = src.match(/^(\s*)([\s\S]*?)(\s*)$/), out = tr(m[2]);
    var par = node.parentNode;
    if (!par || skip(par)) return;
    if (out != null) {
      var nv = m[1] + out + m[3];
      orig.set(node, src); mine.set(node, nv);
      if (node.nodeValue !== nv) node.nodeValue = nv;
      if (par.setAttribute) par.setAttribute('data-tr', '');
    } else if (orig.has(node) && mine.get(node) === v) {
      /* a fix was removed: show the English again */
      mine.delete(node); orig.delete(node); node.nodeValue = src;
    } else if (par.setAttribute && fixOn) par.setAttribute('data-tr-src', '');
  }
  function doAttrs(el) {
    if (skip(el)) return;
    var store = attrOrig.get(el) || {};
    ATTRS.forEach(function (a) {
      if (!el.hasAttribute(a)) return;
      var v = el.getAttribute(a), rec = store[a];
      var src = rec && rec.set === v ? rec.en : v;
      var out = tr(src);
      if (out != null) { store[a] = { en: src, set: out }; if (v !== out) el.setAttribute(a, out); }
    });
    attrOrig.set(el, store);
  }
  function walk(root) {
    if (!on || !root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skip(root)) return; doAttrs(root); }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else if (ATTRS.some(function (a) { return n.hasAttribute(a); })) doAttrs(n); }
  }
  function title() {
    if (!on) return;
    var parts = document.title.split(' · ').map(function (p) { return t(p); }).join(' · ');
    if (parts !== document.title) document.title = parts;
  }
  if (on) {
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') { if (mine.get(m.target) !== m.target.nodeValue) doText(m.target); }
        else if (m.type === 'attributes') doAttrs(m.target);
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    document.addEventListener('DOMContentLoaded', function () { walk(document.body); title(); });
  }

  /* ---------- admins: fix a translation by clicking it ---------- */
  var fixOn = on && sget(FIXKEY) === '1';
  function djb(s) { var x = 5381; for (var i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x.toString(36); }
  function keyOf(en) { return 'tr_' + lang + '_' + djb(norm(en)); }
  function loadOverrides(text) {
    over = {};
    Object.keys(text || {}).forEach(function (k) {
      if (k.indexOf('tr_' + lang + '_') !== 0) return;
      try { var o = JSON.parse(text[k]); if (o && o.en && o.t) over[norm(o.en)] = String(o.t); } catch (e) {}
    });
  }
  function textNodeAt(e) {
    var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (r && r.startContainer && r.startContainer.nodeType === 3 && /[A-Za-zÀ-ỹ]/.test(r.startContainer.nodeValue)) return r.startContainer;
    if (!r && document.caretPositionFromPoint) { var cp = document.caretPositionFromPoint(e.clientX, e.clientY); if (cp && cp.offsetNode && cp.offsetNode.nodeType === 3) return cp.offsetNode; }
    var el = e.target, best = null;
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && norm(c.nodeValue)) { best = c; break; }
    return best;
  }
  function fixDialog(node) {
    var S = window.Site; if (!S) return;
    var shown = node.nodeValue, en = norm(mine.get(node) === shown && orig.has(node) ? orig.get(node) : shown);
    var cur = tr(en) || '', key = keyOf(en), esc = S.esc;
    var M = S.modal('🌐 ' + t('Fix translation') + ' (' + LANGS[lang].label + ')');
    M.body.innerHTML = '<div data-notr><p style="color:var(--soft);font-size:14px;margin:0 0 8px">' + t('English') + '</p>' +
      '<div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;margin-bottom:12px">' + esc(en) + '</div>' +
      '<label for="trIn" style="display:block;color:var(--soft);font-size:14px;margin-bottom:6px">' + esc(LANGS[lang].name) + '</label>' +
      '<textarea id="trIn" rows="3" maxlength="900" style="width:100%;box-sizing:border-box;background:#090A11;border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text);font:inherit;font-size:15px">' + esc(cur) + '</textarea>' +
      '<p style="color:var(--muted);font-size:12.5px;margin:6px 0 0">' + t('Saved for every player straight away. It changes this exact text everywhere on the site.') + '</p>' +
      '<div class="err" id="trErr" style="margin-top:10px"></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost" type="button" id="trReset"' + (over[en] ? '' : ' disabled') + '>' + t('Reset to default') + '</button>' +
      '<span style="display:flex;gap:8px"><button class="btn ghost" type="button" data-mdl-close>' + t('Cancel') + '</button><button class="btn gold" type="button" id="trSave">' + t('Save') + '</button></span></div></div>';
    function save(val, btn) {
      btn.disabled = true;
      var items = {}; items[key] = val ? JSON.stringify({ en: en, t: val }) : '';
      S.saveText(items).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'Could not save.');
        M.close(); S.toast(t(val ? 'Translation saved' : 'Back to default'), t(val ? 'Every player now sees the new text.' : 'The built-in translation is used again.'), 'good');
      }).catch(function (x) { var el = M.body.querySelector('#trErr'); el.textContent = x.message; el.className = 'err on'; btn.disabled = false; });
    }
    M.body.querySelector('#trSave').onclick = function () { var v = M.body.querySelector('#trIn').value.trim(); if (!v) { M.body.querySelector('#trErr').textContent = t('Write the translation, or use Reset to default.'); M.body.querySelector('#trErr').className = 'err on'; return; } save(v, this); };
    M.body.querySelector('#trReset').onclick = function () { save('', this); };
    setTimeout(function () { var i = M.body.querySelector('#trIn'); if (i) { i.focus(); i.select(); } }, 60);
  }
  function setFix(v) {
    fixOn = !!v; sset(FIXKEY, fixOn ? '1' : '0');
    document.body.classList.toggle('tr-fix', fixOn);
    var p = document.querySelector('.tr-pill'); if (p) { p.setAttribute('aria-pressed', String(fixOn)); p.textContent = t('🌐 Fix translations: ' + (fixOn ? 'ON' : 'OFF')); }
    if (fixOn) walk(document.body);
  }
  function fixPill() {
    var S = window.Site, show = on && S && S.isAdmin() && S.editOn();
    var p = document.querySelector('.tr-pill');
    if (!show) { if (p) p.remove(); if (fixOn) { document.body.classList.remove('tr-fix'); } return; }
    if (!p) {
      p = document.createElement('button'); p.type = 'button'; p.className = 'tr-pill'; p.setAttribute('data-notr', '');
      p.onclick = function (e) { e.stopPropagation(); setFix(!fixOn); };
      document.body.appendChild(p);
    }
    p.setAttribute('aria-pressed', String(fixOn)); p.textContent = t('🌐 Fix translations: ' + (fixOn ? 'ON' : 'OFF'));
    document.body.classList.toggle('tr-fix', fixOn);
  }
  document.addEventListener('click', function (e) {
    if (!fixOn || !document.body.classList.contains('tr-fix')) return;
    if (e.target.closest && (e.target.closest('.tr-pill') || e.target.closest('.mdl-scrim'))) return;
    var node = textNodeAt(e); if (!node || skip(node.parentNode)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    fixDialog(node);
  }, true);

  /* ---------- the language switch ---------- */
  function switchHtml() {
    return '<div class="lang-sw" role="group" aria-label="Language" data-notr>' + Object.keys(LANGS).map(function (k) {
      return '<button type="button" data-lang="' + k + '" aria-pressed="' + (k === lang) + '" title="' + LANGS[k].name + '">' + LANGS[k].label + '</button>';
    }).join('') + '</div>';
  }
  function setLang(k) { if (!LANGS[k] || k === lang) return; sset(KEY, k); location.reload(); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lang]'); if (!b) return;
    e.preventDefault(); setLang(b.getAttribute('data-lang'));
  });

  window.I18N = {
    lang: lang, on: on, t: t, tr: tr, switchHtml: switchHtml, setLang: setLang,
    onText: function (text) { loadOverrides(text); if (on && document.body) { walk(document.body); title(); } },
    refreshTools: fixPill,
    fixFor: function (e) { if (!on) return false; var n = textNodeAt(e); if (!n) return false; fixDialog(n); return true; }
  };
})();
