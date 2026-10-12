/* Shared navigation, helpers and the connection to the Google Sheet backend */
(function () {
  "use strict";
  var C = window.CONFIG || {};
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function n(v) { return Number(v || 0).toLocaleString('en-US'); }
  function pad(v) { return String(v).padStart(2, '0'); }
  function date(t) { var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function dateTime(t) { var d = new Date(t); return date(t) + ' · ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'; }
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }
  function left(ms) {
    ms = Math.max(0, ms);
    return { d: Math.floor(ms / 86400000), h: Math.floor(ms % 86400000 / 3600000), m: Math.floor(ms % 3600000 / 60000), s: Math.floor(ms % 60000 / 1000) };
  }
  function shortLeft(ms) {
    var l = left(ms);
    return l.d > 0 ? l.d + 'd ' + l.h + 'h' : l.h > 0 ? l.h + 'h ' + l.m + 'm' : l.m + 'm ' + l.s + 's';
  }

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  };

  /* ---------- navigation ---------- */
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    events: '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>'
  };
  function nav() {
    var page = document.body.getAttribute('data-page');
    var links = [['index.html', 'home', 'Home'], ['calendar.html', 'calendar', 'Calendar'], ['events.html', 'events', 'MGE & GH']];
    var el = document.getElementById('site-nav'); if (!el) return;
    el.innerHTML =
      '<header class="topbar"><div class="wrap">' +
        '<a class="brand" href="index.html"><span class="crest" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18l-2-10-5 4-2-6-2 6-5-4z"/><path d="M5 21h14"/></svg></span>' +
        '<span><b data-text="kingdom_name">' + esc(C.KINGDOM) + '</b><small data-text="tagline">' + esc(C.TAGLINE) + '</small></span></a>' +
        '<nav class="navlinks" aria-label="Main">' + links.map(function (l) {
          return '<a href="' + l[0] + '"' + (page === l[1] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[l[1]] + '</svg>' + l[2] + '</a>';
        }).join('') + '</nav>' +
      '</div></header>' +
      (C.API_URL ? '' : '<div class="demo-banner"><div class="wrap"><b>Demo mode:</b> showing sample data. Bids are saved only on this device until the Google Sheet link is added in config.js.</div></div>');
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(title, body, kind, action) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.className = 'toast on' + (kind ? ' ' + kind : '');
    t.innerHTML = '<b>' + esc(title) + '</b>' + esc(body || '') + (action ? '<button class="btn gold sm" type="button">' + esc(action.label) + '</button>' : '');
    if (action) t.querySelector('button').onclick = function () { t.className = 'toast'; action.fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, action ? 9000 : 4000);
  }

  /* ---------- backend connection ---------- */
  function api(payload) {
    var req = !C.API_URL ? demoCall(payload) : fetch(C.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload || {})
    }).then(function (r) { return r.json(); });
    return req.then(function (res) { if (res && res.text) setText(res.text, true); return res; });
  }

  /* ---------- editable site text (Site text tab of the sheet) ---------- */
  var text = {}, textHandlers = [];
  function applyText() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-text]'), function (el) {
      var v = text[el.getAttribute('data-text')];
      if (v != null && String(v).trim() !== '') el.textContent = v;
    });
    if (text.kingdom_name) document.title = document.title.replace(/^[^·]+·/, text.kingdom_name + ' ·');
    textHandlers.forEach(function (fn) { try { fn(text); } catch (e) {} });
  }
  function setText(map, save) {
    text = map || {};
    if (save) store.set('k3914-text', JSON.stringify(text));
    applyText();
  }
  function onText(fn) { textHandlers.push(fn); try { fn(text); } catch (e) {} }

  /* ---------- demo backend (sample data, saved on this device) ---------- */
  var demo = null;
  function demoTables() {
    if (demo) return demo;
    var now = Date.now(), H = 3600000, D = 86400000;
    var mgeRewards = [180,90,60,45,30,20,15,12,10,8,6,5,4,3,2].map(function (x) { return x + ' sculptures'; }).join('|');
    demo = {
      players: [
        { GovID: '1001', Name: 'SBA', Alliance: 'RB3', PIN: '1234', Role: 'admin' },
        { GovID: '1002', Name: 'Marsinvasion', Alliance: 'RB3', PIN: '1234' },
        { GovID: '1003', Name: 'Multiverse', Alliance: 'RB3', PIN: '1234' },
        { GovID: '1004', Name: 'Kaelen', Alliance: 'RB3', PIN: '1234' },
        { GovID: '1005', Name: 'Thorne', Alliance: 'RB3', PIN: '1234' }
      ],
      credits: [
        { Date: now - 9 * D, GovID: '1001', Amount: 2000, Reason: 'Starting credits' },
        { Date: now - 3 * D, GovID: '1001', Amount: 450, Reason: 'KvK contribution' },
        { Date: now - 2 * D, GovID: '1001', Amount: -100, Reason: 'Penalty · missed rally' },
        { Date: now - 9 * D, GovID: '1002', Amount: 2200, Reason: 'Starting credits' },
        { Date: now - 9 * D, GovID: '1003', Amount: 1800, Reason: 'Starting credits' },
        { Date: now - 9 * D, GovID: '1004', Amount: 1600, Reason: 'Starting credits' },
        { Date: now - 9 * D, GovID: '1005', Amount: 1400, Reason: 'Starting credits' }
      ],
      events: [
        { EventID: 'MGE-01', Type: 'MGE', Title: 'MGE · Infantry week', Subject: '[Commander name]', Opens: now - D, Closes: now + 2 * D + 5 * H, Ranks: 15, Increment: 50, Rewards: mgeRewards, Minimums: '1000|700|500|400|300|200|150|120|100|80|60|50|40|30|20', Status: 'open' },
        { EventID: 'GH-01', Type: 'GH', Title: 'GH bidding', Subject: '[What is being bid on]', Opens: now - 6 * H, Closes: now + D + 3 * H, Ranks: 10, Increment: 50, Rewards: '[Rank 1 reward]|[Rank 2 reward]|[Rank 3 reward]|[Rank 4 reward]|[Rank 5 reward]|[Rank 6 reward]|[Rank 7 reward]|[Rank 8 reward]|[Rank 9 reward]|[Rank 10 reward]', Minimums: '500|400|300|250|200|150|120|100|80|60', Status: 'open' }
      ],
      bids: [
        { Timestamp: now - 20 * H, EventID: 'MGE-01', Rank: 1, GovID: '1004', Name: 'Kaelen', Amount: 1100 },
        { Timestamp: now - 11 * H, EventID: 'MGE-01', Rank: 1, GovID: '1002', Name: 'Marsinvasion', Amount: 1250 },
        { Timestamp: now - 9 * H, EventID: 'MGE-01', Rank: 2, GovID: '1003', Name: 'Multiverse', Amount: 750 },
        { Timestamp: now - 5 * H, EventID: 'MGE-01', Rank: 3, GovID: '1005', Name: 'Thorne', Amount: 500 },
        { Timestamp: now - 3 * H, EventID: 'MGE-01', Rank: 4, GovID: '1004', Name: 'Kaelen', Amount: 400 },
        { Timestamp: now - 2 * H, EventID: 'GH-01', Rank: 1, GovID: '1003', Name: 'Multiverse', Amount: 500 },
        { Timestamp: now - 40 * 60000, EventID: 'GH-01', Rank: 2, GovID: '1005', Name: 'Thorne', Amount: 400 }
      ],
      news: [
        { Date: now - 1 * D, Type: 'Announcement', Title: 'Migration 1 opens 21 Oct', Body: 'Prepare your passports and resources. Contact SBA, Marsinvasion or Multiverse before you move.', Pinned: 'yes' },
        { Date: now - 2 * D, Type: 'Announcement', Title: 'MGE bidding is now on the website', Body: 'Sign in with your governor ID and PIN to see your credits and place bids.', Pinned: '' },
        { Date: now - 5 * H, Type: 'News', Title: 'Kingdom 3914 registers for KvK on 9 Nov', Body: 'All governors should be settled and shielded before registration.', Pinned: '' },
        { Date: now - 3 * D, Type: 'News', Title: 'Recruitment: 20–30 spots left', Body: 'Know a strong player? Send them our way.', Pinned: '' }
      ]
    };
    var saved = store.get('k3914-demo-extra-bids');
    if (saved) { try { demo.bids = demo.bids.concat(JSON.parse(saved)); } catch (e) {} }
    return demo;
  }
  function demoCall(p) {
    var t = demoTables(), now = Date.now(), res;
    if (p && p.action === 'bid') {
      var c = Core.checkBid(t, p, now);
      if (c.error) res = { ok: false, error: c.error };
      else {
        c.row.Timestamp = now; t.bids.push(c.row);
        var extra = []; try { extra = JSON.parse(store.get('k3914-demo-extra-bids') || '[]'); } catch (e) {}
        extra.push(c.row); store.set('k3914-demo-extra-bids', JSON.stringify(extra));
        res = Core.state(t, p, now); res.message = 'Bid placed on ' + c.type + ' rank #' + c.rank + '.';
      }
    } else res = Core.state(t, p || {}, now);
    return new Promise(function (resolve) { setTimeout(function () { resolve(JSON.parse(JSON.stringify(res))); }, 250); });
  }

  /* ---------- signed-in governor (kept on this device) ---------- */
  var session = {
    get: function () { var s = store.get('k3914-session'); try { return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    set: function (gov, pin) { store.set('k3914-session', JSON.stringify({ gov: gov, pin: pin })); },
    clear: function () { store.del('k3914-session'); }
  };

  window.Site = { onText: onText, esc: esc, n: n, date: date, dateTime: dateTime, ago: ago, left: left, shortLeft: shortLeft, pad: pad, store: store, toast: toast, api: api, session: session, config: C, demo: !C.API_URL };
  nav();
  try { var cached = JSON.parse(store.get('k3914-text') || 'null'); if (cached) setText(cached, false); } catch (e) {}
  document.addEventListener('DOMContentLoaded', applyText);
})();
