/* Built 2026-11-12T00:45Z — deployed automatically from GitHub (server/ folder) */
/* ============================================================
   Kingdom 3914 — bidding & credits logic
   The same code runs in the Google Apps Script backend (Code.gs)
   and in the website's demo mode, so both follow identical rules.
   ============================================================ */
var Core = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) { var x = Number(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(x) ? 0 : x; }
  function toTime(v) {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    var t = Date.parse(v); return isNaN(t) ? 0 : t;
  }
  function splitList(v) {
    var s = str(v); if (!s) return [];
    return s.split(s.indexOf('|') > -1 ? '|' : ',').map(function (x) { return x.trim(); });
  }
  function isValid(b) { return str(b.Status).toLowerCase() !== 'cancelled'; }
  function fmt(v) { return Number(v).toLocaleString('en-US'); }

  /* Build every event with its ranks, leaders and bid counts */
  function events(t, now) {
    return t.events.filter(function (e) {
      return str(e.EventID) && str(e.Status).toLowerCase() !== 'draft';
    }).map(function (e) {
      var count = Math.max(1, Math.min(50, num(e.Ranks) || 15));
      var rewards = splitList(e.Rewards), mins = splitList(e.Minimums).map(num);
      var opens = toTime(e.Opens), closes = toTime(e.Closes), st = str(e.Status).toLowerCase();
      var phase = (st === 'closed' || (closes && now >= closes)) ? 'closed'
                : (opens && now < opens) ? 'upcoming' : 'open';
      var ranks = [];
      for (var i = 0; i < count; i++) {
        ranks.push({
          rank: i + 1, reward: rewards[i] || '',
          min: mins.length ? (i < mins.length ? mins[i] : mins[mins.length - 1]) : 0,
          bid: 0, leader: '', leaderId: '', count: 0, bidders: {}
        });
      }
      var people = {}, total = 0;
      t.bids.forEach(function (b) {
        if (str(b.EventID) !== str(e.EventID) || !isValid(b)) return;
        var r = ranks[num(b.Rank) - 1]; if (!r) return;
        var a = num(b.Amount), g = str(b.GovID);
        r.count++; total++; people[g] = 1;
        r.bidders[g] = Math.max(r.bidders[g] || 0, a);
        if (a > r.bid) { r.bid = a; r.leader = str(b.Name); r.leaderId = g; }
      });
      return {
        id: str(e.EventID), type: str(e.Type).toUpperCase() || 'MGE', title: str(e.Title),
        subject: str(e.Subject), opens: opens, closes: closes, phase: phase,
        increment: num(e.Increment) || 50, ranks: ranks,
        bidders: Object.keys(people).length, bids: total
      };
    });
  }

  /* A player's credits: received − spent (won ranks) − reserved (leading bids) */
  function balance(gov, evs, t) {
    var received = 0, ledger = [];
    t.credits.forEach(function (c) {
      if (str(c.GovID) !== gov) return;
      var hasBal = c.Balance !== undefined;
      var a = hasBal ? num(c.Balance) : num(c.Amount); received += a;
      ledger.push({ time: hasBal ? 0 : toTime(c.Date), amount: a, reason: hasBal ? 'Credits from leadership' : str(c.Reason) });
    });
    var spent = 0, reserved = 0, positions = [];
    evs.forEach(function (ev) {
      ev.ranks.forEach(function (r) {
        var mine = r.bidders[gov];
        if (r.leaderId === gov) {
          if (ev.phase === 'closed') {
            spent += r.bid;
            ledger.push({ time: ev.closes, amount: -r.bid, reason: ev.type + ' rank #' + r.rank + ' won' + (ev.title ? ' · ' + ev.title : '') });
          } else reserved += r.bid;
        }
        if (mine && ev.phase !== 'closed') {
          positions.push({ event: ev.id, type: ev.type, rank: r.rank, myBid: mine, bid: r.bid, leading: r.leaderId === gov });
        }
      });
    });
    ledger.sort(function (a, b) { return b.time - a.time; });
    return { received: received, spent: spent, reserved: reserved, available: received - spent - reserved, ledger: ledger.slice(0, 40), positions: positions };
  }

  function auth(t, gov, pin) {
    gov = str(gov); pin = str(pin);
    if (!gov || !pin) return null;
    for (var i = 0; i < t.players.length; i++) {
      var p = t.players[i];
      if (str(p.GovID) === gov && str(p.PIN) === pin) return p;
    }
    return null;
  }

  /* Members-only pages: who is signed in? {me} | {} (no login) | {error} */
  function gate(t, p) {
    if (!p || !str(p.gov) || !str(p.pin)) return {};
    var me = auth(t, p.gov, p.pin);
    return me ? { me: me } : { error: 'Wrong governor ID or PIN.' };
  }

  /* Everything the website needs in one response */
  function state(t, p, now) {
    var evs = events(t, now);
    var out = { ok: true, now: now, events: [], feed: [], news: [], me: null };
    var me = null;
    if (p && str(p.gov)) {
      me = auth(t, p.gov, p.pin);
      if (!me) out.authError = 'Wrong governor ID or PIN.';
    }
    var gov = me ? str(me.GovID) : '';
    if (me) {
      var b = balance(gov, evs, t);
      out.me = {
        gov: gov, name: str(me.Name), alliance: str(me.Alliance), role: str(me.Role).toLowerCase(),
        received: b.received, spent: b.spent, reserved: b.reserved, available: b.available,
        ledger: b.ledger, positions: b.positions
      };
    }
    out.events = evs.filter(function (ev) {
      return ev.phase !== 'closed' || now - ev.closes < 14 * 86400000;
    }).map(function (ev) {
      return {
        id: ev.id, type: ev.type, title: ev.title, subject: ev.subject, opens: ev.opens, closes: ev.closes,
        phase: ev.phase, increment: ev.increment, bidders: ev.bidders, bids: ev.bids,
        ranks: ev.ranks.map(function (r) {
          return {
            rank: r.rank, reward: r.reward, min: r.min, bid: r.bid, leader: r.leader, count: r.count,
            mine: gov ? (r.leaderId === gov ? 'leading' : (r.bidders[gov] ? 'outbid' : '')) : ''
          };
        })
      };
    });
    var typeOf = {}; evs.forEach(function (ev) { typeOf[ev.id] = ev.type; });
    out.feed = t.bids.filter(isValid).slice(-30).reverse().map(function (b) {
      return { name: str(b.Name), type: typeOf[str(b.EventID)] || '', event: str(b.EventID), rank: num(b.Rank), amount: num(b.Amount), time: toTime(b.Timestamp) };
    });
    out.news = t.news.filter(function (x) { return str(x.Title) || str(x.Body); }).map(function (x) {
      return { time: toTime(x.Date), type: str(x.Type) || 'News', title: str(x.Title), body: str(x.Body), pinned: /^(y|yes|true|1|x)$/i.test(str(x.Pinned)) };
    }).sort(function (a, b) { return (b.pinned - a.pinned) || (b.time - a.time); }).slice(0, 30);
    return out;
  }

  /* Check a bid against every rule. Returns {error} or {row} to save. */
  function checkBid(t, p, now) {
    var me = auth(t, p.gov, p.pin);
    if (!me) return { error: 'Wrong governor ID or PIN.' };
    var gov = str(me.GovID), amount = Math.floor(num(p.amount));
    if (!(amount > 0)) return { error: 'Enter a valid amount.' };
    var evs = events(t, now), ev = null;
    evs.forEach(function (e) { if (e.id === str(p.event)) ev = e; });
    if (!ev) return { error: 'Event not found.' };
    if (ev.phase === 'upcoming') return { error: 'Bidding has not opened yet.' };
    if (ev.phase === 'closed') return { error: 'Bidding is closed for this event.' };
    var r = ev.ranks[num(p.rank) - 1];
    if (!r) return { error: 'That rank does not exist.' };
    var need = r.bid > 0 ? Math.max(r.min, r.bid + ev.increment) : Math.max(r.min, 1);
    if (amount < need) return { error: (r.bid > 0 ? 'Minimum for rank #' + r.rank + ' is now ' : 'Minimum bid for rank #' + r.rank + ' is ') + fmt(need) + '.' };
    var b = balance(gov, evs, t);
    var avail = b.available + (r.leaderId === gov ? r.bid : 0);
    if (amount > avail) return { error: 'Not enough credits. You have ' + fmt(avail) + ' available for this rank.' };
    return {
      row: { Timestamp: new Date(now), EventID: ev.id, Rank: r.rank, GovID: gov, Name: str(me.Name), Amount: amount, Status: 'valid' },
      rank: r.rank, type: ev.type
    };
  }

  /* Calendar data: dates (Calendar tab), kingdoms (Kingdoms tab), event types and the view range */
  function calendar(t) {
    var yes = /^(y|yes|true|1|x)$/i;
    var ds = (t.calendar || []).filter(function (d) { return str(d.Event); }).map(function (d) {
      return { e: str(d.Event), a: toTime(d.Start), b: toTime(d.End), x: str(d.Details), est: yes.test(str(d.Estimated)), r: d._row || 0 };
    });
    var ks = (t.kingdoms || []).filter(function (k) { return str(k.Kingdom); }).map(function (k) {
      return { id: str(k.Kingdom), name: str(k.Name) || ('Kingdom ' + str(k.Kingdom)), color: str(k.Color),
        start: toTime(k['KvK start']), end: toTime(k['KvK end']), buildup: toTime(k['Build-up from']) };
    });
    var ty = (t.eventtypes || []).filter(function (r) { return str(r.Name); }).map(function (r) {
      return { n: str(r.Name), g: str(r.Group).toLowerCase() || 'other', c: str(r.Color), s: str(r.Short),
        subs: str(r.Subtitles) ? str(r.Subtitles).split('|').map(function (x) { return x.trim(); }).filter(Boolean) : [] };
    });
    var tx = texts(t);
    var view = { mode: tx.cal_view === 'range' ? 'range' : 'history', days: Math.max(0, Math.min(365, num(tx.cal_history_days) || (tx.cal_history_days === '0' ? 0 : 10))),
      from: toTime(tx.cal_from), to: toTime(tx.cal_to) };
    /* groups: built-in names/colours can be renamed, and admins can add their own (Site text key "groups") */
    var gs = []; try { gs = JSON.parse(tx.groups || '[]'); } catch (e) { gs = []; }
    gs = (Array.isArray(gs) ? gs : []).filter(function (g) { return g && /^[a-z0-9_]{1,32}$/.test(str(g.k)); })
      .map(function (g) { return { k: str(g.k), n: str(g.n).slice(0, 40), c: /^#[0-9a-fA-F]{6}$/.test(str(g.c)) ? str(g.c) : '' }; });
    return { dates: ds, kingdoms: ks, types: ty, view: view, groups: gs };
  }

  /* Credit totals for every player (used to fill the Credits tab) */
  function balances(t, now) {
    var evs = events(t, now), out = {};
    t.players.forEach(function (p) { var g = str(p.GovID); if (g) out[g] = balance(g, evs, t); });
    return out;
  }

  /* Website wording from the Site text tab */
  function texts(t) {
    var o = {};
    (t.sitetext || []).forEach(function (r) { var k = str(r.Key); if (k) o[k] = str(r.Text); });
    return o;
  }

  return { gate: gate, state: state, checkBid: checkBid, calendar: calendar, balances: balances, texts: texts, toTime: toTime };
})();

/* ============================================================
   Kingdom 3914 — website backend on Cloudflare (Workers + D1)
   Same requests and answers as the Google Apps Script version,
   so the website works with either one.
   Migration applications: answers in D1 (table apps), screenshots in R2 (binding FILES).
   ============================================================ */

var TABS = {
  Players: ['GovID', 'Name', 'Alliance', 'PIN', 'Role'],
  Credits: ['GovID', 'Name', 'Balance'],
  Events: ['EventID', 'Type', 'Title', 'Subject', 'Opens', 'Closes', 'Ranks', 'Increment', 'Rewards', 'Minimums', 'Status'],
  Bids: ['Timestamp', 'EventID', 'Rank', 'GovID', 'Name', 'Amount', 'Status'],
  News: ['Date', 'Type', 'Title', 'Body', 'Pinned'],
  Calendar: ['Event', 'Start', 'End', 'Details', 'Estimated'],
  'Event types': ['Name', 'Group', 'Color', 'Short', 'Subtitles'],
  Kingdoms: ['Kingdom', 'Name', 'Subtitle', 'Color', 'KvK start', 'KvK end', 'Build-up from'],
  'Site text': ['Key', 'Text', 'Where it shows']
};
var TAB_KEYS = { Players: 'players', Credits: 'credits', Events: 'events', Bids: 'bids', News: 'news', Calendar: 'calendar', 'Event types': 'eventtypes', Kingdoms: 'kingdoms', 'Site text': 'sitetext' };
var TYPE_GROUPS = ['stage', 'mge', 'gh', 'pop', 'mig', 'other'];

/* Edit mode: per tab, column -> [kind, required, extra]. Same rules as the Google version. */
var EDIT = {
  'Calendar': { Event: ['type', 1], Start: ['date', 1], End: ['date'], Details: ['text', 0, 120], Estimated: ['bool'] },
  'Event types': { Name: ['text', 1, 40], Group: ['group', 1], Color: ['color'], Short: ['text', 0, 12], Subtitles: ['text', 0, 600] },
  'Kingdoms': { Kingdom: ['digits', 1], Name: ['text', 0, 40], Color: ['color'], 'KvK start': ['date'], 'KvK end': ['date'], 'Build-up from': ['date'] },
  'News': { Date: ['date', 1], Type: ['enum', 1, ['Announcement', 'News']], Title: ['text', 1, 120], Body: ['text', 0, 6000], Pinned: ['bool'] },
  'Events': { EventID: ['id', 1], Type: ['enum', 1, ['MGE', 'GH']], Title: ['text', 0, 80], Subject: ['text', 0, 80], Opens: ['datetime', 1], Closes: ['datetime', 1], Ranks: ['int', 1, [1, 50]], Increment: ['int', 1, [1, 1000000]], Rewards: ['text', 0, 1500], Minimums: ['text', 0, 800], Status: ['enum', 1, ['open', 'draft', 'closed']] }
};

function str(v) { return v == null ? '' : String(v).trim(); }
function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return json({ ok: true });
    var p = {};
    if (req.method === 'POST') { try { p = JSON.parse(await req.text()) || {}; } catch (e) { p = {}; } }
    else { new URL(req.url).searchParams.forEach(function (v, k) { p[k] = v; }); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
    p._ip = str(req.headers.get('CF-Connecting-IP')).slice(0, 64);
    try { return json(await handle(env, p)); }
    catch (err) { return json({ ok: false, error: String((err && err.message) || err) }); }
  }
};

/* ---------- reading: the whole database is small, so keep a copy in memory and reuse it until something changes ---------- */
var MEM = null; /* { dv, t } */
async function tables(env) {
  var head = await env.DB.prepare("SELECT v FROM meta WHERE k = 'dv'").first();
  var dv = head ? head.v : 0;
  if (!MEM || MEM.dv !== dv) {
    var res = await env.DB.batch([
      env.DB.prepare("SELECT v FROM meta WHERE k = 'dv'"),
      env.DB.prepare('SELECT id, tab, data, ver FROM rows ORDER BY id')
    ]);
    var t = {};
    Object.keys(TAB_KEYS).forEach(function (n) { t[TAB_KEYS[n]] = []; });
    res[1].results.forEach(function (r) {
      var key = TAB_KEYS[r.tab]; if (!key) return;
      var o = JSON.parse(r.data); o._row = r.id; o._ver = r.ver;
      t[key].push(o);
    });
    MEM = { dv: res[0].results[0] ? res[0].results[0].v : 0, t: t };
  }
  return { dv: MEM.dv, t: structuredClone(MEM.t) };
}

/* ---------- writing: a save goes through only if nobody else saved since we read (then we just try again) ---------- */
var GUARD = "(SELECT tok FROM meta WHERE k = 'dv') = ?";
async function commit(env, dv, stmts) {
  var tok = crypto.randomUUID();
  var batch = [env.DB.prepare("UPDATE meta SET v = v + 1, tok = ? WHERE k = 'dv' AND v = ?").bind(tok, dv)];
  stmts.forEach(function (s) { var st = env.DB.prepare(s.sql.replace('{G}', GUARD)); batch.push(st.bind.apply(st, [].concat(s.args || [], [tok]))); });
  var res = await env.DB.batch(batch);
  return res[0].meta.changes === 1;
}
function insertRow(tab, data) { return { sql: 'INSERT INTO rows (tab, data) SELECT ?, ? WHERE {G}', args: [tab, JSON.stringify(clean(data))] }; }
function updateRow(id, data) { return { sql: 'UPDATE rows SET data = ?, ver = ver + 1 WHERE id = ? AND {G}', args: [JSON.stringify(clean(data)), id] }; }
function deleteRow(id) { return { sql: 'DELETE FROM rows WHERE id = ? AND {G}', args: [id] }; }
function clean(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row' && k !== '_ver') c[k] = o[k]; }); return c; }

/* run fn(dv, t) until its save lands (only collides when two saves happen in the same instant) */
async function withRetry(env, fn) {
  for (var i = 0; i < 10; i++) {
    var s = await tables(env), r = await fn(s.dv, s.t);
    if (r !== RETRY) return r;
    await new Promise(function (ok) { setTimeout(ok, 15 + Math.random() * 40 * (i + 1)); });
  }
  return { ok: false, error: 'Server busy. Please try again.' };
}
var RETRY = {};

async function log(env, who, action, detail) {
  try {
    await env.DB.prepare('INSERT INTO log (ts, gov, name, action, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(Date.now(), who ? str(who.GovID) : '', who ? str(who.Name) : '', action, String(detail || '').slice(0, 500)).run();
  } catch (e) {}
}

/* ---------- PINs are stored scrambled (salted HMAC-SHA256) — nobody can read them back ---------- */
async function hmacHex(key, msg) {
  var k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  var sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.prototype.map.call(new Uint8Array(sig), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}
/* h1$ = scrambled without the secret pepper (older); h2$ = scrambled with the secret PIN_PEPPER.
   With PIN_PEPPER set, a player's h1 PIN is upgraded to h2 the next time they sign in. Never change PIN_PEPPER once set. */
function pepper(env) { return str(env.PIN_PEPPER); }
async function hashPin(env, pin) {
  var salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16), pep = pepper(env);
  return (pep ? 'h2$' : 'h1$') + salt + '$' + await hmacHex(pep + salt, str(pin));
}
async function pinMatches(env, stored, pin) {
  stored = str(stored); pin = str(pin);
  if (!stored || !pin) return false;
  var v = stored.slice(0, 3);
  if (v !== 'h1$' && v !== 'h2$') return stored === pin; /* not scrambled yet */
  if (v === 'h2$' && !pepper(env)) return false;
  var parts = stored.split('$');
  var want = parts[2], got = await hmacHex((v === 'h2$' ? pepper(env) : '') + parts[1], pin);
  if (want.length !== got.length) return false;
  var diff = 0; for (var i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
/* Re-scramble an older PIN with the pepper after a correct sign-in (best effort; never blocks the sign-in) */
async function upgradePin(env, gov, oldStored, pin) {
  try {
    var hashed = await hashPin(env, pin);
    await withRetry(env, async function (dv, t) {
      var pl = null; t.players.forEach(function (x) { if (str(x.GovID) === gov) pl = x; });
      if (!pl || str(pl.PIN) !== oldStored) return { ok: true };
      var o = clean(pl); o.PIN = hashed;
      if (!(await commit(env, dv, [updateRow(pl._row, o)]))) return RETRY;
      return { ok: true };
    });
  } catch (e) {}
}

/* Shared rules (Core) compare PINs directly, so after checking the scrambled PIN we put
   the typed PIN back on this player in memory only, for this one request. */
function unlock(t, gov, pin) { t.players.forEach(function (pl) { if (str(pl.GovID) === gov) pl.PIN = str(pin); }); }

/* Sign-in check with a limit on wrong PINs: 5 wrong tries locks that Governor ID for 15 minutes */
async function memberGate(env, t, p) {
  var gov = str(p.gov), pin = str(p.pin);
  if (!gov || !pin) return {};
  var key = gov.replace(/[^0-9A-Za-z]/g, '').slice(0, 40), now = Date.now();
  var f = await env.DB.prepare('SELECT n, until FROM fails WHERE gov = ?').bind(key).first();
  var fails = f && f.until > now ? f.n : 0;
  if (fails >= 5) return { error: 'Too many wrong PINs. Try again in 15 minutes.' };
  var me = null;
  for (var i = 0; i < t.players.length; i++) if (str(t.players[i].GovID) === gov) { me = t.players[i]; break; }
  if (!me || !(await pinMatches(env, me.PIN, pin))) {
    await env.DB.prepare('INSERT INTO fails (gov, n, until) VALUES (?, ?, ?) ON CONFLICT(gov) DO UPDATE SET n = excluded.n, until = excluded.until')
      .bind(key, fails + 1, now + 15 * 60000).run();
    if (fails + 1 >= 5) await log(env, { GovID: gov, Name: me ? me.Name : '' }, 'locked', '5 wrong PINs — sign-in blocked for 15 minutes');
    return { error: fails + 1 >= 5 ? 'Too many wrong PINs. Try again in 15 minutes.' : 'Wrong governor ID or PIN.' };
  }
  if (f) await env.DB.prepare('DELETE FROM fails WHERE gov = ?').bind(key).run();
  if (pepper(env) && str(me.PIN).indexOf('h2$') !== 0) await upgradePin(env, gov, str(me.PIN), pin);
  unlock(t, gov, pin);
  return { me: me };
}

/* ---------- website requests ---------- */
async function handle(env, p) {
  var action = String(p.action || '');
  if (action === 'applyStart') return applyStart(env, p);
  if (action === 'applyImage') return applyImage(env, p);
  if (action === 'applyFinish') return applyFinish(env, p);
  if (action === 'adminImport') return adminImport(env, p);
  var s = await tables(env), t = s.t, text = Core.texts(t);
  if (action === 'text') return { ok: true, text: text };
  /* everything else is for signed-in members only */
  var g = await memberGate(env, t, p);
  if (!g.me) return { ok: true, locked: true, authError: g.error || '', text: text };
  var role = str(g.me.Role).toLowerCase(), admin = role === 'admin', r4 = role === 'r4';
  if (action === 'login') return { ok: true, me: { name: str(g.me.Name), gov: str(g.me.GovID), admin: admin, r4: r4 }, text: text };
  if (action === 'bid') return placeBid(env, p, g.me);
  if (/^admin|^textSave$/.test(action)) {
    /* R4 officers: migration applications only */
    if (r4 && /^adminApp(s|File|Save)?$/.test(action)) {
      if (action === 'adminApps') return adminApps(env);
      if (action === 'adminApp') return adminApp(env, p);
      if (action === 'adminAppFile') return adminAppFile(env, p);
      return adminAppSave(env, p, g.me);
    }
    if (!admin) return { ok: false, error: r4 ? 'R4 officers can only review migration applications.' : 'Only admins can edit the website.' };
    if (action === 'adminLoad') return adminLoad(t, p);
    if (action === 'adminSave' || action === 'adminDelete') return adminEdit(env, p, g.me);
    if (action === 'textSave') return textSave(env, p, g.me);
    if (action === 'adminLog') return adminLog(env, p);
    if (action === 'adminPeople') return adminPeople(t, g.me);
    if (action === 'adminPlayer') return adminPlayer(env, p, g.me);
    if (action === 'adminCredit') return adminCredit(env, p, g.me);
    if (action === 'adminBids') return adminBids(t);
    if (action === 'adminBid') return adminBid(env, p, g.me);
    if (action === 'adminApps') return adminApps(env);
    if (action === 'adminApp') return adminApp(env, p);
    if (action === 'adminAppFile') return adminAppFile(env, p);
    if (action === 'adminAppSave') return adminAppSave(env, p, g.me);
    return { ok: false, error: 'Unknown action.' };
  }
  var res = action === 'calendar' ? { ok: true, calendar: Core.calendar(t) } : Core.state(t, p, Date.now());
  if (p.cal && action !== 'calendar') res.calendar = Core.calendar(t);
  res.admin = admin;
  res.r4 = r4;
  res.text = text;
  return res;
}

/* ---------- bids: checked against the very latest bids; two bids can never both win the same spot ---------- */
async function placeBid(env, p, who) {
  var c, t, now;
  var r = await withRetry(env, async function (dv, fresh) {
    t = fresh; now = Date.now();
    unlock(t, str(p.gov), p.pin);
    c = Core.checkBid(t, p, now);
    if (c.error) return { ok: false, error: c.error };
    c.row.Timestamp = now;
    if (!(await commit(env, dv, [insertRow('Bids', c.row)]))) return RETRY;
    t.bids.push(c.row);
    return null;
  });
  if (r) return r;
  await log(env, who, 'bid', c.type + ' ' + c.row.EventID + ' rank #' + c.rank + ' — ' + c.row.Amount.toLocaleString('en-US'));
  var out = Core.state(t, p, now);
  out.message = 'Bid placed on ' + c.type + ' rank #' + c.rank + '.';
  return out;
}

/* ---------- Edit mode ---------- */
function rowsOf(t, tab) { return t[TAB_KEYS[tab]] || []; }

function adminLoad(t, p) {
  var tab = String(p.tab || '');
  if (!EDIT[tab]) return { ok: false, error: 'This part of the website cannot be edited.' };
  return { ok: true, tab: tab, headers: TABS[tab], rows: rowsOf(t, tab).map(function (o) {
    var v = {}; TABS[tab].forEach(function (h) { v[h] = o[h] === undefined ? '' : o[h]; });
    return { r: o._row, sig: String(o._ver), v: v };
  }) };
}

function parseCell(kind, val, extra, label, t) {
  var s = val == null ? '' : String(val).trim(), m;
  if (kind === 'bool') return val === true;
  if (s === '') return '';
  if (kind === 'text') return s.slice(0, extra || 200);
  if (kind === 'enum') { if (extra.indexOf(s) < 0) throw new Error(label + ': pick one of the options.'); return s; }
  if (kind === 'color') { if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new Error(label + ': use a colour like #3DD68C.'); return s.toUpperCase(); }
  if (kind === 'digits') { if (!/^[0-9]{1,6}$/.test(s)) throw new Error(label + ': numbers only.'); return s; }
  if (kind === 'id') { if (!/^[A-Za-z0-9_-]{1,20}$/.test(s)) throw new Error(label + ': letters, numbers and - only (e.g. MGE-03).'); return s; }
  if (kind === 'int') { var n = Number(s); if (!(n % 1 === 0 && n >= extra[0] && n <= extra[1])) throw new Error(label + ': a whole number from ' + extra[0] + ' to ' + extra[1] + '.'); return n; }
  if (kind === 'date') { m = s.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/); if (!m) throw new Error(label + ': not a valid date.'); return Date.UTC(+m[1], m[2] - 1, +m[3]); }
  if (kind === 'datetime') { m = s.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})/); if (!m) throw new Error(label + ': not a valid date and time.'); return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]); }
  if (kind === 'group') {
    var keys = TYPE_GROUPS.concat(Core.calendar(t).groups.map(function (x) { return x.k; }));
    if (keys.indexOf(s) < 0) throw new Error(label + ': pick one of the groups.');
    return s;
  }
  if (kind === 'type') {
    var names = (t.eventtypes || []).map(function (x) { return str(x.Name); });
    if (names.indexOf(s) < 0) throw new Error(label + ': pick one of the event types.');
    return s;
  }
  return s;
}

async function adminEdit(env, p, who) {
  var tab = String(p.tab || ''), schema = EDIT[tab];
  if (!schema) return { ok: false, error: 'This part of the website cannot be edited.' };
  var summary = '';
  var r = await withRetry(env, async function (dv, t) {
    try {
      var list = rowsOf(t, tab), id = parseInt(p.row, 10) || 0, cur = null, stmts = [];
      if (id) {
        list.forEach(function (o) { if (o._row === id) cur = o; });
        if (!cur) return { ok: false, error: 'That item no longer exists. Refresh the page.' };
        if (String(cur._ver) !== String(p.sig || '')) return { ok: false, error: 'Someone changed this in the meantime. Refresh the page and try again.' };
      }
      function others(name, val) { return list.filter(function (o) { return o._row !== id && str(o[name]) === str(val); }).length; }
      var label = function (o) { return str(o.Title || o.Name || o.Event || o.EventID || o.Kingdom || ''); };

      if (p.action === 'adminDelete') {
        if (!cur) return { ok: false, error: 'Nothing to delete.' };
        if (tab === 'Event types' && (t.calendar || []).some(function (c) { return str(c.Event) === str(cur.Name); })) return { ok: false, error: 'Dates still use “' + str(cur.Name) + '”. Change or delete those dates first.' };
        if (tab === 'Events' && (t.bids || []).some(function (b) { return str(b.EventID) === str(cur.EventID); })) return { ok: false, error: 'This auction has bids, so it can’t be deleted. Set its status to closed instead.' };
        stmts.push(deleteRow(id));
        summary = 'deleted ' + tab + ': ' + label(cur);
      } else {
        var vals = p.values || {}, out = cur ? clean(cur) : {};
        TABS[tab].forEach(function (h) { if (out[h] === undefined) out[h] = ''; });
        Object.keys(schema).forEach(function (name) {
          var rule = schema[name], v = parseCell(rule[0], vals[name], rule[2], name, t);
          if (rule[1] && (v === '' || v === null)) throw new Error(name + ' is required.');
          out[name] = v;
        });
        if (tab === 'Calendar' && out.End && out.End < out.Start) throw new Error('The end date is before the start date.');
        if (tab === 'Events' && out.Closes <= out.Opens) throw new Error('Closing time must be after the opening time.');
        if (tab === 'Kingdoms') {
          if (others('Kingdom', out.Kingdom)) throw new Error('Kingdom ' + out.Kingdom + ' is already on the calendar.');
          if (out['KvK end'] && out['KvK start'] && out['KvK end'] < out['KvK start']) throw new Error('KvK end is before KvK start.');
        }
        if (tab === 'Event types' && others('Name', out.Name)) throw new Error('There is already an event type called “' + out.Name + '”.');
        if (tab === 'Events') {
          if (others('EventID', out.EventID)) throw new Error('Another auction already uses the code ' + out.EventID + '.');
          if (cur && str(cur.EventID) !== str(out.EventID) && (t.bids || []).some(function (b) { return str(b.EventID) === str(cur.EventID); })) throw new Error('This auction has bids, so its code can’t change.');
        }
        stmts.push(id ? updateRow(id, out) : insertRow(tab, out));
        /* renaming an event type renames it on every date too */
        if (tab === 'Event types' && cur && str(cur.Name) !== out.Name) {
          (t.calendar || []).forEach(function (c) { if (str(c.Event) === str(cur.Name)) { var n = clean(c); n.Event = out.Name; stmts.push(updateRow(c._row, n)); } });
        }
        summary = (id ? 'edited ' : 'added ') + tab + ': ' + label(out);
      }
      if (!(await commit(env, dv, stmts))) return RETRY;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  if (r.ok) await log(env, who, 'edit', summary);
  return r;
}

/* Page titles, subtitles, rules and settings (Site text). items = { key: text } */
async function textSave(env, p, who) {
  var items = p.items || {}, keys = Object.keys(items);
  if (!keys.length) return { ok: false, error: 'Nothing to save.' };
  var after = null;
  var r = await withRetry(env, async function (dv, t) {
    try {
      var stmts = [];
      keys.forEach(function (k) {
        if (!/^[a-z0-9_]{1,40}$/.test(k)) throw new Error('Invalid text key.');
        var txt = String(items[k] == null ? '' : items[k]).slice(0, k === 'groups' ? 4000 : 1000), row = null;
        t.sitetext.forEach(function (o) { if (str(o.Key) === k) row = o; });
        if (row) { row.Text = txt; stmts.push(updateRow(row._row, row)); }
        else { var n = { Key: k, Text: txt, 'Where it shows': 'Added on the website' }; t.sitetext.push(n); stmts.push(insertRow('Site text', n)); }
      });
      if (!(await commit(env, dv, stmts))) return RETRY;
      after = Core.texts(t);
      return { ok: true, text: after };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  if (r.ok) await log(env, who, 'text', 'changed ' + keys.join(', '));
  return r;
}

/* Activity log for admins (newest first) */
async function adminLog(env, p) {
  var limit = Math.max(1, Math.min(1000, parseInt(p.limit, 10) || 300));
  var res = await env.DB.prepare('SELECT ts, gov, name, action, detail FROM log ORDER BY id DESC LIMIT ?').bind(limit).all();
  return { ok: true, log: res.results };
}

/* ---------- copy data in from the Google Sheet ----------
   Allowed when the database is still empty (first setup), or for a signed-in admin.
   tables = { 'Players': [ {GovID, Name, ...}, ... ], ... }  Replaces everything. PINs get scrambled here. */
async function adminImport(env, p) {
  var s = await tables(env);
  if (s.t.players.length) {
    var g = await memberGate(env, s.t, p);
    if (!g.me || str(g.me.Role).toLowerCase() !== 'admin') return { ok: false, error: 'Only admins can copy data in.' };
  }
  var src = p.tables || {}, all = [], counts = {};
  for (var tab of Object.keys(TABS)) {
    var list = Array.isArray(src[tab]) ? src[tab] : [];
    counts[tab] = 0;
    for (var o of list) {
      var row = {};
      TABS[tab].forEach(function (h) { row[h] = o[h] === undefined || o[h] === null ? '' : o[h]; });
      if (tab === 'Players') { if (!str(row.GovID)) continue; if (str(row.PIN) && !/^h[12][$]/.test(str(row.PIN))) row.PIN = await hashPin(env, row.PIN); }
      all.push({ tab: tab, data: row }); counts[tab]++;
    }
  }
  /* one statement for all rows (keeps well inside Cloudflare's per-request limits) */
  var stmts = [
    { sql: 'DELETE FROM rows WHERE {G}', args: [] },
    { sql: "INSERT INTO rows (tab, data) SELECT json_extract(value, '$.tab'), json_extract(value, '$.data') FROM json_each(?) WHERE {G}", args: [JSON.stringify(all)] }
  ];
  if (!(await commit(env, s.dv, stmts))) return { ok: false, error: 'Someone saved at the same moment. Try again.' };
  await log(env, null, 'import', 'copied from Google Sheet: ' + Object.keys(counts).map(function (k) { return k + ' ' + counts[k]; }).join(', '));
  return { ok: true, counts: counts };
}

/* ============================================================
   Admin page: players, credits, bids (same requests/answers as the Google version)
   ============================================================ */
function isAdminRole(v) { return str(v).toLowerCase() === 'admin'; }
function roleOf(v) { v = str(v).toLowerCase(); return v === 'admin' || v === 'r4' ? v : 'player'; }
var ROLE_NAMES = { player: 'player', r4: 'R4', admin: 'admin' };
function fmtN(v) { return Number(v).toLocaleString('en-US'); }

/* Everyone with their credits — PINs are never sent, only whether one is set */
function adminPeople(t, me) {
  var bal = Core.balances(t, Date.now()), base = {}, bidCount = {};
  t.credits.forEach(function (c) { var g = str(c.GovID); if (g) base[g] = (base[g] || 0) + (Number(c.Balance) || 0); });
  t.bids.forEach(function (b) { var g = str(b.GovID); if (str(b.Status).toLowerCase() !== 'cancelled') bidCount[g] = (bidCount[g] || 0) + 1; });
  return { ok: true, me: str(me.GovID), people: t.players.filter(function (pl) { return str(pl.GovID); }).map(function (pl) {
    var gov = str(pl.GovID), b = bal[gov] || { received: 0, spent: 0, reserved: 0, available: 0 };
    return { r: pl._row, sig: String(pl._ver), gov: gov, name: str(pl.Name), alliance: str(pl.Alliance), role: roleOf(pl.Role),
      hasPin: str(pl.PIN) !== '', balance: base[gov] || 0, received: b.received, spent: b.spent, reserved: b.reserved, available: b.available, bids: bidCount[gov] || 0 };
  }) };
}

/* Add, edit or remove a player. values = {GovID, Name, Alliance, Role, PIN}; PIN empty = keep the current one */
async function adminPlayer(env, p, who) {
  var vals = p.values || {}, myGov = str(who.GovID), summary = '';
  var pinIn = str(vals.PIN), hashed = pinIn ? await hashPin(env, pinIn) : '';
  var r = await withRetry(env, async function (dv, t) {
    var id = parseInt(p.row, 10) || 0, cur = null, stmts = [];
    if (id) {
      t.players.forEach(function (o) { if (o._row === id) cur = o; });
      if (!cur) return { ok: false, error: 'That player no longer exists. Refresh the page.' };
      if (String(cur._ver) !== String(p.sig || '')) return { ok: false, error: 'Someone changed this player in the meantime. Refresh the page and try again.' };
    }
    var curGov = cur ? str(cur.GovID) : '';
    if (p.del) {
      if (!cur) return { ok: false, error: 'Nothing to remove.' };
      if (curGov === myGov) return { ok: false, error: 'You can’t remove yourself.' };
      var live = Core.balances(t, Date.now())[curGov];
      if (live && live.reserved > 0) return { ok: false, error: str(cur.Name) + ' is leading ranks in an open auction. Cancel those bids first.' };
      stmts.push(deleteRow(id));
      t.credits.forEach(function (c) { if (str(c.GovID) === curGov) stmts.push(deleteRow(c._row)); });
      summary = 'removed ' + str(cur.Name) + ' (' + curGov + ')';
    } else {
      var gov = str(vals.GovID), name = str(vals.Name).slice(0, 40), alliance = str(vals.Alliance).slice(0, 20), role = (str(vals.Role) || 'player').toLowerCase();
      if (!/^[0-9]{3,20}$/.test(gov)) return { ok: false, error: 'Governor ID: numbers only (the ID from the game).' };
      if (!name) return { ok: false, error: 'Name is required.' };
      if (['player', 'r4', 'admin'].indexOf(role) < 0) return { ok: false, error: 'Role must be player, R4 or admin.' };
      if (cur && gov !== curGov) return { ok: false, error: 'A Governor ID can’t be changed. Remove the player and add them again.' };
      if (!cur && !pinIn) return { ok: false, error: 'Give the new player a PIN.' };
      if (pinIn && !/^[0-9A-Za-z]{4,20}$/.test(pinIn)) return { ok: false, error: 'PIN: 4 to 20 letters or numbers.' };
      if (cur && curGov === myGov && role !== 'admin') return { ok: false, error: 'You can’t take away your own admin role.' };
      if (t.players.some(function (o) { return o._row !== id && str(o.GovID) === gov; })) return { ok: false, error: 'Governor ID ' + gov + ' is already on the list.' };
      var out = cur ? clean(cur) : { GovID: '', Name: '', Alliance: '', PIN: '', Role: '' };
      out.GovID = gov; out.Name = name; out.Alliance = alliance; out.Role = role;
      if (hashed) out.PIN = hashed;
      stmts.push(id ? updateRow(id, out) : insertRow('Players', out));
      if (!cur && !t.credits.some(function (c) { return str(c.GovID) === gov; })) stmts.push(insertRow('Credits', { GovID: gov, Name: name, Balance: 0 }));
      var what = [];
      if (!cur) what.push('added ' + name + ' (' + gov + ') as ' + ROLE_NAMES[role]);
      else {
        if (str(cur.Name) !== name) what.push('renamed ' + str(cur.Name) + ' → ' + name);
        if (roleOf(cur.Role) !== role) what.push(name + ' role: ' + ROLE_NAMES[roleOf(cur.Role)] + ' → ' + ROLE_NAMES[role]);
        if (str(cur.Alliance) !== alliance) what.push(name + ' alliance → ' + (alliance || 'none'));
        if (pinIn) what.push('reset PIN for ' + name);
      }
      summary = what.join('; ');
    }
    if (!(await commit(env, dv, stmts))) return RETRY;
    return { ok: true };
  });
  if (r.ok && summary) await log(env, who, 'player', summary);
  return r;
}

/* Give or take credits (mode add, with a reason) or set the total (mode set) */
async function adminCredit(env, p, who) {
  var gov = str(p.player), mode = p.mode === 'set' ? 'set' : 'add', amount = Number(p.amount), reason = str(p.reason).slice(0, 200), info = null;
  if (!(amount % 1 === 0) || Math.abs(amount) > 100000000) return { ok: false, error: 'Enter a whole number of credits.' };
  if (mode === 'add' && !amount) return { ok: false, error: 'Enter how many credits to give (or a minus number to take).' };
  if (mode === 'set' && amount < 0) return { ok: false, error: 'The total can’t be below zero.' };
  if (!reason) return { ok: false, error: 'Write a short reason (it goes in the activity log).' };
  var r = await withRetry(env, async function (dv, t) {
    var pl = null; t.players.forEach(function (x) { if (str(x.GovID) === gov) pl = x; });
    if (!pl) return { ok: false, error: 'That player is not on the list.' };
    var rows = t.credits.filter(function (c) { return str(c.GovID) === gov; }), before = 0;
    rows.forEach(function (c) { before += Number(c.Balance) || 0; });
    var after = mode === 'set' ? amount : before + amount;
    if (after < 0) return { ok: false, error: 'That would take the total below zero (it is ' + fmtN(before) + ').' };
    var b = Core.balances(t, Date.now())[gov] || { spent: 0, reserved: 0 };
    if (after < b.spent + b.reserved) return { ok: false, error: str(pl.Name) + ' has already used ' + fmtN(b.spent + b.reserved) + ' credits (won + leading bids), so the total can’t go below that.' };
    var stmts = [];
    if (rows.length) { var first = clean(rows[0]); first.Balance = after; stmts.push(updateRow(rows[0]._row, first)); rows.slice(1).forEach(function (c) { stmts.push(deleteRow(c._row)); }); }
    else stmts.push(insertRow('Credits', { GovID: gov, Name: str(pl.Name), Balance: after }));
    if (!(await commit(env, dv, stmts))) return RETRY;
    info = { name: str(pl.Name), before: before, after: after };
    return { ok: true, before: before, after: after };
  });
  if (r.ok) { var d = info.after - info.before; await log(env, who, 'credits', (d >= 0 ? '+' : '') + fmtN(d) + ' to ' + info.name + ' (' + fmtN(info.before) + ' → ' + fmtN(info.after) + '): ' + reason); }
  return r;
}

/* Every bid, newest first, with the auctions they belong to */
function adminBids(t) {
  var bids = t.bids.filter(function (b) { return str(b.EventID); }).map(function (b) {
    return { r: b._row, sig: String(b._ver), time: Core.toTime(b.Timestamp), event: str(b.EventID), rank: Number(b.Rank) || 0, gov: str(b.GovID), name: str(b.Name),
      amount: Number(b.Amount) || 0, status: str(b.Status).toLowerCase() === 'cancelled' ? 'cancelled' : 'valid' };
  }).reverse();
  var evs = Core.state(t, {}, Date.now()).events.map(function (e) { return { id: e.id, type: e.type, title: e.title, phase: e.phase, closes: e.closes }; });
  return { ok: true, bids: bids, events: evs };
}

/* Cancel a bid (or undo a cancel). The next-highest bid then leads that rank again. */
async function adminBid(env, p, who) {
  var cancel = p.cancel !== false, reason = str(p.reason).slice(0, 200), o = null;
  if (cancel && !reason) return { ok: false, error: 'Write a short reason (it goes in the activity log).' };
  var r = await withRetry(env, async function (dv, t) {
    var id = parseInt(p.row, 10) || 0, cur = null;
    t.bids.forEach(function (b) { if (b._row === id) cur = b; });
    if (!cur) return { ok: false, error: 'That bid no longer exists. Refresh the page.' };
    if (String(cur._ver) !== String(p.sig || '')) return { ok: false, error: 'This bid changed in the meantime. Refresh the page and try again.' };
    var out = clean(cur); out.Status = cancel ? 'cancelled' : 'valid';
    if (!(await commit(env, dv, [updateRow(id, out)]))) return RETRY;
    o = out;
    return { ok: true };
  });
  if (r.ok) await log(env, who, 'bid', (cancel ? 'cancelled ' : 'restored ') + str(o.Name) + '’s bid ' + o.EventID + ' rank #' + o.Rank + ' — ' + fmtN(o.Amount) + (reason ? ': ' + reason : ''));
  return r;
}


/* ============================================================
   Migration applications
   Answers go to D1 (table "apps"); screenshots go to R2 storage (binding FILES),
   under apps/<reference>/<section>/<number>.<ext>. Officers read them on the Admin page.
   ============================================================ */
var APP_CATS = { profile: ['Account profile', 1], equipment: ['Equipment & armaments', 20], commanders: ['Commanders', 15], speedups: ['Speed-ups', 2], farms: ['Farm profiles', 30] };
var APP_OPTS = { vip_options: 'VIP 17|VIP 18|VIP 19|SVIP', spending_options: 'F2P|Pop ups only|Pop up + MW|Max Tech', role_options: 'Field|Garrison|Rally' };
var FARM_LIMIT = 35000000;
var APP_STATUSES = ['Pending', 'Contacted', 'Accepted', 'Rejected'];

async function appsTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS apps (ref TEXT PRIMARY KEY, ts INTEGER NOT NULL, status TEXT NOT NULL, token TEXT NOT NULL, expect TEXT NOT NULL, data TEXT NOT NULL, got TEXT, note TEXT, by TEXT)').run();
}
function parseBig(v) {
  var s = String(v == null ? '' : v).toLowerCase().replace(/[, ]/g, '');
  var m = s.match(/^([0-9]+(?:[.][0-9]+)?)([kmb]?)$/);
  if (!m) return NaN;
  return Math.round(Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2]]);
}
function appOptions(t, key) {
  var v = Core.texts(t)[key];
  return String(v && String(v).trim() ? v : APP_OPTS[key]).split('|').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}
function b64ToBytes(b64) { var bin = atob(String(b64 || '')), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function bytesToB64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }

async function applyStart(env, p) {
  if (!env.FILES) return { ok: false, error: 'Applications are not set up yet. Please try again later.' };
  var a = p.answers || {};
  function txt(k, max) { return String(a[k] == null ? '' : a[k]).trim().slice(0, max || 100); }
  if (txt('website')) return { ok: false, error: 'Could not send.' };
  var t = (await tables(env)).t;
  var gov = txt('govId', 20).replace(/[^0-9]/g, ''), name = txt('govName', 40);
  var power = parseBig(a.power), kills = parseBig(a.kills);
  var vip = txt('vip', 20), kd = txt('kingdom', 10).replace(/[^0-9]/g, ''), why = txt('why', 1500);
  var spend = txt('spending', 40), role = txt('role', 40), rss = txt('buysRss', 3), farms = txt('hasFarms', 3);
  var farmCount = parseInt(txt('farmCount', 4), 10), fMin = parseBig(a.farmMin), fMax = parseBig(a.farmMax);
  var bad = [];
  if (!gov) bad.push('Governor ID');
  if (!name) bad.push('Governor name');
  if (!(power > 0)) bad.push('Current power');
  if (!(kills >= 0)) bad.push('Total kill points');
  if (appOptions(t, 'vip_options').indexOf(vip) < 0) bad.push('VIP level');
  if (!kd) bad.push('Current kingdom');
  if (why.length < 3) bad.push('Why you want to migrate');
  if (appOptions(t, 'spending_options').indexOf(spend) < 0) bad.push('KvK spending');
  if (appOptions(t, 'role_options').indexOf(role) < 0) bad.push('Your role');
  if (rss !== 'Yes' && rss !== 'No') bad.push('Do you buy RSS');
  if (farms !== 'Yes' && farms !== 'No') bad.push('Do you have farms');
  if (farms === 'Yes') {
    if (!(farmCount >= 1)) bad.push('Number of farms');
    if (!(fMin > 0)) bad.push('Weakest farm power');
    if (!(fMax > 0)) bad.push('Strongest farm power');
  }
  if (bad.length) return { ok: false, error: 'Please check: ' + bad.join(', ') + '.' };
  if (farms === 'Yes' && fMax > FARM_LIMIT) return { ok: false, error: 'Farms over 35M power are not allowed.' };
  if (farms === 'Yes' && fMin > fMax) return { ok: false, error: 'Weakest farm power can’t be higher than the strongest.' };
  var counts = a.counts || {}, expect = {}, missing = [];
  Object.keys(APP_CATS).forEach(function (c) {
    var n = parseInt(counts[c], 10) || 0, lim = APP_CATS[c][1];
    if (c === 'farms' && farms !== 'Yes') n = 0;
    expect[c] = Math.max(0, Math.min(lim, n));
    var need = c === 'farms' ? (farms === 'Yes' ? Math.min(30, farmCount) : 0) : 1;
    if (expect[c] < need) missing.push(APP_CATS[c][0]);
  });
  if (missing.length) return { ok: false, error: 'Missing screenshots: ' + missing.join(', ') + '.' };
  /* spam limits: 3 applications per connection per hour, 2 per Governor ID per day */
  if (!(await allow(env, 'ip:' + (p._ip || 'unknown'), 3, 3600000))) return { ok: false, error: 'Too many applications from your connection. Please try again in an hour.' };
  if (!(await allow(env, 'gov:' + gov, 2, 86400000))) return { ok: false, error: 'An application for this Governor ID was already sent today. Our officers will contact you.' };
  await appsTable(env);
  var now = new Date(), d = now.toISOString();
  var ref = 'M' + d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + '-' + gov.slice(-4) + '-' + (100 + Math.floor(Math.random() * 900));
  var token = crypto.randomUUID();
  var data = { gov: gov, name: name, power: power, kills: kills, vip: vip, kingdom: kd, why: why, spending: spend, role: role, buysRss: rss, hasFarms: farms,
    farmCount: farms === 'Yes' ? farmCount : '', farmMin: farms === 'Yes' ? fMin : '', farmMax: farms === 'Yes' ? fMax : '' };
  await env.DB.prepare('INSERT INTO apps (ref, ts, status, token, expect, data) VALUES (?, ?, ?, ?, ?, ?)').bind(ref, now.getTime(), 'Uploading', token, JSON.stringify(expect), JSON.stringify(data)).run();
  return { ok: true, ref: ref, token: token };
}

/* Simple counter: at most max hits per key within the window. Old counters are cleared as we go. */
async function allow(env, key, max, windowMs) {
  var now = Date.now();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)').run();
  var r = await env.DB.prepare('SELECT n, until FROM limits WHERE k = ?').bind(key).first();
  if (r && r.until > now && r.n >= max) return false;
  if (r && r.until > now) await env.DB.prepare('UPDATE limits SET n = n + 1 WHERE k = ?').bind(key).run();
  else await env.DB.prepare('INSERT INTO limits (k, n, until) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = 1, until = excluded.until').bind(key, now + windowMs).run();
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM limits WHERE until < ?').bind(now).run();
  return true;
}

async function appRecord(env, p) {
  await appsTable(env);
  var r = await env.DB.prepare('SELECT * FROM apps WHERE ref = ?').bind(String(p.ref || '')).first();
  if (!r || r.token !== String(p.token || '') || r.status !== 'Uploading') return null;
  r.expect = JSON.parse(r.expect || '{}');
  return r;
}

async function applyImage(env, p) {
  var rec = await appRecord(env, p);
  if (!rec) return { ok: false, error: 'Upload session expired. Please send the application again.' };
  var cat = String(p.cat || ''), idx = parseInt(p.index, 10);
  if (!APP_CATS[cat] || !(rec.expect[cat] > 0)) return { ok: false, error: 'Unknown screenshot section.' };
  if (!(idx >= 1 && idx <= (rec.expect[cat] || 0))) return { ok: true, skipped: true };
  var type = /^image[/](jpeg|png|webp)$/.test(String(p.type)) ? String(p.type) : 'image/jpeg';
  var bytes; try { bytes = b64ToBytes(p.data); } catch (e) { return { ok: false, error: 'A screenshot could not be read.' }; }
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return { ok: false, error: 'A screenshot was too large.' };
  var ext = type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg';
  await env.FILES.put('apps/' + rec.ref + '/' + cat + '/' + (idx < 10 ? '0' + idx : idx) + ext, bytes, { httpMetadata: { contentType: type } });
  return { ok: true };
}

async function appFiles(env, ref) {
  var keys = [], cursor;
  do { var l = await env.FILES.list({ prefix: 'apps/' + ref + '/', cursor: cursor }); l.objects.forEach(function (o) { keys.push(o.key); }); cursor = l.truncated ? l.cursor : null; } while (cursor);
  return keys.sort();
}

async function applyFinish(env, p) {
  var rec = await appRecord(env, p);
  if (!rec) return { ok: false, error: 'Upload session expired. Please send the application again.' };
  var keys = await appFiles(env, rec.ref), got = {};
  keys.forEach(function (k) { var c = k.split('/')[2]; got[c] = (got[c] || 0) + 1; });
  await env.DB.prepare('UPDATE apps SET status = ?, got = ? WHERE ref = ?').bind('Pending', JSON.stringify(got), rec.ref).run();
  await notifyApp(env, rec, got);
  return { ok: true };
}

/* Tell the officers' Discord channel about a new application (secret DISCORD_APPS_WEBHOOK). Never blocks the applicant. */
function shortNum(v) {
  var x = Number(v) || 0;
  if (x >= 1e9) return (Math.round(x / 1e7) / 100) + 'B';
  if (x >= 1e6) return (Math.round(x / 1e4) / 100) + 'M';
  if (x >= 1e3) return (Math.round(x / 10) / 100) + 'K';
  return String(x);
}
async function notifyApp(env, rec, got) {
  var hook = str(env.DISCORD_APPS_WEBHOOK);
  if (!/^https:[/][/](?:[a-z]+[.])?(?:discord|discordapp)[.]com[/]api[/]webhooks[/]/.test(hook)) return;
  try {
    var d = JSON.parse(rec.data || '{}');
    var v = function (x, max) { x = str(x).replace(/[*_`~|>@]/g, function (c) { return '\\' + c; }); return (x || '—').slice(0, max || 100); };
    var shots = 0; Object.keys(got || {}).forEach(function (k) { shots += got[k]; });
    var farms = d.hasFarms === 'Yes' ? d.farmCount + ' (' + shortNum(d.farmMin) + ' – ' + shortNum(d.farmMax) + ')' : 'No';
    var embed = {
      title: '📥 New migration application', url: 'https://kingdom3914.com/admin', color: 0xE7C690,
      description: '**' + v(d.name, 40) + '** · ID ' + v(d.gov, 20) + ' · Kingdom ' + v(d.kingdom, 10),
      fields: [
        { name: 'Power', value: shortNum(d.power), inline: true },
        { name: 'Kill points', value: shortNum(d.kills), inline: true },
        { name: 'VIP', value: v(d.vip, 20), inline: true },
        { name: 'KvK spending', value: v(d.spending, 40), inline: true },
        { name: 'Role', value: v(d.role, 40), inline: true },
        { name: 'Buys RSS', value: v(d.buysRss, 5), inline: true },
        { name: 'Farms', value: farms, inline: true },
        { name: 'Screenshots', value: String(shots), inline: true },
        { name: 'Why they want to migrate', value: v(d.why, 1000) }
      ],
      footer: { text: 'Ref ' + rec.ref + ' · review in Admin → Applications' },
      timestamp: new Date(rec.ts || Date.now()).toISOString()
    };
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Kingdom 3914', embeds: [embed], allowed_mentions: { parse: [] } }) });
  } catch (e) {}
}

/* ---------- Admin page: Applications ---------- */
async function adminApps(env) {
  if (!env.FILES) return { ok: true, apps: [], off: true };
  await appsTable(env);
  var res = await env.DB.prepare("SELECT ref, ts, status, data, got, note, by FROM apps WHERE status != 'Uploading' ORDER BY ts DESC LIMIT 500").all();
  return { ok: true, statuses: APP_STATUSES, cats: APP_CATS, apps: res.results.map(function (r) {
    return { ref: r.ref, ts: r.ts, status: r.status, data: JSON.parse(r.data || '{}'), got: JSON.parse(r.got || '{}'), note: r.note || '', by: r.by || '' };
  }) };
}
async function adminApp(env, p) {
  await appsTable(env);
  var r = await env.DB.prepare('SELECT ref FROM apps WHERE ref = ?').bind(str(p.ref)).first();
  if (!r) return { ok: false, error: 'That application no longer exists.' };
  return { ok: true, ref: r.ref, files: await appFiles(env, r.ref) };
}
async function adminAppFile(env, p) {
  var key = str(p.key), ref = str(p.ref);
  if (!ref || key.indexOf('apps/' + ref + '/') !== 0) return { ok: false, error: 'Not found.' };
  var o = await env.FILES.get(key);
  if (!o) return { ok: false, error: 'Not found.' };
  return { ok: true, type: (o.httpMetadata && o.httpMetadata.contentType) || 'image/jpeg', data: bytesToB64(await o.arrayBuffer()) };
}
async function adminAppSave(env, p, who) {
  await appsTable(env);
  var status = str(p.status), note = str(p.note).slice(0, 500), ref = str(p.ref);
  if (APP_STATUSES.indexOf(status) < 0) return { ok: false, error: 'Pick a status.' };
  var r = await env.DB.prepare('SELECT ref, data FROM apps WHERE ref = ?').bind(ref).first();
  if (!r) return { ok: false, error: 'That application no longer exists.' };
  await env.DB.prepare('UPDATE apps SET status = ?, note = ?, by = ? WHERE ref = ?').bind(status, note, str(who.Name), ref).run();
  var d = JSON.parse(r.data || '{}');
  await log(env, who, 'application', ref + ' (' + str(d.name) + ', ' + str(d.gov) + ') → ' + status + (note ? ': ' + note : ''));
  return { ok: true };
}
