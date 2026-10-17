/* KvK calendar: built from the Kingdoms and Calendar tabs of the Google Sheet.
   Only signed-in members receive the dates. */
(function () {
  "use strict";
  var DAY = 86400000;
  function U(y, m, d) { return Date.UTC(y, m - 1, d); }
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function fd(t, y) { var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + (y ? ' ' + d.getUTCFullYear() : ''); }
  function fw(t) { var d = new Date(t); return WD[d.getUTCDay()] + ' ' + fd(t, true); }
  function days(a, b) { return Math.round((b - a) / DAY); }

  var DEFAULT = { dates: [], kingdoms: [], types: [], view: { mode: 'history', days: 10 } }; /* data comes only from the sheet, for signed-in members */

  var GROUP_NAMES = { stage: 'KvK stage', mge: 'MGE', gh: 'GH', pop: 'KvK pop-up', mig: 'Migration', other: 'Other' };
  var FALLBACK = { kvk: '#3DD68C', stage: '#3DD68C', mge: '#D86CF2', gh: '#FF8A4C', pop: '#F0555A', mig: '#4C8DFF', other: '#9AA6BA' };
  var PALETTE = ['#D86CF2', '#F5C542', '#4C8DFF', '#FF8A4C', '#2FD4E8', '#9B7BFF'];
  function guess(name) {
    var n = name.toLowerCase();
    if (n === 'mge') return 'mge'; if (n === 'gh') return 'gh';
    if (n.indexOf('pop') > -1) return 'pop'; if (n.indexOf('migration') > -1) return 'mig';
    return 'other';
  }
  function hex(c, d) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : d; }
  function rgbOf(h) { var v = parseInt(String(h).slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].join(','); }
  function startOfDay(t) { return Math.floor(t / DAY) * DAY; }

  var OURS = String((window.CONFIG && window.CONFIG.KINGDOM) || '3914').replace(/[^0-9]/g, '') || '3914';
  var V = window.KVK = { DAY: DAY, U: U, MON: MON, fd: fd, fw: fw, days: days, source: 'backup', GROUP_NAMES: GROUP_NAMES, OURS: OURS, admin: false, all: [], types: [], kingdomsRaw: [] };

  /* Turn the sheet data into everything the pages draw */
  function build(cal) {
    var now = Date.now();
    var T = {}; (cal.types || []).forEach(function (t) { T[t.n] = t; });
    V.types = cal.types || [];
    function typeOf(name) { var t = T[name]; return t ? { g: TYPE_GROUP(t.g), c: hex(t.c, FALLBACK[TYPE_GROUP(t.g)]), s: t.s || name, subs: t.subs || [] } : { g: guess(name), c: FALLBACK[guess(name)], s: name, subs: [] }; }
    function TYPE_GROUP(g) { return FALLBACK[g] && g !== 'kvk' ? g : 'other'; }

    var rows = (cal.dates || []).filter(function (d) { return d.e && d.a; }).map(function (d) {
      var t = typeOf(d.e);
      return { e: d.e, a: d.a, b: d.b && d.b > d.a ? d.b : 0, x: d.x || '', est: !!d.est, g: t.g, c: t.c, s: t.s, r: d.r };
    }).sort(function (p, q) { return p.a - q.a; });

    var popRows = rows.filter(function (r) { return r.g === 'pop'; });
    var pops = popRows.map(function (r) { return r.a; });
    var estSet = {}; popRows.forEach(function (r) { if (r.est) estSet[r.a] = 1; });
    var migRows = rows.filter(function (r) { return r.g === 'mig'; });

    /* kingdoms: ours first, then the others by number */
    var kraw = (cal.kingdoms || []).slice();
    if (!kraw.some(function (k) { return k.id === OURS; })) kraw.unshift({ id: OURS, name: 'Kingdom ' + OURS, color: FALLBACK.kvk });
    kraw.sort(function (p, q) { return (p.id === OURS ? -1 : q.id === OURS ? 1 : Number(p.id) - Number(q.id)); });
    V.kingdomsRaw = kraw;
    var K = kraw.map(function (k, i) {
      var ours = k.id === OURS, c = hex(k.color, ours ? FALLBACK.kvk : PALETTE[i % PALETTE.length]);
      var after = k.end ? pops.filter(function (p) { return p > k.end; }) : [];
      var opt = after[0] || 0, must = after[1] || 0, segs = [], marks = [];
      var buildFrom = ours ? (k.buildup || (migRows.length && k.start && migRows[0].a < k.start ? migRows[0].a : 0)) : 0;
      if (buildFrom && k.start && buildFrom < k.start) segs.push({ t: 'pre', a: buildFrom, b: k.start, l: 'Migration & build-up' });
      if (k.end) segs.push({ t: 'kvk', a: k.start || 0, b: k.end, open: !k.start ? 1 : 0, l: 'KvK' });
      if (k.start) marks.push({ t: 'reg', d: k.start });
      if (opt) { segs.push({ t: 'off', a: k.end, b: opt, l: 'Off-season' }); marks.push({ t: 'opt', d: opt }); }
      if (must) { segs.push({ t: 'skip', a: opt, b: must, l: 'Off-season if skipped' }); marks.push({ t: 'must', d: must, est: estSet[must] ? 1 : 0 }); }
      return { id: k.id, ours: ours, name: k.name || ('Kingdom ' + k.id), sub: ours ? 'Our KvK' : 'Other kingdom', c: c, rgb: rgbOf(c), segs: segs, marks: marks, start: k.start, end: k.end, opt: opt, must: must, mustEst: !!estSet[must] };
    });
    var me = K[0];

    /* group colours (first event type of each group decides) */
    var KC = { kvk: me.c };
    ['stage', 'mge', 'gh', 'pop', 'mig', 'other'].forEach(function (g) {
      var t = (cal.types || []).filter(function (x) { return TYPE_GROUP(x.g) === g; })[0];
      KC[g] = t ? hex(t.c, FALLBACK[g]) : FALLBACK[g];
    });

    /* visible range */
    var view = cal.view || { mode: 'history', days: 10 };
    var all = [now];
    rows.forEach(function (r) { all.push(r.a); if (r.b) all.push(r.b); });
    K.forEach(function (k) { [k.start, k.end, k.must || k.opt].forEach(function (x) { if (x) all.push(x); }); });
    var R0, R1;
    if (view.mode === 'range' && view.from && view.to && view.to > view.from) { R0 = startOfDay(view.from); R1 = startOfDay(view.to) + DAY; }
    else {
      R0 = startOfDay(now) - (view.days >= 0 ? view.days : 10) * DAY;
      R1 = Math.max(Math.max.apply(null, all) + 14 * DAY, now + 30 * DAY);
    }
    K.forEach(function (k) { k.segs.forEach(function (s) { if (!s.a || s.a < R0) { s.a = Math.max(s.a || R0, R0); s.open = 1; } }); });
    function inView(a, b) { return (b || a) + DAY > R0 && a < R1; }

    var migs = migRows.filter(function (r) { return inView(r.a); }).map(function (r, i) { return { d: r.a, c: r.c, l: (r.x || 'Migration ' + (i + 1)) + ' · ' + fd(r.a) }; });

    /* key dates: every dated row plus our KvK start/end */
    var EVENTS = rows.map(function (r) {
      var range = r.b ? fd(r.a) + ' – ' + fd(r.b) : '';
      return { d: r.a, b: r.b, t: r.e, x: [r.x, range].filter(Boolean).join(' · '), g: [r.g], c: r.c, est: r.est };
    });
    if (me.start) EVENTS.push({ d: me.start, b: 0, t: 'KvK start', x: me.name, g: ['kvk'], c: me.c });
    if (me.end) EVENTS.push({ d: me.end, b: 0, t: 'KvK end', x: me.name + ' enters off-season', g: ['kvk'], c: me.c });
    EVENTS.sort(function (p, q) { return p.d - q.d; });

    V.R0 = R0; V.R1 = R1; V.POPS = pops.filter(function (p) { return inView(p); }); V.estSet = estSet; V.MIGS = migs; V.K = K; V.KC = KC;
    V.EVENTS = EVENTS; V.SHOWN = EVENTS.filter(function (e) { return inView(e.d, e.b); }); V.ROWS = rows; V.view = view;
    V.stages = rows.filter(function (r) { return r.g === 'stage' && inView(r.a); });
    V.mge = rows.filter(function (r) { return r.g === 'mge' && inView(r.a, r.b); });
    V.gh = rows.filter(function (r) { return r.g === 'gh' && inView(r.a, r.b); });
    V.other = rows.filter(function (r) { return r.g === 'other' && inView(r.a, r.b); });
    V.typeOf = typeOf;
  }

  V.nextEvent = function (now) { return V.EVENTS.filter(function (e) { return e.d + DAY > now; })[0] || null; };
  V.running = function (now) { return V.EVENTS.filter(function (e) { return e.b && now >= e.d && now < e.b + DAY; }); };
  V.phaseOf = function (k, now) { for (var i = 0; i < k.segs.length; i++) { var s = k.segs[i]; if (now >= s.a && now < s.b) return s; } return null; };

  /* Our kingdom's status card (used on Home and Calendar) */
  V.statusHTML = function (now) {
    var k = V.K[0];
    if (!V.EVENTS.length && !k.end) return '<div class="st"><div class="st-name">No dates yet</div><div class="st-main">Admins can add dates in Edit mode.</div></div>';
    var s = V.phaseOf(k, now), chip, main, pct = null;
    if (!s) {
      var firstSeg = k.segs[0];
      if (firstSeg && now < firstSeg.a) { var dd = Math.ceil((firstSeg.a - now) / DAY); chip = 'Preparing'; main = 'Next phase starts <b>' + fd(firstSeg.a, true) + '</b> · ' + (dd <= 1 ? 'tomorrow' : 'in ' + dd + ' days'); }
      else if (k.must) { chip = 'Back in the KvK cycle'; main = 'Off-season is over. Registration deadline was <b>' + fd(k.must, true) + '</b>'; }
      else { chip = 'No KvK dates'; main = 'Admins can set our KvK start and end under Kingdoms in Edit mode.'; }
    } else {
      var lft = Math.max(0, Math.ceil((s.b - now) / DAY));
      if (s.t === 'kvk') { chip = 'In KvK'; main = 'KvK ends <b>' + fd(s.b, true) + '</b> · ' + lft + ' days left'; }
      else if (s.t === 'off') { chip = 'Off-season'; main = 'Optional registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
      else if (s.t === 'skip') { chip = 'Off-season · must register'; main = 'Mandatory registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
      else { chip = 'Migration & build-up'; main = 'KvK starts <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
      if (!s.open) pct = Math.min(100, Math.max(2, (now - s.a) / (s.b - s.a) * 100));
    }
    var run = V.running(now).filter(function (e) { return e.g[0] === 'mge' || e.g[0] === 'gh'; })[0];
    var up = V.nextEvent(now);
    var next = up ? 'Next: ' + up.t + ' · ' + fd(up.d, true) : 'No more dates on this calendar';
    return '<div class="st">' +
      '<div class="st-top"><div><div class="st-name" style="color:' + k.c + '">' + Site.esc(k.name) + '</div><div class="st-sub">' + Site.esc(k.sub) + '</div></div>' +
      '<div class="phase" style="color:' + k.c + ';background:rgba(' + k.rgb + ',.14)"><span class="dot"></span>' + chip + '</div></div>' +
      '<div class="st-main">' + main + '</div>' +
      (pct !== null ? '<div class="prog" aria-hidden="true"><i style="width:' + pct.toFixed(1) + '%;background:' + k.c + '"></i></div>' : '') +
      (run ? '<div class="st-next" style="color:' + run.c + ';font-weight:700">' + Site.esc(run.t) + ' is running · ends ' + fd(run.b, true) + '</div>' : '') +
      '<div class="st-next">' + Site.esc(next) + '</div></div>';
  };

  /* Load from the sheet (the backup above is only used if the sheet can't be reached).
     Open pages re-check the sheet every minute and refresh when something changed. */
  var ready = null, lastSig = null;
  function apply(res) {
    var cal = res && res.ok && res.calendar;
    if (!cal) return false;
    build(cal); V.source = 'sheet'; lastSig = JSON.stringify(cal);
    V.admin = !!res.admin; V.all = cal.dates || [];
    return true;
  }
  function check(force, pre) {
    if (document.hidden && force !== true) return;
    if (document.getElementById('mdl') || document.body.classList.contains('edit-on')) return; /* don't refresh while an admin is editing */
    (pre || Site.api({ action: 'calendar' })).then(function (res) {
      var cal = res && res.ok && res.calendar;
      if (cal && JSON.stringify(cal) !== lastSig) location.reload();
    }).catch(function () {});
  }
  V.init = function (pre) {
    if (ready) return ready;
    var c = Site.cached('calendar');
    if (c && apply(c)) {
      /* show the saved dates right away, then refresh if the sheet changed */
      ready = Promise.resolve(V);
      check(true, pre);
      setInterval(check, 60000);
      return ready;
    }
    ready = (pre || Site.api({ action: 'calendar' })).then(apply).catch(function () {}).then(function () {
      setInterval(check, 60000);
      return V;
    });
    return ready;
  };
  V.noNextText = function () { return V.EVENTS.length ? 'All dates complete' : 'No dates yet. Add them in the Calendar tab'; };

  build(DEFAULT);
})();
