/* KvK calendar: built from the Kingdoms and Calendar tabs of the Google Sheet.
   The DEFAULT data below is only a backup, used if the sheet can't be reached. */
(function () {
  "use strict";
  var DAY = 86400000;
  function U(y, m, d) { return Date.UTC(y, m - 1, d); }
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function fd(t, y) { var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + (y ? ' ' + d.getUTCFullYear() : ''); }
  function fw(t) { var d = new Date(t); return WD[d.getUTCDay()] + ' ' + fd(t, true); }
  function days(a, b) { return Math.round((b - a) / DAY); }

  var DEFAULT = {
    kingdoms: [
      { id: '1875', name: 'Kingdom 1875', sub: 'Current KvK', color: '#F5C542', start: 0, end: U(2026,10,20), buildup: 0 },
      { id: '2359', name: 'Kingdom 2359', sub: 'KvK league', color: '#D86CF2', start: U(2026,10,12), end: U(2026,12,17), buildup: 0 },
      { id: '3914', name: 'Kingdom 3914', sub: 'Our new home', color: '#3DD68C', start: U(2026,11,9), end: U(2027,1,14), buildup: U(2026,10,21) }
    ],
    dates: [
      { d: U(2026,8,17), t: 'KvK pop-up', x: 'Registration window', type: 'popup', k: [] },
      { d: U(2026,9,14), t: 'KvK pop-up', x: 'Registration window', type: 'popup', k: [] },
      { d: U(2026,10,12), t: 'Pop-up · 2359 registers', x: '2359 signs up for KvK', type: 'popup', k: ['2359'] },
      { d: U(2026,10,20), t: '1875 KvK ends', x: '1875 enters off-season', type: 'kvk-end', k: ['1875'] },
      { d: U(2026,10,21), t: 'Migration 1 → 3914', x: 'First migration window into 3914', type: 'migration', k: [] },
      { d: U(2026,11,9), t: 'Pop-up · 3914 registers', x: '3914 signs up for KvK · 1875 may register or skip', type: 'popup', k: ['3914','1875'] },
      { d: U(2026,12,7), t: 'Pop-up · 1875 must register', x: '2nd pop-up after its KvK, so registration is mandatory', type: 'popup', k: ['1875'] },
      { d: U(2026,12,17), t: '2359 KvK ends', x: '2359 enters off-season', type: 'kvk-end', k: ['2359'] },
      { d: U(2027,1,4), t: 'Pop-up · 2359 1st registration', x: 'Optional: 2359 may register or skip', type: 'popup', k: ['2359'] },
      { d: U(2027,1,14), t: '3914 KvK ends', x: '3914 enters off-season', type: 'kvk-end', k: ['3914'] },
      { d: U(2027,1,15), t: 'Migration 2 → 3914', x: 'Second migration window into 3914', type: 'migration', k: [] },
      { d: U(2027,2,1), t: 'Pop-up · 3914 1st · 2359 2nd', x: '3914 optional (can skip) · 2359 must register', type: 'popup', k: ['3914','2359'] },
      { d: U(2027,3,1), t: 'Pop-up (est.) · 3914 must register', x: 'Projected from the 28-day cycle', type: 'popup', k: ['3914'], est: true }
    ]
  };

  var PALETTE = ['#3DD68C', '#D86CF2', '#F5C542', '#4C8DFF', '#FF8A4C', '#2FD4E8'];
  function rgbOf(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var v = parseInt(h, 16); if (isNaN(v) || h.length !== 6) return '154,166,186';
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255].join(',');
  }
  function monthStart(t) { var d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }

  var V = window.KVK = { DAY: DAY, U: U, MON: MON, fd: fd, fw: fw, days: days, source: 'backup' };

  /* Turn sheet rows into everything the pages draw */
  function build(cal) {
    var dates = (cal.dates || []).filter(function (d) { return d.d; }).sort(function (a, b) { return a.d - b.d; });
    var popSet = {}, estSet = {};
    dates.forEach(function (d) { if (d.type === 'popup') { popSet[d.d] = 1; if (d.est) estSet[d.d] = 1; } });
    var pops = Object.keys(popSet).map(Number).sort(function (a, b) { return a - b; });
    var migs = dates.filter(function (d) { return d.type === 'migration'; }).map(function (d, i) {
      return { d: d.d, c: i % 2 ? 'var(--cyan)' : 'var(--blue)', l: 'Migration ' + (i + 1) + ' · ' + fd(d.d) };
    });

    var all = dates.map(function (d) { return d.d; });
    (cal.kingdoms || []).forEach(function (k) { [k.start, k.end, k.buildup].forEach(function (x) { if (x) all.push(x); }); });
    if (!all.length) all = [Date.now()];
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    var R0 = monthStart(min - 10 * DAY), R1 = max + 14 * DAY;

    var K = (cal.kingdoms || []).map(function (k, i) {
      var c = /^#?[0-9a-f]{3,6}$/i.test(k.color || '') ? (k.color.charAt(0) === '#' ? k.color : '#' + k.color) : PALETTE[i % PALETTE.length];
      var after = k.end ? pops.filter(function (p) { return p > k.end; }) : [];
      var opt = after[0] || 0, must = after[1] || 0;
      var segs = [], marks = [];
      if (k.buildup && k.start && k.buildup < k.start) segs.push({ t: 'pre', a: k.buildup, b: k.start, l: 'Migration & build-up' });
      if (k.end) segs.push({ t: 'kvk', a: k.start || R0, b: k.end, open: !k.start ? 1 : 0, l: k.start ? 'KvK (registered ' + fd(k.start) + ')' : 'KvK' });
      if (k.start) marks.push({ t: 'reg', d: k.start });
      if (opt) { segs.push({ t: 'off', a: k.end, b: opt, l: 'Off-season' }); marks.push({ t: 'opt', d: opt }); }
      if (must) { segs.push({ t: 'skip', a: opt, b: must, l: 'Off-season if skipped' }); marks.push({ t: 'must', d: must, est: estSet[must] ? 1 : 0 }); }
      return { id: k.id, name: k.name, sub: k.sub, c: c, rgb: rgbOf(c), segs: segs, marks: marks, end: k.end, opt: opt, must: must, mustEst: !!estSet[must] };
    });

    var KC = { pop: '#F0555A', mig: '#4C8DFF' };
    K.forEach(function (k) { KC[k.id] = k.c; });
    var EVENTS = dates.map(function (d) {
      var g = [];
      if (d.type === 'popup') g.push('pop');
      if (d.type === 'migration') g.push('mig');
      (d.k || []).forEach(function (id) { if (KC[id] && g.indexOf(id) < 0) g.push(id); });
      if (!g.length) g.push('pop');
      return { d: d.d, t: d.t || 'Kingdom date', x: d.x || '', g: g, est: d.est };
    });

    V.R0 = R0; V.R1 = R1; V.POPS = pops; V.EST = pops.filter(function (p) { return estSet[p]; })[0] || null; V.estSet = estSet;
    V.MIGS = migs; V.K = K; V.KC = KC; V.EVENTS = EVENTS;
  }

  V.nextEvent = function (now) { return V.EVENTS.filter(function (e) { return e.d + DAY > now; })[0] || null; };
  V.phaseOf = function (k, now) { for (var i = 0; i < k.segs.length; i++) { var s = k.segs[i]; if (now >= s.a && now < s.b) return s; } return null; };

  /* Kingdom status cards (used on Home and Calendar) */
  V.statusHTML = function (now) {
    if (!V.K.length) return '<div class="st"><div class="st-name">No kingdoms yet</div><div class="st-main">Add kingdoms in the Kingdoms tab of the sheet.</div></div>';
    return V.K.map(function (k, ki) {
      var s = V.phaseOf(k, now), chip, main, pct = null;
      if (!s) {
        var first = k.segs[0];
        if (first && now < first.a) { var dd = Math.ceil((first.a - now) / DAY); chip = 'Preparing'; main = 'Next phase starts <b>' + fd(first.a, true) + '</b> · ' + (dd <= 1 ? 'tomorrow' : 'in ' + dd + ' days'); }
        else if (k.must) { chip = 'Back in the KvK cycle'; main = 'Off-season is over. Registration deadline was <b>' + fd(k.must, true) + '</b>'; }
        else { chip = 'No dates'; main = 'Add this kingdom’s KvK dates in the sheet.'; }
      } else {
        var lft = Math.max(0, Math.ceil((s.b - now) / DAY));
        if (s.t === 'kvk') { chip = 'In KvK'; main = 'KvK ends <b>' + fd(s.b, true) + '</b> · ' + lft + ' days left'; }
        else if (s.t === 'off') { chip = 'Off-season'; main = 'Optional registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
        else if (s.t === 'skip') { chip = 'Off-season · must register'; main = 'Mandatory registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
        else { chip = 'Migration & build-up'; main = 'KvK registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
        if (!s.open) pct = Math.min(100, Math.max(2, (now - s.a) / (s.b - s.a) * 100));
      }
      var up = V.EVENTS.filter(function (e) { return e.d + DAY > now && e.g.indexOf(k.id) > -1; })[0];
      var next = up ? 'Next: ' + up.t + ' · ' + fd(up.d, true) : 'No more dates on this calendar';
      return '<div class="st" style="animation-delay:' + (ki * 0.12) + 's">' +
        '<div class="st-top"><div><div class="st-name" style="color:' + k.c + '">' + Site.esc(k.name) + '</div><div class="st-sub">' + Site.esc(k.sub) + '</div></div>' +
        '<div class="phase" style="color:' + k.c + ';background:rgba(' + k.rgb + ',.14)"><span class="dot"></span>' + chip + '</div></div>' +
        '<div class="st-main">' + main + '</div>' +
        (pct !== null ? '<div class="prog" aria-hidden="true"><i style="width:' + pct.toFixed(1) + '%;background:' + k.c + '"></i></div>' : '') +
        '<div class="st-next">' + Site.esc(next) + '</div></div>';
    }).join('');
  };

  /* Load from the sheet (the backup above is only used if the sheet can't be reached).
     Open pages re-check the sheet every minute and refresh when something changed. */
  var ready = null, lastSig = null;
  function apply(res) {
    var cal = res && res.ok && res.calendar;
    if (!cal) return false;
    build(cal); V.source = 'sheet'; lastSig = JSON.stringify(cal);
    return true;
  }
  function check() {
    if (document.hidden) return;
    Site.api({ action: 'calendar' }).then(function (res) {
      var cal = res && res.ok && res.calendar;
      if (cal && JSON.stringify(cal) !== lastSig) location.reload();
    }).catch(function () {});
  }
  V.init = function () {
    if (ready) return ready;
    ready = Site.api({ action: 'calendar' }).then(apply).catch(function () {}).then(function () {
      setInterval(check, 60000);
      return V;
    });
    return ready;
  };
  V.noNextText = function () { return V.EVENTS.length ? 'All dates complete' : 'No dates yet. Add them in the Calendar tab'; };

  build(DEFAULT);
})();
