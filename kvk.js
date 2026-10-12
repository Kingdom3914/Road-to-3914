/* KvK, migration and off-season dates — edit dates here and both Home and Calendar update */
(function () {
  "use strict";
  var DAY = 86400000;
  function U(y, m, d) { return Date.UTC(y, m - 1, d); }
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function fd(t, y) { var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + (y ? ' ' + d.getUTCFullYear() : ''); }
  function fw(t) { var d = new Date(t); return WD[d.getUTCDay()] + ' ' + fd(t, true); }
  function days(a, b) { return Math.round((b - a) / DAY); }

  var R0 = U(2026, 8, 1), R1 = U(2027, 3, 15);
  var POPS = [U(2026,8,17), U(2026,9,14), U(2026,10,12), U(2026,11,9), U(2026,12,7), U(2027,1,4), U(2027,2,1), U(2027,3,1)];
  var EST = U(2027, 3, 1);
  var MIGS = [{ d: U(2026,10,21), c: 'var(--blue)', l: 'Migration 1 · 21 Oct' }, { d: U(2027,1,15), c: 'var(--cyan)', l: 'Migration 2 · 15 Jan' }];

  var K = [
    { id: '1875', name: 'Kingdom 1875', sub: 'Current KvK', c: '#F5C542', rgb: '245,197,66',
      segs: [{ t: 'kvk', a: R0, b: U(2026,10,20), open: 1, l: 'KvK' }, { t: 'off', a: U(2026,10,20), b: U(2026,11,9), l: 'Off-season' }, { t: 'skip', a: U(2026,11,9), b: U(2026,12,7), l: 'Off-season if skipped' }],
      marks: [{ t: 'opt', d: U(2026,11,9) }, { t: 'must', d: U(2026,12,7) }], end: U(2026,10,20), opt: U(2026,11,9), must: U(2026,12,7) },
    { id: '2359', name: 'Kingdom 2359', sub: 'KvK league', c: '#D86CF2', rgb: '216,108,242',
      segs: [{ t: 'kvk', a: U(2026,10,12), b: U(2026,12,17), l: 'KvK (registered 12 Oct)' }, { t: 'off', a: U(2026,12,17), b: U(2027,1,4), l: 'Off-season' }, { t: 'skip', a: U(2027,1,4), b: U(2027,2,1), l: 'Off-season if skipped' }],
      marks: [{ t: 'reg', d: U(2026,10,12) }, { t: 'opt', d: U(2027,1,4) }, { t: 'must', d: U(2027,2,1) }], end: U(2026,12,17), opt: U(2027,1,4), must: U(2027,2,1) },
    { id: '3914', name: 'Kingdom 3914', sub: 'Our new home', c: '#3DD68C', rgb: '61,214,140',
      segs: [{ t: 'pre', a: U(2026,10,21), b: U(2026,11,9), l: 'Migration & build-up' }, { t: 'kvk', a: U(2026,11,9), b: U(2027,1,14), l: 'KvK (registered 9 Nov)' }, { t: 'off', a: U(2027,1,14), b: U(2027,2,1), l: 'Off-season' }, { t: 'skip', a: U(2027,2,1), b: U(2027,3,1), l: 'Off-season if skipped' }],
      marks: [{ t: 'reg', d: U(2026,11,9) }, { t: 'opt', d: U(2027,2,1) }, { t: 'must', d: U(2027,3,1), est: 1 }], end: U(2027,1,14), opt: U(2027,2,1), must: U(2027,3,1) }
  ];
  var KC = { '1875': '#F5C542', '2359': '#D86CF2', '3914': '#3DD68C', pop: '#F0555A', mig: '#4C8DFF' };

  var EVENTS = [
    { d: U(2026,8,17), t: 'KvK pop-up', x: 'Registration window', g: ['pop'] },
    { d: U(2026,9,14), t: 'KvK pop-up', x: 'Registration window', g: ['pop'] },
    { d: U(2026,10,12), t: 'Pop-up · 2359 registers', x: '2359 signs up for KvK', g: ['pop','2359'] },
    { d: U(2026,10,20), t: '1875 KvK ends', x: '1875 enters off-season', g: ['1875'] },
    { d: U(2026,10,21), t: 'Migration 1 → 3914', x: 'First migration window into 3914', g: ['mig'] },
    { d: U(2026,11,9), t: 'Pop-up · 3914 registers', x: '3914 signs up for KvK · 1875 may register or skip', g: ['pop','3914','1875'] },
    { d: U(2026,12,7), t: 'Pop-up · 1875 must register', x: '2nd pop-up after its KvK, so registration is mandatory', g: ['pop','1875'] },
    { d: U(2026,12,17), t: '2359 KvK ends', x: '2359 enters off-season', g: ['2359'] },
    { d: U(2027,1,4), t: 'Pop-up · 2359 1st registration', x: 'Optional: 2359 may register or skip', g: ['pop','2359'] },
    { d: U(2027,1,14), t: '3914 KvK ends', x: '3914 enters off-season', g: ['3914'] },
    { d: U(2027,1,15), t: 'Migration 2 → 3914', x: 'Second migration window into 3914', g: ['mig'] },
    { d: U(2027,2,1), t: 'Pop-up · 3914 1st · 2359 2nd', x: '3914 optional (can skip) · 2359 must register', g: ['pop','3914','2359'] },
    { d: U(2027,3,1), t: 'Pop-up (est.) · 3914 must register', x: 'Projected from the 28-day cycle', g: ['pop','3914'] }
  ];

  function nextEvent(now) { return EVENTS.filter(function (e) { return e.d + DAY > now; })[0] || null; }
  function phaseOf(k, now) { for (var i = 0; i < k.segs.length; i++) { var s = k.segs[i]; if (now >= s.a && now < s.b) return s; } return null; }

  /* Kingdom status cards (used on Home and Calendar) */
  function statusHTML(now) {
    return K.map(function (k, ki) {
      var s = phaseOf(k, now), chip, main, pct = null;
      if (!s) {
        var first = k.segs[0];
        if (now < first.a) { var dd = Math.ceil((first.a - now) / DAY); chip = 'Preparing'; main = 'Next phase starts <b>' + fd(first.a, true) + '</b> · ' + (dd <= 1 ? 'tomorrow' : 'in ' + dd + ' days'); }
        else { chip = 'Back in the KvK cycle'; main = 'Off-season is over. Registration deadline was <b>' + fd(k.must, true) + '</b>'; }
      } else {
        var lft = Math.max(0, Math.ceil((s.b - now) / DAY));
        if (s.t === 'kvk') { chip = 'In KvK'; main = 'KvK ends <b>' + fd(s.b, true) + '</b> · ' + lft + ' days left'; }
        else if (s.t === 'off') { chip = 'Off-season'; main = 'Optional registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
        else if (s.t === 'skip') { chip = 'Off-season · must register'; main = 'Mandatory registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
        else { chip = 'Migration & build-up'; main = 'KvK registration <b>' + fd(s.b, true) + '</b> · in ' + lft + ' days'; }
        if (!s.open) pct = Math.min(100, Math.max(2, (now - s.a) / (s.b - s.a) * 100));
      }
      var up = EVENTS.filter(function (e) { return e.d + DAY > now && e.g.indexOf(k.id) > -1; })[0];
      var next = up ? 'Next: ' + up.t + ' · ' + fd(up.d, true) : 'No more dates on this calendar';
      return '<div class="st" style="animation-delay:' + (ki * 0.12) + 's">' +
        '<div class="st-top"><div><div class="st-name" style="color:' + k.c + '">' + k.name + '</div><div class="st-sub">' + k.sub + '</div></div>' +
        '<div class="phase" style="color:' + k.c + ';background:rgba(' + k.rgb + ',.14)"><span class="dot"></span>' + chip + '</div></div>' +
        '<div class="st-main">' + main + '</div>' +
        (pct !== null ? '<div class="prog" aria-hidden="true"><i style="width:' + pct.toFixed(1) + '%;background:' + k.c + '"></i></div>' : '') +
        '<div class="st-next">' + next + '</div></div>';
    }).join('');
  }

  window.KVK = { DAY: DAY, U: U, MON: MON, fd: fd, fw: fw, days: days, R0: R0, R1: R1, POPS: POPS, EST: EST, MIGS: MIGS, K: K, KC: KC, EVENTS: EVENTS, nextEvent: nextEvent, phaseOf: phaseOf, statusHTML: statusHTML };
})();
