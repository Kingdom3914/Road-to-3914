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
    events: '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
    migrate: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    discord: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>'
  };
  function nav() {
    var page = document.body.getAttribute('data-page');
    var links = [['index.html', 'home', 'Home'], ['calendar.html', 'calendar', 'Calendar'], ['events.html', 'events', 'MGE & GH'], ['migration.html', 'migrate', 'Migrate'], ['#discord', 'discord', 'Discord']];
    var el = document.getElementById('site-nav'); if (!el) return;
    var who = session.get(), LOCK = '<svg class="lk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="members only"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    el.innerHTML =
      '<header class="topbar"><div class="wrap">' +
        '<a class="brand" href="index.html"><span class="crest" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18l-2-10-5 4-2-6-2 6-5-4z"/><path d="M5 21h14"/></svg></span>' +
        '<span><b data-text="kingdom_name">' + esc(C.KINGDOM) + '</b><small data-text="tagline">' + esc(C.TAGLINE) + '</small></span></a>' +
        '<nav class="navlinks" aria-label="Main">' + links.map(function (l) {
          if (l[1] === 'discord') return '<a href="#" data-discord target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.discord + '</svg>' + l[2] + '</a>';
          return '<a href="' + l[0] + '"' + (page === l[1] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[l[1]] + '</svg>' + l[2] + (!who && MEMBERS[l[1]] ? LOCK : '') + '</a>';
        }).join('') + '</nav>' +
        (who ? '<div class="who-chip">' + (who.admin ? '<button type="button" class="edit-switch" data-edit-toggle aria-pressed="' + editOn() + '"><span class="knob"></span>Edit mode</button>' : '') +
          '<span><b>' + esc(who.name || 'Governor') + '</b><small>ID ' + esc(who.gov) + '</small></span><button type="button" class="btn ghost sm" data-signout>Sign out</button></div>' : '') +
      '</div></header>' +
      (who && who.admin ? '<div class="edit-banner edit-block"><div class="wrap"><b>Edit mode is on.</b> Click any title or text with a dashed outline to change it. Use the gold buttons to edit dates, news and auctions. <button type="button" class="btn ghost sm" data-edit-discord>Discord link</button></div></div>' : '') +
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
  var MEMBERS = { home: 1, calendar: 1, events: 1 };
  function membersPage() { return !!MEMBERS[document.body.getAttribute('data-page')]; }
  function api(payload) {
    payload = payload || {};
    if (!payload.gov && (membersPage() || /^(admin|textSave)/.test(payload.action || '')) && !/^(apply|login)|^text$/.test(payload.action || '')) {
      var se = session.get(); if (se) { payload.gov = se.gov; payload.pin = se.pin; }
    }
    var req = !C.API_URL ? demoCall(payload) : fetch(C.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload || {})
    }).then(function (r) { return r.json(); });
    return req.then(function (res) {
      if (res && res.text) setText(res.text, true);
      if (res && typeof res.admin === 'boolean') {
        var cur = session.get();
        if (cur && !!cur.admin !== res.admin) { cur.admin = res.admin; store.set('k3914-session', JSON.stringify(cur)); if (!res.admin) setEdit(false); nav(); }
      }
      if (res && res.ok && !res.locked && !res.authError && payload.gov && /^(state|calendar)$/.test(payload.action || '')) {
        store.set('k3914-c-' + payload.action + '-' + payload.gov, JSON.stringify(res));
        if (res.calendar && payload.action !== 'calendar') store.set('k3914-c-calendar-' + payload.gov, JSON.stringify({ ok: true, calendar: res.calendar }));
      }
      if (res && res.locked && payload.action !== 'login') {
        if (session.get()) session.clear();
        lock(res.authError ? 'Your sign-in has expired. Please sign in again.' : '');
        return new Promise(function () {}); /* page stays locked */
      }
      return res;
    });
  }

  /* ---------- members-only lock screen ---------- */
  var PAGE_NAME = { home: 'the kingdom home page', calendar: 'the KvK calendar', events: 'MGE & GH bidding' };
  function lock(msg) {
    var main = document.querySelector('main'), chip = document.querySelector('.who-chip');
    if (chip) chip.parentNode.removeChild(chip);
    if (main) { main.classList.add('locked'); main.setAttribute('aria-hidden', 'true'); main.setAttribute('inert', ''); }
    var box = document.getElementById('lockbox');
    if (!box) {
      box = document.createElement('div'); box.id = 'lockbox'; box.className = 'lockbox';
      box.innerHTML = '<form class="lock-card" id="lockForm" autocomplete="on">' +
        '<div class="lock-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="11" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 15v2.5"/></svg></div>' +
        '<h2>Members only</h2>' +
        '<p>Sign in with your Governor ID and PIN to see ' + esc(PAGE_NAME[document.body.getAttribute('data-page')] || 'this page') + '.</p>' +
        '<div class="field"><label for="lkGov">Governor ID</label><input id="lkGov" name="username" inputmode="numeric" autocomplete="username" required></div>' +
        '<div class="field"><label for="lkPin">PIN</label><input id="lkPin" name="password" type="password" inputmode="numeric" autocomplete="current-password" required></div>' +
        '<div class="err" id="lkErr" role="alert"></div>' +
        '<button class="btn gold" type="submit" id="lkBtn">Sign in</button>' +
        '<div class="lock-links"><span>' + (C.API_URL ? 'No PIN yet? Ask an officer in Discord.' : 'Demo: ID <b>1001</b>, PIN <b>1234</b>') + '</span>' +
        '<a href="migration.html">Not in 3914 yet? Apply to migrate →</a></div></form>';
      document.body.appendChild(box);
      document.getElementById('lockForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var gov = document.getElementById('lkGov').value.trim(), pin = document.getElementById('lkPin').value.trim();
        var btn = document.getElementById('lkBtn'), err = document.getElementById('lkErr');
        if (!gov || !pin) { err.textContent = 'Enter your Governor ID and PIN.'; err.className = 'err on'; return; }
        btn.disabled = true; btn.textContent = 'Signing in…'; err.className = 'err';
        api({ action: 'login', gov: gov, pin: pin }).then(function (res) {
          if (res && res.ok && res.me) { session.set(gov, pin, res.me.name, !!res.me.admin); location.reload(); return; }
          throw new Error((res && (res.authError || res.error)) || 'Wrong governor ID or PIN.');
        }).catch(function (x) {
          err.textContent = x.message || 'Could not sign in. Try again.'; err.className = 'err on';
          btn.disabled = false; btn.textContent = 'Sign in';
        });
      });
    }
    var er = document.getElementById('lkErr');
    if (msg) { er.textContent = msg; er.className = 'err on'; }
    setTimeout(function () { var g = document.getElementById('lkGov'); if (g && !g.value) g.focus(); }, 50);
  }
  function signOut() {
    setEdit(false);
    try { Object.keys(window.localStorage).forEach(function (k) { if (k.indexOf('k3914-c-') === 0) store.del(k); }); } catch (e) {}
    session.clear(); location.reload();
  }
  /* last data this member saw, shown instantly while fresh data loads */
  function cached(action) {
    var se = session.get(); if (!se) return null;
    try { var r = JSON.parse(store.get('k3914-c-' + action + '-' + se.gov) || 'null'); return r && r.ok ? r : null; } catch (e) { return null; }
  }

  /* ---------- editable site text (Site text tab of the sheet) ---------- */
  var text = {}, textHandlers = [];
  function applyText() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-text]'), function (el) {
      var v = text[el.getAttribute('data-text')];
      if (v != null && String(v).trim() !== '') el.textContent = v;
    });
    var dl = String(text.discord_link || C.DISCORD || '').trim();
    Array.prototype.forEach.call(document.querySelectorAll('[data-discord]'), function (a) {
      if (/^https?:[/][/]/i.test(dl)) { a.href = dl; a.removeAttribute('data-nolink'); } else { a.href = '#'; a.setAttribute('data-nolink', ''); }
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
    if (p && p.action !== 'text' && !/^apply/.test(p.action || '')) {
      var g = Core.gate(t, p);
      if (!g.me) return Promise.resolve({ ok: true, locked: true, authError: g.error || '' });
      if (p.action === 'login') return Promise.resolve({ ok: true, me: { name: String(g.me.Name), gov: String(g.me.GovID) } });
    }
    if (p && p.action === 'text') return Promise.resolve({ ok: true });
    if (p && /^apply/.test(p.action || '')) {
      res = p.action === 'applyStart' ? { ok: true, ref: 'DEMO-' + String(now).slice(-5), token: 'demo' } : { ok: true };
      return new Promise(function (resolve) { setTimeout(function () { resolve(res); }, p.action === 'applyImage' ? 350 : 700); });
    }
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
    set: function (gov, pin, name, admin) { store.set('k3914-session', JSON.stringify({ gov: gov, pin: pin, name: name || '', admin: !!admin })); },
    clear: function () { store.del('k3914-session'); }
  };

  /* ================= Edit mode (admins only) ================= */
  function editOn() { var se = session.get(); return !!(se && se.admin && store.get('k3914-edit') === '1'); }
  function setEdit(on) {
    if (on) store.set('k3914-edit', '1'); else store.del('k3914-edit');
    document.body.classList.toggle('edit-on', editOn());
    var b = document.querySelector('[data-edit-toggle]'); if (b) b.setAttribute('aria-pressed', String(editOn()));
  }
  function isoDate(t) { return t ? new Date(t).toISOString().slice(0, 10) : ''; }
  function isoDT(t) { return t ? new Date(t).toISOString().slice(0, 16) : ''; }
  function clearSaved() { try { Object.keys(window.localStorage).forEach(function (k) { if (k.indexOf('k3914-c-') === 0) store.del(k); }); } catch (e) {} }
  function refresh() { clearSaved(); location.reload(); }

  /* Modal shell */
  function modal(title) {
    var old = document.getElementById('mdl'); if (old) old.parentNode.removeChild(old);
    var m = document.createElement('div'); m.id = 'mdl'; m.className = 'mdl-scrim on'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="mdl"><div class="mdl-head"><h2>' + esc(title) + '</h2><button class="btn ghost sm" type="button" data-mdl-close>Close</button></div><div class="mdl-body"></div></div>';
    document.body.appendChild(m);
    function close() { if (m.parentNode) m.parentNode.removeChild(m); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-mdl-close]')) close(); });
    document.addEventListener('keydown', onKey);
    return { el: m, body: m.querySelector('.mdl-body'), title: function (t) { m.querySelector('h2').textContent = t; }, close: close };
  }

  var SWATCHES = ['#3DD68C', '#E8B84A', '#F5C542', '#D86CF2', '#FF8A4C', '#F0555A', '#4C8DFF', '#2FD4E8', '#C2C8D2', '#9B7BFF'];
  /* Form. fields: {key,label,type,value,options(array|fn(values)),required,help,full,placeholder}
     types: text, textarea, select, date, datetime, number, color, checkbox */
  function form(opts, host) {
    var M = host || modal(opts.title);
    if (host) M.title(opts.title);
    var vals = {};
    opts.fields.forEach(function (f) { vals[f.key] = f.value == null ? (f.type === 'checkbox' ? false : '') : f.value; });
    function optList(f) { var o = typeof f.options === 'function' ? f.options(vals) : (f.options || []); return o.map(function (x) { return typeof x === 'object' ? x : { v: x, l: x }; }); }
    function fieldHTML(f) {
      var id = 'f_' + f.key.replace(/[^a-z0-9]/gi, '_'), v = vals[f.key], lab = '<label for="' + id + '">' + esc(f.label) + (f.required ? '' : ' <span class="opt">(optional)</span>') + '</label>', inner;
      if (f.type === 'textarea') inner = '<textarea id="' + id + '" rows="' + (f.rows || 4) + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(v) + '</textarea>';
      else if (f.type === 'select') inner = '<select id="' + id + '">' + optList(f).map(function (o) { return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(v) ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + '</select>';
      else if (f.type === 'checkbox') return '<label class="chk' + (f.full !== false ? ' full' : '') + '"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
      else if (f.type === 'color') inner = '<div class="colorrow"><input type="color" id="' + id + '" value="' + esc(/^#[0-9a-f]{6}$/i.test(v) ? v : '#3DD68C') + '"><input type="text" class="hex" data-hex-for="' + id + '" value="' + esc(v) + '" placeholder="#3DD68C" maxlength="7"></div>' +
        '<div class="swatches">' + SWATCHES.map(function (c) { return '<button type="button" class="sw-btn" data-sw="' + c + '" data-sw-for="' + id + '" style="background:' + c + '" aria-label="' + c + '"></button>'; }).join('') + '</div>';
      else inner = '<input id="' + id + '" type="' + ({ date: 'date', datetime: 'datetime-local', number: 'number' }[f.type] || 'text') + '" value="' + esc(v) + '" placeholder="' + esc(f.placeholder || '') + '"' + (f.max ? ' maxlength="' + f.max + '"' : '') + '>';
      return '<div class="field' + (f.full ? ' full' : '') + '">' + lab + inner + (f.help ? '<small class="help">' + esc(f.help) + '</small>' : '') + '</div>';
    }
    M.body.innerHTML = '<form class="mdl-form" novalidate><div class="mdl-grid">' + opts.fields.map(fieldHTML).join('') + '</div><div class="mdl-err" role="alert"></div>' +
      '<div class="mdl-actions">' + (opts.onDelete ? '<button class="btn red sm" type="button" data-del>Delete</button>' : '') + '<span style="flex:1"></span>' +
      (opts.onBack ? '<button class="btn ghost sm" type="button" data-back>Back</button>' : '') + '<button class="btn gold sm" type="submit">' + esc(opts.saveLabel || 'Save') + '</button></div></form>';
    var F = M.body.querySelector('form'), err = F.querySelector('.mdl-err');
    function showErr(m) { err.textContent = m || ''; err.className = 'mdl-err' + (m ? ' on' : ''); }
    function read() {
      opts.fields.forEach(function (f) {
        var el = document.getElementById('f_' + f.key.replace(/[^a-z0-9]/gi, '_')); if (!el) return;
        vals[f.key] = f.type === 'checkbox' ? el.checked : f.type === 'color' ? (F.querySelector('[data-hex-for="' + el.id + '"]').value.trim() || '') : el.value;
      });
    }
    F.addEventListener('input', function (e) {
      if (e.target.type === 'color') { F.querySelector('[data-hex-for="' + e.target.id + '"]').value = e.target.value.toUpperCase(); }
      if (e.target.classList.contains('hex') && /^#[0-9a-f]{6}$/i.test(e.target.value)) document.getElementById(e.target.getAttribute('data-hex-for')).value = e.target.value;
    });
    F.addEventListener('change', function () {
      read();
      opts.fields.forEach(function (f) {
        if (f.type !== 'select' || typeof f.options !== 'function') return;
        var el = document.getElementById('f_' + f.key.replace(/[^a-z0-9]/gi, '_')), list = optList(f);
        if (!list.some(function (o) { return String(o.v) === String(vals[f.key]); })) vals[f.key] = list.length ? list[0].v : '';
        el.innerHTML = list.map(function (o) { return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(vals[f.key]) ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('');
      });
    });
    F.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-sw]');
      if (sw) { var id = sw.getAttribute('data-sw-for'); document.getElementById(id).value = sw.getAttribute('data-sw'); F.querySelector('[data-hex-for="' + id + '"]').value = sw.getAttribute('data-sw'); }
      if (e.target.closest('[data-back]')) opts.onBack();
      var d = e.target.closest('[data-del]');
      if (d) {
        if (!d.getAttribute('data-armed')) { d.setAttribute('data-armed', '1'); d.textContent = 'Tap again to delete'; return; }
        busy(d, opts.onDelete());
      }
    });
    function busy(btn, p) {
      var label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…'; showErr('');
      Promise.resolve(p).then(function (res) {
        if (res && res.ok === false) throw new Error(res.error || 'Could not save.');
        if (opts.after) opts.after(res, M); else refresh();
      }).catch(function (x) { showErr(x.message || 'Could not save.'); btn.disabled = false; btn.textContent = label; });
    }
    F.addEventListener('submit', function (e) {
      e.preventDefault(); read();
      var miss = opts.fields.filter(function (f) { return f.required && f.type !== 'checkbox' && !String(vals[f.key]).trim(); })[0];
      if (miss) { showErr(miss.label + ' is required.'); return; }
      var problem = opts.check && opts.check(vals); if (problem) { showErr(problem); return; }
      busy(F.querySelector('[type=submit]'), opts.onSave(vals));
    });
    setTimeout(function () { var first = F.querySelector('input:not([type=checkbox]):not([type=color]),select,textarea'); if (first) first.focus(); }, 40);
    return M;
  }

  /* List of rows from one sheet tab, each with Edit, plus Add. Saves straight to the sheet. */
  function manager(o) {
    var M = modal(o.title);
    function list() {
      M.title(o.title);
      M.body.innerHTML = '<div class="mdl-bar"><span>' + esc(o.intro || 'Changes save straight to the kingdom sheet.') + '</span><button class="btn gold sm" type="button" data-add>+ ' + esc(o.addLabel || 'Add') + '</button></div><div class="mdl-list"><div class="empty">Loading…</div></div>';
      M.body.querySelector('[data-add]').onclick = function () { edit(null); };
      api({ action: 'adminLoad', tab: o.tab }).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Could not load.');
        var rows = res.rows.slice(); if (o.sort) rows.sort(o.sort);
        M.rows = rows;
        M.body.querySelector('.mdl-list').innerHTML = rows.length ? rows.map(function (r, i) {
          var L = o.label(r.v);
          return '<div class="mdl-row"><span class="kdot" style="background:' + esc(L.color || '#5B6476') + '"></span><div class="t"><b>' + esc(L.t) + '</b><span>' + esc(L.sub || '') + '</span></div><button class="btn ghost sm" type="button" data-edit="' + i + '">Edit</button></div>';
        }).join('') : '<div class="empty">Nothing here yet. Use “+ ' + esc(o.addLabel || 'Add') + '”.</div>';
      }).catch(function (x) { M.body.querySelector('.mdl-list').innerHTML = '<div class="empty"><b>Couldn’t load</b>' + esc(x.message) + '</div>'; });
    }
    function edit(r) {
      form({
        title: r ? (o.editTitle ? o.editTitle(r.v) : 'Edit') : (o.addTitle || 'Add'),
        fields: o.fields(r ? r.v : (o.defaults ? o.defaults() : {})),
        check: o.check,
        onBack: list,
        onSave: function (v) { return api({ action: 'adminSave', tab: o.tab, row: r ? r.r : 0, sig: r ? r.sig : '', values: o.toSheet ? o.toSheet(v) : v }); },
        onDelete: r && o.canDelete !== false ? function () { return api({ action: 'adminDelete', tab: o.tab, row: r.r, sig: r.sig }); } : null
      }, M);
    }
    M.body.addEventListener('click', function (e) { var b = e.target.closest('[data-edit]'); if (b && M.rows) edit(M.rows[Number(b.getAttribute('data-edit'))]); });
    list();
    return M;
  }

  /* Save Site text keys: items = { key: text } */
  function saveText(items) {
    return api({ action: 'textSave', items: items }).then(function (res) { if (res && res.ok && res.text) setText(res.text, true); return res; });
  }

  /* Click any [data-text] while Edit mode is on to change it */
  document.addEventListener('click', function (e) {
    if (!document.body.classList.contains('edit-on')) return;
    var el = e.target.closest && e.target.closest('[data-text]');
    if (!el || el.closest('.mdl-scrim')) return;
    e.preventDefault(); e.stopPropagation();
    var key = el.getAttribute('data-text'), long = el.textContent.length > 60;
    form({ title: 'Edit text', fields: [{ key: 'v', label: 'Text', type: long ? 'textarea' : 'text', value: (text[key] != null && String(text[key]).trim() !== '') ? text[key] : el.textContent, required: true, full: true, help: 'Shown on the website straight away.' }],
      onSave: function (v) { return saveText((function () { var o = {}; o[key] = v.v; return o; })()); },
      after: function (res, M) { M.close(); toast('Saved', 'The text has been updated.', 'good'); } });
  }, true);
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-edit-toggle]')) { setEdit(!editOn()); toast(editOn() ? 'Edit mode on' : 'Edit mode off', editOn() ? 'Dashed outlines and gold buttons can be edited.' : 'The website is back to normal view.'); }
    if (e.target.closest && e.target.closest('[data-edit-discord]')) {
      form({ title: 'Discord invite link', fields: [{ key: 'v', label: 'Invite link', value: text.discord_link || '', placeholder: 'https://discord.gg/…', full: true, help: 'Leave empty to hide the Join Discord buttons.' }],
        check: function (v) { return v.v && !/^https?:[/][/]/i.test(v.v.trim()) ? 'The link must start with https://' : ''; },
        onSave: function (v) { return saveText({ discord_link: v.v.trim() }); },
        after: function (res, M) { M.close(); toast('Saved', 'Discord link updated.', 'good'); } });
    }
  });

  window.Site = { onText: onText, esc: esc, n: n, date: date, dateTime: dateTime, ago: ago, left: left, shortLeft: shortLeft, pad: pad, store: store, toast: toast, api: api, session: session, signOut: signOut, cached: cached,
    isAdmin: function () { var se = session.get(); return !!(se && se.admin); }, editOn: editOn, form: form, manager: manager, modal: modal, saveText: saveText, refresh: refresh, isoDate: isoDate, isoDT: isoDT, config: C, demo: !C.API_URL };
  nav();
  if (editOn()) document.body.classList.add('edit-on');
  if (membersPage() && !session.get()) {
    if (document.querySelector('main')) lock(''); else document.addEventListener('DOMContentLoaded', function () { lock(''); });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-discord][data-nolink]');
    if (a) { e.preventDefault(); toast('Discord link coming soon', 'Leadership will add the invite link shortly.'); }
    if (e.target.closest && e.target.closest('[data-signout]')) signOut();
  });
  try { var cached = JSON.parse(store.get('k3914-text') || 'null'); if (cached) setText(cached, false); } catch (e) {}
  document.addEventListener('DOMContentLoaded', applyText);
})();
