/* Built 2026-11-13T10:50Z — deployed automatically from GitHub (server/ folder) */
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
  /* a bid counts while its status is empty or "valid" (not cancelled, replaced or withdrawn) */
  function isValid(b) { var s = str(b.Status).toLowerCase(); return s === '' || s === 'valid'; }
  /* Secret-bid auctions: each player has one hidden offer; at closing the highest offers fill the free ranks */
  function isSealed(e) { return str(e.Format).toLowerCase() === 'sealed'; }
  function parseReserved(v) {
    var a = []; try { a = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []); } catch (x) { a = []; }
    return (Array.isArray(a) ? a : []).filter(function (x) { return x && num(x.rank) >= 1 && str(x.gov); })
      .map(function (x) { return { rank: Math.floor(num(x.rank)), gov: str(x.gov), cost: Math.max(0, Math.floor(num(x.cost))), reason: str(x.reason) }; });
  }
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
      if (isSealed(e)) {
        var names = {}; (t.players || []).forEach(function (p) { names[str(p.GovID)] = str(p.Name); });
        var resv = parseReserved(e.Reserved).filter(function (x) { return x.rank <= count; }), held = {};
        resv.forEach(function (x) { var r = ranks[x.rank - 1]; r.reserved = { gov: x.gov, name: names[x.gov] || x.gov, cost: x.cost, reason: x.reason }; held[x.gov] = x; });
        var active = {}; /* latest valid offer per player (rows are in time order) */
        t.bids.forEach(function (b) {
          if (str(b.EventID) !== str(e.EventID)) return;
          total++;
          if (!isValid(b)) return;
          var g = str(b.GovID); if (held[g]) return;
          active[g] = { gov: g, name: str(b.Name) || names[g] || g, amount: num(b.Amount), time: toTime(b.Timestamp), row: b._row || 0 };
        });
        var pool = Object.keys(active).map(function (g) { return active[g]; });
        var minBid = Math.max(1, mins.length ? mins[0] : 0);
        var secret = !(e.Secret === false || /^(no|false|0)$/i.test(str(e.Secret)));
        var published = toTime(e.Published) || 0, resultsAt = toTime(e.Results) || (closes ? closes + 6 * 3600000 : 0);
        var out = { id: str(e.EventID), type: str(e.Type).toUpperCase() || 'MGE', title: str(e.Title), subject: str(e.Subject),
          opens: opens, closes: closes, phase: phase, increment: 0, ranks: ranks, sealed: true, minBid: minBid,
          secret: secret, published: published, publishedBy: str(e.PublishedBy), resultsAt: resultsAt, review: phase === 'closed' && !published,
          bidders: pool.length, bids: total, pool: active, held: held, lost: {} };
        if (phase !== 'upcoming') {
          pool.sort(function (a, b) { return (b.amount - a.amount) || (a.time - b.time) || (a.row - b.row); });
          var free = ranks.filter(function (r) { return !r.reserved; }), i2 = 0;
          pool.forEach(function (p) {
            if (i2 < free.length) { var r = free[i2++]; r.bid = p.amount; r.leader = p.name; r.leaderId = p.gov; r.count = 1; }
            else out.lost[p.gov] = p.amount;
          });
        }
        return out;
      }
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
      if (ev.sealed) {
        var h = ev.held[gov], mineS = ev.pool[gov];
        var lbl = ev.type + (ev.title ? ' · ' + ev.title : '');
        var final = ev.phase === 'closed' && ev.published;
        if (h) {
          if (final) { spent += h.cost; ledger.push({ time: ev.closes, amount: -h.cost, reason: lbl + ' · locked rank #' + h.rank }); }
          else reserved += h.cost;
          if (!final) positions.push({ event: ev.id, type: ev.type, rank: h.rank, locked: true, myBid: h.cost, sealed: true, review: ev.review });
        }
        if (mineS) {
          if (final) {
            var won = null; ev.ranks.forEach(function (r) { if (r.leaderId === gov) won = r; });
            if (won) { spent += won.bid; ledger.push({ time: ev.closes, amount: -won.bid, reason: lbl + ' · rank #' + won.rank + ' won' }); }
          } else {
            reserved += mineS.amount;
            positions.push({ event: ev.id, type: ev.type, rank: 0, sealed: true, secret: ev.secret, myBid: mineS.amount, review: ev.review });
          }
        }
        return;
      }
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
    var gov = me ? str(me.GovID) : '', staff = !!me && /^(admin|r4)$/i.test(str(me.Role));
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
      if (ev.sealed) {
        var mineOffer = gov && ev.pool[gov] ? ev.pool[gov].amount : 0, myLock = gov && ev.held[gov] ? ev.held[gov] : null, myWin = 0;
        /* amounts and names show: open auctions while live, everyone once published, staff during review */
        var reveal = ev.phase === 'closed' ? (ev.published || staff) : (ev.phase === 'open' && !ev.secret);
        var res = {
          id: ev.id, type: ev.type, title: ev.title, subject: ev.subject, opens: ev.opens, closes: ev.closes,
          phase: ev.phase, sealed: true, secret: ev.secret, review: ev.review, published: ev.published, publishedBy: ev.published ? ev.publishedBy : '',
          resultsAt: ev.resultsAt, provisional: reveal && !ev.published, minBid: ev.minBid, bidders: ev.bidders,
          myBid: mineOffer, myLock: myLock ? { rank: myLock.rank, cost: myLock.cost } : null,
          ranks: ev.ranks.map(function (r) {
            var o = { rank: r.rank, reward: r.reward, min: 0, bid: 0, leader: '', count: 0, mine: '' };
            if (r.reserved) { o.locked = { name: r.reserved.name, cost: r.reserved.cost }; o.mine = gov && r.reserved.gov === gov ? 'locked' : ''; }
            if (reveal && r.leaderId) { o.bid = r.bid; o.leader = r.leader; if (staff && ev.phase === 'closed') o.gov = r.leaderId; o.mine = r.leaderId === gov ? (ev.phase === 'closed' ? 'won' : 'leading') : ''; if (r.leaderId === gov) myWin = r.rank; }
            return o;
          })
        };
        if (ev.phase === 'closed' && ev.published && mineOffer) res.myResult = myWin ? { rank: myWin } : { lost: true };
        else if (reveal && mineOffer && ev.phase === 'open') res.myPlace = myWin;
        return res;
      }
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
    var typeOf = {}, sealedEv = {}; evs.forEach(function (ev) { typeOf[ev.id] = ev.type; if (ev.sealed) sealedEv[ev.id] = ev.secret ? 1 : 2; });
    out.feed = t.bids.filter(function (b) { var s = str(b.Status).toLowerCase(); return isValid(b) || (sealedEv[str(b.EventID)] && s === 'replaced'); }).slice(-30).reverse().map(function (b) {
      if (sealedEv[str(b.EventID)]) return sealedEv[str(b.EventID)] === 2 ? { sealed: true, open: true, name: str(b.Name), type: typeOf[str(b.EventID)] || '', event: str(b.EventID), rank: 0, amount: num(b.Amount), time: toTime(b.Timestamp) }
        : { sealed: true, name: '', type: typeOf[str(b.EventID)] || '', event: str(b.EventID), rank: 0, amount: 0, time: toTime(b.Timestamp) };
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
    if (!(amount > 0) && !p.withdraw) return { error: 'Enter a valid amount.' };
    var evs = events(t, now), ev = null;
    evs.forEach(function (e) { if (e.id === str(p.event)) ev = e; });
    if (!ev) return { error: 'Event not found.' };
    if (ev.phase === 'upcoming') return { error: 'Bidding has not opened yet.' };
    if (ev.phase === 'closed') return { error: 'Bidding is closed for this event.' };
    if (ev.sealed) {
      if (ev.held[gov]) return { error: 'You have a locked rank (#' + ev.held[gov].rank + ') in this auction, so you can’t bid here.' };
      var cur = ev.pool[gov];
      if (p.withdraw) {
        if (!cur) return { error: 'You have no offer in this auction.' };
        return { withdraw: true, gov: gov, type: ev.type, eventId: ev.id, amount: cur.amount };
      }
      if (amount < ev.minBid) return { error: 'The minimum offer is ' + fmt(ev.minBid) + ' credits.' };
      var bS = balance(gov, evs, t), availS = bS.available + (cur ? cur.amount : 0);
      if (amount > availS) return { error: availS > 0 ? 'Not enough credits. You can offer up to ' + fmt(availS) + '.' : 'You have no credits available for this auction.' };
      if (cur && cur.amount === amount) return { error: 'That is already your offer.' };
      return {
        row: { Timestamp: new Date(now), EventID: ev.id, Rank: 0, GovID: gov, Name: str(me.Name), Amount: amount, Status: 'valid' },
        rank: 0, type: ev.type, sealed: true, previous: cur ? cur.amount : 0
      };
    }
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

  return { gate: gate, state: state, checkBid: checkBid, calendar: calendar, balances: balances, texts: texts, toTime: toTime,
    events: events, isSealed: isSealed, parseReserved: parseReserved, isValid: isValid };
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
  Events: ['EventID', 'Type', 'Title', 'Subject', 'Opens', 'Closes', 'Ranks', 'Increment', 'Rewards', 'Minimums', 'Status', 'Format', 'Reserved', 'Secret', 'Results', 'Published', 'PublishedBy'],
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
  'Events': { EventID: ['id', 1], Type: ['enum', 1, ['MGE', 'GH']], Title: ['text', 0, 80], Subject: ['text', 0, 80], Opens: ['datetime', 1], Closes: ['datetime', 1], Ranks: ['int', 1, [1, 50]], Increment: ['int', 1, [1, 1000000]], Rewards: ['text', 0, 1500], Minimums: ['text', 0, 800], Status: ['enum', 1, ['open', 'draft', 'closed']], Results: ['datetime'] }
};

function str(v) { return v == null ? '' : String(v).trim(); }
function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' } });
}

export default {
  /* every 15 minutes (wrangler.toml [triggers]): MGE/GH reminders for R4s and admins */
  async scheduled(event, env, ctx) { ctx.waitUntil(runReminders(env, Date.now()).catch(function () {})); },
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return json({ ok: true });
    var path = new URL(req.url).pathname;
    if (path === '/discord/interactions' && req.method === 'POST') return discordInteraction(env, req, ctx);
    if (path === '/discord/start' || path === '/discord/callback') {
      try { return await discordRoute(env, req, path); }
      catch (err) { return Response.redirect(siteUrl(env) + '/migration.html?dc=error', 302); }
    }
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
function isFinal(e, now) {
  var closed = str(e.Status).toLowerCase() === 'closed' || (Core.toTime(e.Closes) && now >= Core.toTime(e.Closes));
  if (!closed) return false;
  return Core.isSealed(e) ? !!Core.toTime(e.Published) : true;
}
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
  if (action === 'discordWho') return discordWho(env, p);
  if (action === 'adminImport') return adminImport(env, p);
  var s = await tables(env), t = s.t, text = Core.texts(t);
  if (action === 'text') return { ok: true, text: text };
  /* everything else is for signed-in members only */
  var g = await memberGate(env, t, p);
  if (!g.me) return { ok: true, locked: true, authError: g.error || '', text: text };
  var role = str(g.me.Role).toLowerCase(), admin = role === 'admin', r4 = role === 'r4';
  if (action === 'login') return { ok: true, me: { name: str(g.me.Name), gov: str(g.me.GovID), admin: admin, r4: r4 }, text: text };
  if (action === 'bid') return placeBid(env, p, g.me);
  if (action === 'cancelRequest') return cancelRequest(env, p, g.me);
  /* R4 officers and admins: review window of MGE/GH auctions */
  if (/^(adminPublish|staffCancel|reqDecide|penaltySave)$/.test(action)) {
    if (!admin && !r4) return { ok: false, error: 'Only R4 officers and admins can do this.' };
    if (action === 'adminPublish') return adminPublish(env, p, g.me);
    if (action === 'staffCancel') return staffCancel(env, p, g.me);
    if (action === 'reqDecide') return reqDecide(env, p, g.me);
    return penaltySave(env, p, g.me);
  }
  if (/^admin|^textSave$/.test(action)) {
    /* R4 officers: migration applications only */
    if (r4 && /^adminApp(s|File|Save|Ticket)?$/.test(action)) {
      if (action === 'adminApps') return adminApps(env);
      if (action === 'adminAppTicket') return adminAppTicket(env, p, g.me);
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
    if (action === 'adminCreditBulk') return adminCreditBulk(env, p, g.me);
    if (action === 'adminBids') return adminBids(t);
    if (action === 'adminBid') return adminBid(env, p, g.me);
    if (action === 'adminReserve') return adminReserve(env, p, g.me);
    if (action === 'adminDiscordTest') return adminDiscordTest(env, p, g.me);
    if (action === 'adminApps') return adminApps(env);
    if (action === 'adminApp') return adminApp(env, p);
    if (action === 'adminAppFile') return adminAppFile(env, p);
    if (action === 'adminAppSave') return adminAppSave(env, p, g.me);
    if (action === 'adminAppDelete') return adminAppDelete(env, p, g.me);
    if (action === 'adminAppTicket') return adminAppTicket(env, p, g.me);
    if (action === 'adminDiscordPanel') return adminDiscordPanel(env, g.me);
    return { ok: false, error: 'Unknown action.' };
  }
  var res = action === 'calendar' ? { ok: true, calendar: Core.calendar(t) } : Core.state(t, p, Date.now());
  if (p.cal && action !== 'calendar') res.calendar = Core.calendar(t);
  if (res.events) await addRequests(env, res, str(g.me.GovID), admin || r4, text);
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
    var stmts = [], gov = c.withdraw ? c.gov : str(c.row && c.row.GovID), evId = c.withdraw ? c.eventId : str(c.row.EventID);
    if (c.sealed || c.withdraw) {
      /* a player has one secret offer per auction: the old one is marked replaced (or withdrawn) */
      t.bids.forEach(function (b) {
        if (str(b.EventID) === evId && str(b.GovID) === gov && Core.isValid(b)) { var o = clean(b); o.Status = c.withdraw ? 'withdrawn' : 'replaced'; stmts.push(updateRow(b._row, o)); b.Status = o.Status; }
      });
    }
    if (!c.withdraw) { c.row.Timestamp = now; stmts.push(insertRow('Bids', c.row)); }
    if (!(await commit(env, dv, stmts))) return RETRY;
    if (!c.withdraw) t.bids.push(c.row);
    return null;
  });
  if (r) return r;
  var out = Core.state(t, p, now);
  if (c.withdraw) {
    await log(env, who, 'bid', c.type + ' ' + c.eventId + ' — withdrew offer of ' + fmtN(c.amount));
    out.message = 'Your offer was withdrawn. The credits are free again.';
  } else if (c.sealed) {
    await log(env, who, 'bid', c.type + ' ' + c.row.EventID + ' — offer ' + fmtN(c.row.Amount) + (c.previous ? ' (was ' + fmtN(c.previous) + ')' : ''));
    out.message = 'Your offer of ' + fmtN(c.row.Amount) + ' credits is saved.';
  } else {
    await log(env, who, 'bid', c.type + ' ' + c.row.EventID + ' rank #' + c.rank + ' — ' + c.row.Amount.toLocaleString('en-US'));
    out.message = 'Bid placed on ' + c.type + ' rank #' + c.rank + '.';
  }
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
          out.Format = cur ? str(cur.Format) : (str(vals.Format) === 'ranks' ? '' : 'sealed');
          out.Reserved = cur ? (cur.Reserved || '') : '';
          out.Published = cur ? (cur.Published || '') : '';
          out.PublishedBy = cur ? (cur.PublishedBy || '') : '';
          out.Secret = out.Format !== 'sealed' ? '' : (vals.Secret === false || /^(no|false|0)$/i.test(str(vals.Secret)) ? 'no' : 'yes');
          if (!out.Results) out.Results = out.Closes + 6 * 3600000;
          if (out.Results < out.Closes) throw new Error('Results time must be after the closing time.');
          if (cur) {
            var nowE = Date.now(), wasClosed = isFinal(cur, nowE);
            if (wasClosed) {
              var same = function (k) { if (k === 'Opens' || k === 'Closes') return Core.toTime(out[k]) === Core.toTime(cur[k]); if (k === 'Ranks' || k === 'Increment') return Number(out[k]) === Number(cur[k]); if (k === 'Secret') return !/^(no|false|0)$/i.test(str(out[k])) === !/^(no|false|0)$/i.test(str(cur[k])); return str(out[k]).toLowerCase() === str(cur[k]).toLowerCase(); };
              var locked = ['EventID', 'Type', 'Opens', 'Closes', 'Ranks', 'Increment', 'Minimums', 'Status', 'Secret'].filter(function (k) { return !same(k); });
              if (locked.length) throw new Error('The results of this auction are published, so they are final. Only the title, description and rewards can still change.');
            }
            var hiLock = 0; Core.parseReserved(cur.Reserved).forEach(function (x) { hiLock = Math.max(hiLock, x.rank); });
            if (hiLock > out.Ranks) throw new Error('Rank #' + hiLock + ' is locked for a player. Remove that lock before lowering the number of ranks.');
            var hiBid = 0; (t.bids || []).forEach(function (b) { if (str(b.EventID) === str(cur.EventID) && Core.isValid(b)) hiBid = Math.max(hiBid, Number(b.Rank) || 0); });
            if (hiBid > out.Ranks) throw new Error('Rank #' + hiBid + ' already has bids. The number of ranks can’t go below ' + hiBid + '.');
          }
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

/* Give or take credits for many players at once: items = [{gov, amount}], one reason. All or nothing. */
async function adminCreditBulk(env, p, who) {
  var items = Array.isArray(p.items) ? p.items : [], reason = str(p.reason).slice(0, 200), seen = {}, done = [];
  if (!items.length) return { ok: false, error: 'Pick at least one player.' };
  if (items.length > 500) return { ok: false, error: 'At most 500 players at once.' };
  if (!reason) return { ok: false, error: 'Write a short reason (it goes in the activity log).' };
  for (var i = 0; i < items.length; i++) {
    var g0 = str(items[i] && items[i].gov), a0 = Number(items[i] && items[i].amount);
    if (!g0 || !(a0 % 1 === 0) || !a0 || Math.abs(a0) > 100000000) return { ok: false, error: 'Every line needs a Governor ID and a whole, non-zero amount.' };
    if (seen[g0]) return { ok: false, error: 'Governor ID ' + g0 + ' is listed twice.' };
    seen[g0] = 1;
  }
  var r = await withRetry(env, async function (dv, t) {
    var bal = Core.balances(t, Date.now()), stmts = [], bad = [], changes = [];
    items.forEach(function (it) {
      var gov = str(it.gov), amount = Number(it.amount), pl = null;
      t.players.forEach(function (x) { if (str(x.GovID) === gov) pl = x; });
      if (!pl) { bad.push('Governor ID ' + gov + ' is not a player.'); return; }
      var rows = t.credits.filter(function (c) { return str(c.GovID) === gov; }), before = 0;
      rows.forEach(function (c) { before += Number(c.Balance) || 0; });
      var after = before + amount, b = bal[gov] || { spent: 0, reserved: 0 };
      if (after < 0 || after < b.spent + b.reserved) { bad.push(str(pl.Name) + ' has already used ' + fmtN(b.spent + b.reserved) + ' credits, so their total can’t drop to ' + fmtN(after) + '.'); return; }
      if (rows.length) { var first = clean(rows[0]); first.Balance = after; stmts.push(updateRow(rows[0]._row, first)); rows.slice(1).forEach(function (c) { stmts.push(deleteRow(c._row)); }); }
      else stmts.push(insertRow('Credits', { GovID: gov, Name: str(pl.Name), Balance: after }));
      changes.push({ name: str(pl.Name), before: before, after: after });
    });
    if (bad.length) return { ok: false, error: bad.slice(0, 5).join(' ') + (bad.length > 5 ? ' (+' + (bad.length - 5) + ' more)' : '') };
    if (!(await commit(env, dv, stmts))) return RETRY;
    done = changes;
    var total = 0; changes.forEach(function (c) { total += c.after - c.before; });
    return { ok: true, count: changes.length, total: total };
  });
  if (r.ok && done.length) {
    var now = Date.now();
    try {
      await env.DB.batch(done.map(function (c) {
        var d = c.after - c.before;
        return env.DB.prepare('INSERT INTO log (ts, gov, name, action, detail) VALUES (?, ?, ?, ?, ?)').bind(now, str(who.GovID), str(who.Name), 'credits',
          ((d >= 0 ? '+' : '') + fmtN(d) + ' to ' + c.name + ' (' + fmtN(c.before) + ' → ' + fmtN(c.after) + '): ' + reason + ' [bulk]').slice(0, 500));
      }));
    } catch (e) {}
  }
  return r;
}

/* Every bid, newest first, with the auctions they belong to */
function adminBids(t) {
  var now = Date.now(), full = {}; Core.events(t, now).forEach(function (e) { full[e.id] = e; });
  var bids = t.bids.filter(function (b) { return str(b.EventID); }).map(function (b) {
    var st = str(b.Status).toLowerCase(), ev = full[str(b.EventID)], o = { r: b._row, sig: String(b._ver), time: Core.toTime(b.Timestamp), event: str(b.EventID), rank: Number(b.Rank) || 0, gov: str(b.GovID), name: str(b.Name),
      amount: Number(b.Amount) || 0, status: st === 'cancelled' ? 'cancelled' : (st === '' || st === 'valid') ? 'valid' : st };
    if (ev && ev.sealed) {
      o.sealed = true;
      if (o.status !== 'valid') o.state = o.status;
      else if (ev.phase !== 'closed') o.state = 'offer';
      else { var won = 0; ev.ranks.forEach(function (r) { if (r.leaderId === o.gov) won = r.rank; }); o.state = won ? 'won' : 'lost'; if (won) o.rank = won; if (ev.review) o.review = true; }
    }
    return o;
  }).reverse();
  var evs = Core.state(t, {}, now).events.map(function (e) { return { id: e.id, type: e.type, title: e.title, phase: e.phase, closes: e.closes, sealed: !!e.sealed, review: !!e.review, published: e.published || 0, secret: !!e.secret }; });
  return { ok: true, bids: bids, events: evs };
}

/* Lock ranks of a secret-bid auction for chosen players. items = [{ rank, gov, cost, reason }] (the full list) */
async function adminReserve(env, p, who) {
  var items = Array.isArray(p.items) ? p.items : [], info = null;
  if (items.length > 50) return { ok: false, error: 'Too many locked ranks.' };
  var r = await withRetry(env, async function (dv, t) {
    var ev = null; (t.events || []).forEach(function (e) { if (str(e.EventID) === str(p.event)) ev = e; });
    if (!ev) return { ok: false, error: 'Auction not found. Refresh the page.' };
    if (!Core.isSealed(ev)) return { ok: false, error: 'Locked ranks are only for secret-bid auctions.' };
    var now = Date.now();
    if (isFinal(ev, now)) return { ok: false, error: 'The results of this auction are published, so its ranks can’t change.' };
    var count = Math.max(1, Math.min(50, Number(ev.Ranks) || 15)), nm = {}, seenR = {}, seenG = {}, out = [];
    t.players.forEach(function (pl) { nm[str(pl.GovID)] = str(pl.Name); });
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {}, rank = Number(it.rank), gov = str(it.gov).replace(/[^0-9]/g, ''), cost = Number(String(it.cost).replace(/[, ]/g, ''));
      if (!(rank % 1 === 0 && rank >= 1 && rank <= count)) return { ok: false, error: 'Pick a rank from 1 to ' + count + '.' };
      if (!nm[gov]) return { ok: false, error: 'Governor ID ' + (gov || '(empty)') + ' is not a player.' };
      if (!(cost % 1 === 0 && cost >= 0 && cost <= 100000000)) return { ok: false, error: 'Cost for rank #' + rank + ' must be a whole number (0 or more).' };
      if (seenR[rank]) return { ok: false, error: 'Rank #' + rank + ' is locked twice.' };
      if (seenG[gov]) return { ok: false, error: nm[gov] + ' is locked on two ranks. One rank per player.' };
      if ((t.bids || []).some(function (b) { return str(b.EventID) === str(ev.EventID) && str(b.GovID) === gov && Core.isValid(b); }))
        return { ok: false, error: nm[gov] + ' already placed an offer in this auction. Cancel it in Admin → Bids first.' };
      seenR[rank] = 1; seenG[gov] = 1;
      out.push({ rank: rank, gov: gov, cost: cost, reason: str(it.reason).slice(0, 100) });
    }
    out.sort(function (a, b) { return a.rank - b.rank; });
    var row = clean(ev), oldList = Core.parseReserved(ev.Reserved);
    row.Reserved = out.length ? JSON.stringify(out) : '';
    if (!(await commit(env, dv, [updateRow(ev._row, row)]))) return RETRY;
    var key = function (x) { return x.rank + ':' + x.gov + ':' + x.cost; }, oldK = {}, newK = {};
    oldList.forEach(function (x) { oldK[key(x)] = x; }); out.forEach(function (x) { newK[key(x)] = x; });
    info = { ev: str(ev.EventID), added: out.filter(function (x) { return !oldK[key(x)]; }), removed: oldList.filter(function (x) { return !newK[key(x)]; }), nm: nm };
    return { ok: true, items: out.map(function (x) { return { rank: x.rank, gov: x.gov, name: nm[x.gov], cost: x.cost, reason: x.reason }; }) };
  });
  if (r.ok && info) {
    for (var a = 0; a < info.added.length; a++) { var x = info.added[a]; await log(env, who, 'auction', info.ev + ': locked rank #' + x.rank + ' for ' + (info.nm[x.gov] || x.gov) + ' (' + fmtN(x.cost) + ' credits)' + (x.reason ? ': ' + x.reason : '')); }
    for (var b2 = 0; b2 < info.removed.length; b2++) { var y = info.removed[b2]; await log(env, who, 'auction', info.ev + ': removed lock on rank #' + y.rank + ' (' + (info.nm[y.gov] || y.gov) + ')'); }
  }
  return r;
}

/* The results text: one line per rank. Used for the Home announcement and the Discord post. */
function resultLines(ev) {
  return ev.ranks.map(function (r) {
    var who = r.reserved ? r.reserved.name + ' 🔒' : r.leader ? r.leader + ' · ' + fmtN(r.bid) : 'no winner · không có';
    return '#' + r.rank + ' — ' + who;
  });
}
function resultTitle(ev) { return '🏆 ' + (ev.title || ev.id) + ' — results'; }
function discordResults(env, ev, lines) {
  var medal = ['🥇', '🥈', '🥉'], body = lines.map(function (l, i) { return (medal[i] || '▫️') + ' ' + dcEsc(l, 120); }).join('\n');
  var msg = '**' + dcEsc(resultTitle(ev), 120) + '**\n🇻🇳 **Kết quả ' + dcEsc(ev.title || ev.id, 80) + '**\n' + (ev.subject ? dcEsc(ev.subject, 80) + '\n' : '') + '\n' + body +
    '\n\nResults are final. Full list:\n🇻🇳 Kết quả là cuối cùng. Xem đầy đủ:\n' + siteUrl(env) + '/events.html?event=' + encodeURIComponent(ev.id);
  return msg.slice(0, 1990);
}

/* Publish the results of a closed auction: bid page + Home "Kingdom announcements" + Discord. Until then players only see "results coming".
   dry = true only returns the text for the preview. */
async function adminPublish(env, p, who) {
  var info = null;
  var r = await withRetry(env, async function (dv, t) {
    var row = null, now = Date.now(); (t.events || []).forEach(function (e) { if (str(e.EventID) === str(p.event)) row = e; });
    if (!row) return { ok: false, error: 'Auction not found. Refresh the page.' };
    if (!Core.isSealed(row)) return { ok: false, error: 'This auction has no review step.' };
    if (!(str(row.Status).toLowerCase() === 'closed' || (Core.toTime(row.Closes) && now >= Core.toTime(row.Closes)))) return { ok: false, error: 'Bidding is still open. Results can be published after it closes.' };
    if (Core.toTime(row.Published)) return { ok: false, error: 'These results are already published.' };
    var ev = Core.events({ events: [row], bids: t.bids, players: t.players }, now)[0];
    if (!ev) return { ok: false, error: 'This auction is a draft. Set it to open or closed first.' };
    var lines = resultLines(ev), title = resultTitle(ev), body = (ev.subject ? ev.subject + '\n' : '') + lines.join('\n');
    if (p.dry) return { ok: true, preview: { title: title, body: body, discord: !!str(env.DISCORD_ANNOUNCE_CHANNEL_ID) } };
    var upd = clean(row); upd.Published = now; upd.PublishedBy = str(who && who.Name);
    var news = { Date: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()), Type: 'Announcement', Title: title.slice(0, 120), Body: body.slice(0, 6000), Pinned: '' };
    if (!(await commit(env, dv, [updateRow(row._row, upd), insertRow('News', news)]))) return RETRY;
    info = { ev: ev, lines: lines };
    return { ok: true, published: now };
  });
  if (!r.ok || !info) return r;
  /* Discord announcement (best effort: the results are already public on the website) */
  var ch = str(env.DISCORD_ANNOUNCE_CHANNEL_ID);
  if (!ch || !str(env.DISCORD_BOT_TOKEN)) r.discord = 'off';
  else {
    try {
      var ar = announceRoles(env);
      var d = await dcApi(env, 'POST', '/channels/' + ch + '/messages', { content: withRoles(ar, discordResults(env, info.ev, info.lines)).slice(0, 2000), allowed_mentions: { parse: [], roles: ar } });
      r.discord = d.ok ? 'sent' : 'failed'; if (!d.ok) r.discordError = d.error;
    } catch (e) { r.discord = 'failed'; r.discordError = String((e && e.message) || e); }
  }
  var pt = dcEsc(info.ev.title || info.ev.id, 80), pb = dcEsc(who && who.Name, 60);
  await staffNotify(env, envn('📣 **Results published** · ' + pt + ' · by ' + pb + (r.discord === 'failed' ? '\n⚠️ The Discord announcement failed. Post it by hand.' : ''),
    '**Đã công bố kết quả** · ' + pt + ' · bởi ' + pb + (r.discord === 'failed' ? '\n⚠️ Đăng thông báo Discord thất bại. Hãy đăng thủ công.' : '')));
  await log(env, who, 'auction', info.ev.id + ': results published (Home' + (r.discord === 'sent' ? ' + Discord' : r.discord === 'failed' ? ', Discord failed: ' + (r.discordError || '') : '') + ')');
  return r;
}

/* ---------- Reminders for R4s and admins (staff channel, roles tagged). Each one is sent once. ---------- */
var R_DAY = 86400000, R_HOUR = 3600000, R_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], R_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rDay(t) { var d = new Date(t); return R_WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + R_MO[d.getUTCMonth()]; }
function rTime(t) { return rDay(t) + ' ' + new Date(t).toISOString().slice(11, 16) + ' UTC'; }
/* Vietnamese: "T7 14/11", "00:00 UTC, T7 14/11" */
var V_WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function vDay(t) { var d = new Date(t); return V_WD[d.getUTCDay()] + ' ' + d.getUTCDate() + '/' + (d.getUTCMonth() + 1); }
function vTime(t) { return new Date(t).toISOString().slice(11, 16) + ' UTC, ' + vDay(t); }
/* one message, English first, then Vietnamese */
function envn(en, vn, link) { return en + '\n🇻🇳 ' + vn + (link ? '\n' + link : ''); }
/* What is due right now: [{ key, at, text }]. A reminder is sent if its time has passed but not by more than its window. */
function remindersDue(t, now, env) {
  var out = [], link = siteUrl(env) + '/events.html';
  function due(key, at, win, text) { if (now >= at && now < at + win) out.push({ key: key, at: at, text: text }); }
  /* 1) calendar dates: prepare the auction */
  var cal = Core.calendar(t), gOf = {};
  cal.types.forEach(function (x) { gOf[x.n] = x.g; });
  cal.dates.forEach(function (d) {
    var g = gOf[d.e]; if ((g !== 'mge' && g !== 'gh') || !d.a) return;
    var type = g.toUpperCase(), D = Math.floor(d.a / R_DAY) * R_DAY, name = type === 'MGE' ? (d.x ? d.x + ' MGE' : 'MGE') : 'GH';
    var made = (t.events || []).filter(function (e) { return str(e.Type).toUpperCase() === type && Math.abs((Core.toTime(e.Closes) || 0) - (D - R_DAY + 13 * R_HOUR)) < 2 * R_DAY; })[0];
    due('prep5:' + type + ':' + D, D - 5 * R_DAY + 9 * R_HOUR, 12 * R_HOUR, envn(
      '📅 **' + name + ' starts in 5 days** (' + rDay(D) + ')\n' + (made ? '✅ The auction is already made (' + str(made.EventID) + '). Check the locked ranks and rewards.' :
        'Time to prepare: ' + type + ' auctions → New → pick ' + rDay(D) + '. Bidding opens ' + rTime(D - 2 * R_DAY) + '.'),
      '**' + name + ' bắt đầu sau 5 ngày** (' + vDay(D) + ')\n' + (made ? '✅ Phiên đấu giá đã được tạo (' + str(made.EventID) + '). Hãy kiểm tra các hạng khóa và phần thưởng.' :
        'Chuẩn bị ngay: ' + type + ' auctions → New → chọn ' + vDay(D) + '. Mở đấu giá lúc ' + vTime(D - 2 * R_DAY) + '.'), link));
    if (!made) due('prep3:' + type + ':' + D, D - 3 * R_DAY + 9 * R_HOUR, 12 * R_HOUR, envn(
      '⚠️ **' + name + ' starts in 3 days and there is no auction yet!**\nBidding should open ' + rTime(D - 2 * R_DAY) + '. Make it now: ' + type + ' auctions → New → pick ' + rDay(D) + '.',
      '**' + name + ' bắt đầu sau 3 ngày nhưng chưa có phiên đấu giá!**\nPhải mở đấu giá lúc ' + vTime(D - 2 * R_DAY) + '. Tạo ngay: ' + type + ' auctions → New → chọn ' + vDay(D) + '.', link));
  });
  /* 2) auctions: open, 3 h left, closed, results due */
  Core.events(t, now).forEach(function (ev) {
    if (!ev.sealed) return;
    var nm = ev.type + ' · ' + (ev.title || ev.id), l = link + '?event=' + encodeURIComponent(ev.id);
    due('open:' + ev.id, ev.opens, 3 * R_HOUR, envn('🟢 **Bidding is open** · ' + nm + '\nCloses ' + rTime(ev.closes) + '.',
      '**Đã mở đấu giá** · ' + nm + '\nĐóng lúc ' + vTime(ev.closes) + '.', l));
    due('c3h:' + ev.id, ev.closes - 3 * R_HOUR, 3 * R_HOUR, envn('⏰ **3 hours left** · ' + nm + '\n' + ev.bidders + ' player' + (ev.bidders === 1 ? ' has' : 's have') + ' made an offer so far.',
      '**Còn 3 giờ** · ' + nm + '\nĐã có ' + ev.bidders + ' người chơi trả giá.', l));
    if (ev.published) return;
    due('closed:' + ev.id, ev.closes, 3 * R_HOUR, envn('🔴 **Bidding closed — review now** · ' + nm + '\nCheck the provisional results and any cancel requests, then press Publish. Results are due ' + rTime(ev.resultsAt) + '.',
      '**Đã đóng đấu giá — kiểm tra ngay** · ' + nm + '\nXem kết quả tạm thời và các yêu cầu hủy, rồi bấm Publish. Hạn công bố kết quả: ' + vTime(ev.resultsAt) + '.', l));
    due('r2h:' + ev.id, ev.resultsAt - 2 * R_HOUR, 2 * R_HOUR, envn('⏳ **Results not published yet** · ' + nm + '\nThey are due in 2 hours (' + rTime(ev.resultsAt) + ').',
      '**Chưa công bố kết quả** · ' + nm + '\nCòn 2 giờ đến hạn (' + vTime(ev.resultsAt) + ').', l));
    due('rdue:' + ev.id, ev.resultsAt, 6 * R_HOUR, envn('🚨 **Results are due now** · ' + nm + '\nPlease review and press Publish results.',
      '**Đã đến hạn công bố kết quả** · ' + nm + '\nVui lòng kiểm tra và bấm Publish results.', l));
  });
  return out;
}
async function runReminders(env, now) {
  if (!str(env.DISCORD_STAFF_CHANNEL_ID)) return { sent: 0 };
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS remind (k TEXT PRIMARY KEY, ts INTEGER NOT NULL)').run();
  var t = (await tables(env)).t, list = remindersDue(t, now, env), sent = 0;
  for (var i = 0; i < list.length; i++) {
    /* claim first, so two runs can never send the same reminder twice */
    var c = await env.DB.prepare('INSERT OR IGNORE INTO remind (k, ts) VALUES (?, ?)').bind(list[i].key, now).run();
    if (!(c.meta && c.meta.changes)) continue;
    var res = await staffNotify(env, list[i].text);
    if (res === 'sent') sent++; else await env.DB.prepare('DELETE FROM remind WHERE k = ?').bind(list[i].key).run();
  }
  return { sent: sent };
}

/* Roles tagged on the results post (DISCORD_ANNOUNCE_ROLES, comma separated) */
function announceRoles(env) { return str(env.DISCORD_ANNOUNCE_ROLES).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return /^[0-9]{5,25}$/.test(x); }); }
function withRoles(roles, text) { return roles.length ? roles.map(function (x) { return '<@&' + x + '>'; }).join(' ') + '\n' + text : text; }

/* Admin: send one test message to the staff or the results channel, to check the bot can post (and ping the roles) */
async function adminDiscordTest(env, p, who) {
  var staff = p.target !== 'announce', ch = str(staff ? env.DISCORD_STAFF_CHANNEL_ID : env.DISCORD_ANNOUNCE_CHANNEL_ID);
  if (!/^[0-9]{5,25}$/.test(ch)) return { ok: false, error: 'This channel is not set yet.' };
  if (!str(env.DISCORD_BOT_TOKEN)) return { ok: false, error: 'The bot token is not set.' };
  var nm = dcEsc(who && who.Name, 60), roles = str(env.DISCORD_STAFF_ROLES).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return /^[0-9]{5,25}$/.test(x); });
  var body = staff
    ? { content: roles.map(function (x) { return '<@&' + x + '>'; }).join(' ') + '\n' + envn('✅ **3914 BOT test** · MGE/GH reminders are connected to this channel. Sent by ' + nm + '.', '**Thử nghiệm 3914 BOT** · nhắc nhở MGE/GH đã được kết nối với kênh này. Gửi bởi ' + nm + '.'), allowed_mentions: { parse: [], roles: roles } }
    : { content: withRoles(announceRoles(env), envn('✅ **3914 BOT test** · MGE/GH results will be posted in this channel. Sent by ' + nm + '.', '**Thử nghiệm 3914 BOT** · kết quả MGE/GH sẽ được đăng tại kênh này. Gửi bởi ' + nm + '.')), allowed_mentions: { parse: [], roles: announceRoles(env) } };
  var r = await dcApi(env, 'POST', '/channels/' + ch + '/messages', body);
  if (!r.ok) return { ok: false, error: 'Discord said: ' + r.error + (r.status === 403 ? ' (the bot needs View Channel and Send Messages there)' : '') };
  await log(env, who, 'auction', 'sent a Discord test message to the ' + (staff ? 'staff' : 'results') + ' channel');
  return { ok: true };
}

/* ---------- Review window: cancel requests, staff cancels, penalty ---------- */
function penaltyOf(text) { var v = str(text && text.cancel_penalty); return v === '' ? 200 : Math.max(0, Math.floor(Number(v)) || 0); }
async function creqTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS creq (id INTEGER PRIMARY KEY AUTOINCREMENT, ev TEXT NOT NULL, gov TEXT NOT NULL, name TEXT, amount INTEGER, reason TEXT, state TEXT NOT NULL, ts INTEGER NOT NULL, by TEXT, done INTEGER, penalty INTEGER)').run();
}
/* Message to the staff channel, tagging the R4 and admin roles (needs DISCORD_STAFF_CHANNEL_ID) */
async function staffNotify(env, text) {
  var ch = str(env.DISCORD_STAFF_CHANNEL_ID); if (!ch || !str(env.DISCORD_BOT_TOKEN)) return 'off';
  var roles = str(env.DISCORD_STAFF_ROLES).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return /^[0-9]{5,25}$/.test(x); });
  try {
    var d = await dcApi(env, 'POST', '/channels/' + ch + '/messages', { content: (roles.map(function (x) { return '<@&' + x + '>'; }).join(' ') + '\n' + text).slice(0, 1990), allowed_mentions: { parse: [], roles: roles } });
    return d.ok ? 'sent' : 'failed';
  } catch (e) { return 'failed'; }
}
function reviewEvent(t, id, now) {
  var row = null; (t.events || []).forEach(function (e) { if (str(e.EventID) === str(id)) row = e; });
  if (!row) return { error: 'Auction not found. Refresh the page.' };
  var ev = Core.events({ events: [row], bids: t.bids, players: t.players }, now)[0];
  if (!ev || !ev.sealed) return { error: 'This auction has no review step.' };
  if (ev.phase !== 'closed') return { error: 'Bidding is still open. Players can change or withdraw their own offers until it closes.' };
  if (ev.published) return { error: 'The results are published, so they are final.' };
  return { row: row, ev: ev };
}
/* Mark a player's offer cancelled, and optionally take the penalty from their credits. Runs inside withRetry. */
async function cancelOffer(env, dv, t, ev, gov, penalty) {
  var stmts = [], amount = 0;
  t.bids.forEach(function (b) { if (str(b.EventID) === ev.id && str(b.GovID) === gov && Core.isValid(b)) { var o = clean(b); o.Status = 'cancelled'; stmts.push(updateRow(b._row, o)); amount = Number(b.Amount) || 0; } });
  if (!stmts.length) return { error: 'This player has no offer in this auction any more.' };
  if (penalty > 0) {
    var rows = t.credits.filter(function (c) { return str(c.GovID) === gov; }), before = 0, nm = '';
    rows.forEach(function (c) { before += Number(c.Balance) || 0; });
    t.players.forEach(function (x) { if (str(x.GovID) === gov) nm = str(x.Name); });
    if (rows.length) { var first = clean(rows[0]); first.Balance = before - penalty; stmts.push(updateRow(rows[0]._row, first)); rows.slice(1).forEach(function (c) { stmts.push(deleteRow(c._row)); }); }
    else stmts.push(insertRow('Credits', { GovID: gov, Name: nm, Balance: -penalty }));
  }
  if (!(await commit(env, dv, stmts))) return RETRY;
  return { ok: true, amount: amount };
}

/* Player: ask to cancel an offer during the review window */
async function cancelRequest(env, p, who) {
  var reason = str(p.reason).slice(0, 300), gov = str(who.GovID), now = Date.now();
  if (reason.length < 3) return { ok: false, error: 'Write a short reason for the leaders.' };
  await creqTable(env);
  var t = (await tables(env)).t, x = reviewEvent(t, p.event, now);
  if (x.error) return { ok: false, error: x.error };
  var mine = x.ev.pool[gov];
  if (!mine) return { ok: false, error: x.ev.held[gov] ? 'Your rank is locked by the leaders. Talk to an admin.' : 'You have no offer in this auction.' };
  var dup = await env.DB.prepare("SELECT id FROM creq WHERE ev = ? AND gov = ? AND state = 'pending'").bind(x.ev.id, gov).first();
  if (dup) return { ok: false, error: 'You already asked. The leaders will answer soon.' };
  await env.DB.prepare("INSERT INTO creq (ev, gov, name, amount, reason, state, ts) VALUES (?, ?, ?, ?, ?, 'pending', ?)").bind(x.ev.id, gov, str(who.Name), mine.amount, reason, now).run();
  var pen = penaltyOf(Core.texts(t));
  var tl = dcEsc(x.ev.title || x.ev.id, 80), nmq = dcEsc(who.Name, 60);
  await staffNotify(env, envn('🔔 **Cancel request** · ' + tl + '\n**' + nmq + '** wants to cancel their offer of **' + fmtN(mine.amount) + '** credits.\nReason: ' + dcEsc(reason, 300) + '\nPenalty if accepted: ' + fmtN(pen) + ' credits.',
    '**Yêu cầu hủy** · ' + tl + '\n**' + nmq + '** muốn hủy giá đã trả **' + fmtN(mine.amount) + '** credits (lý do ở trên).\nPhạt nếu chấp nhận: ' + fmtN(pen) + ' credits.',
    'Accept / decline · Chấp nhận / từ chối: ' + siteUrl(env) + '/events.html?event=' + encodeURIComponent(x.ev.id)));
  await log(env, who, 'auction', x.ev.id + ': asked to cancel offer of ' + fmtN(mine.amount) + ': ' + reason);
  return { ok: true, message: 'Request sent. The leaders will accept or decline it.' };
}

/* R4/admin: accept (cancel the offer + penalty) or decline a request */
async function reqDecide(env, p, who) {
  await creqTable(env);
  var id = parseInt(p.id, 10) || 0, accept = p.accept === true, q = await env.DB.prepare('SELECT * FROM creq WHERE id = ?').bind(id).first();
  if (!q) return { ok: false, error: 'Request not found. Refresh the page.' };
  if (q.state !== 'pending') return { ok: false, error: 'This request was already answered.' };
  var pen = 0, out = null;
  if (accept) {
    var r = await withRetry(env, async function (dv, t) {
      var x = reviewEvent(t, q.ev, Date.now()); if (x.error) return { ok: false, error: x.error };
      pen = penaltyOf(Core.texts(t));
      var c = await cancelOffer(env, dv, t, x.ev, q.gov, pen);
      if (c === RETRY) return RETRY; if (c.error) return { ok: false, error: c.error };
      out = c; return { ok: true };
    });
    if (!r.ok) return r;
  }
  var ch = await env.DB.prepare("UPDATE creq SET state = ?, by = ?, done = ?, penalty = ? WHERE id = ? AND state = 'pending'").bind(accept ? 'accepted' : 'declined', str(who.Name), Date.now(), pen, id).run();
  if (!(ch.meta && ch.meta.changes)) return { ok: false, error: 'This request was already answered.' };
  await log(env, who, 'auction', q.ev + ': ' + (accept ? 'accepted' : 'declined') + ' cancel request of ' + q.name + ' (' + fmtN(q.amount) + ')' + (accept && pen ? ', penalty ' + fmtN(pen) : ''));
  var by = dcEsc(who.Name, 60), whoq = dcEsc(q.name, 60);
  await staffNotify(env, envn((accept ? '✅ ' : '❌ ') + by + ' ' + (accept ? 'accepted' : 'declined') + ' the cancel request of **' + whoq + '** (' + q.ev + ')' + (accept && pen ? ' · penalty ' + fmtN(pen) + ' credits' : '') + '.',
    by + ' đã ' + (accept ? 'chấp nhận' : 'từ chối') + ' yêu cầu hủy của **' + whoq + '**' + (accept && pen ? ' · phạt ' + fmtN(pen) + ' credits' : '') + '.'));
  return { ok: true, penalty: pen };
}

/* R4/admin: cancel a player's offer during review (no penalty unless ticked) */
async function staffCancel(env, p, who) {
  var reason = str(p.reason).slice(0, 200), gov = str(p.gov), info = null, pen = 0;
  if (!reason) return { ok: false, error: 'Write a short reason (it goes in the activity log).' };
  var r = await withRetry(env, async function (dv, t) {
    var x = reviewEvent(t, p.event, Date.now()); if (x.error) return { ok: false, error: x.error };
    pen = p.penalty === true ? penaltyOf(Core.texts(t)) : 0;
    var c = await cancelOffer(env, dv, t, x.ev, gov, pen);
    if (c === RETRY) return RETRY; if (c.error) return { ok: false, error: c.error };
    info = { ev: x.ev.id, name: (x.ev.pool[gov] || {}).name || gov, amount: c.amount }; return { ok: true };
  });
  if (r.ok) {
    await log(env, who, 'auction', info.ev + ': cancelled offer of ' + info.name + ' (' + fmtN(info.amount) + ')' + (pen ? ', penalty ' + fmtN(pen) : '') + ': ' + reason);
    await creqTable(env);
    await env.DB.prepare("UPDATE creq SET state = 'accepted', by = ?, done = ?, penalty = ? WHERE ev = ? AND gov = ? AND state = 'pending'").bind(str(who.Name), Date.now(), pen, info.ev, gov).run();
  }
  return r;
}

/* R4/admin: the cancel penalty (0 = no penalty) */
async function penaltySave(env, p, who) {
  var v = Number(String(p.amount).replace(/[, ]/g, ''));
  if (!(v % 1 === 0 && v >= 0 && v <= 1000000)) return { ok: false, error: 'Enter a whole number (0 = no penalty).' };
  var r = await textSave(env, { items: { cancel_penalty: String(v) } }, who);
  return r.ok ? { ok: true, penalty: v } : r;
}

/* Adds cancel-request info to auctions under review: the player's own request, and the pending list for staff */
async function addRequests(env, res, gov, staff, text) {
  var ids = (res.events || []).filter(function (e) { return e.sealed && e.review; }).map(function (e) { return e.id; });
  if (staff) res.penalty = penaltyOf(text);
  if (!ids.length) return;
  await creqTable(env);
  var st = env.DB.prepare('SELECT id, ev, gov, name, amount, reason, state, ts, by, penalty FROM creq WHERE ev IN (' + ids.map(function () { return '?'; }).join(',') + ') ORDER BY id');
  var rows = (await st.bind.apply(st, ids).all()).results || [];
  res.events.forEach(function (e) {
    if (ids.indexOf(e.id) < 0) return;
    var mine = rows.filter(function (q) { return q.ev === e.id && q.gov === gov; }).pop();
    if (mine) e.myRequest = { state: mine.state, reason: mine.reason, penalty: mine.penalty || 0 };
    e.penalty = penaltyOf(text);
    if (staff) e.requests = rows.filter(function (q) { return q.ev === e.id && q.state === 'pending'; }).map(function (q) { return { id: q.id, gov: q.gov, name: q.name, amount: q.amount, reason: q.reason, time: q.ts }; });
  });
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
    var now = Date.now(), evRow = null; (t.events || []).forEach(function (e) { if (str(e.EventID) === str(cur.EventID)) evRow = e; });
    if (evRow && isFinal(evRow, now)) return { ok: false, error: 'The results of this auction are published, so they are final and bids can’t be changed.' };
    var s0 = str(cur.Status).toLowerCase();
    if (!cancel && s0 !== 'cancelled') return { ok: false, error: 'Only cancelled bids can be restored.' };
    if (!cancel && evRow && Core.isSealed(evRow) && t.bids.some(function (b) { return b !== cur && str(b.EventID) === str(cur.EventID) && str(b.GovID) === str(cur.GovID) && Core.isValid(b); }))
      return { ok: false, error: str(cur.Name) + ' already has a newer offer in this auction, so the old one can’t be restored.' };
    var out = clean(cur); out.Status = cancel ? 'cancelled' : 'valid';
    /* safety: the change must not leave any player with negative credits who wasn't negative before */
    var before = Core.balances(t, now); cur.Status = out.Status; var after = Core.balances(t, now); cur.Status = s0;
    var hurt = Object.keys(after).filter(function (g) { return after[g].available < 0 && after[g].available < before[g].available; });
    if (hurt.length) {
      var nm = {}; t.players.forEach(function (pl) { nm[str(pl.GovID)] = str(pl.Name); });
      return { ok: false, error: 'This would leave ' + hurt.map(function (g) { return nm[g] || g; }).join(', ') + ' with negative credits (they already used them elsewhere), so it was not done.' };
    }
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
  var dc = null;
  if (dcOn(env) && str(p.dc)) dc = await dcLink(env, p.dc); /* optional: if it expired, the player can still open the ticket from Discord */
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
  var AB = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', rnd = crypto.getRandomValues(new Uint8Array(5)), tail = '';
  for (var ri = 0; ri < 5; ri++) tail += AB[rnd[ri] % AB.length];
  var ref = 'M' + d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + '-' + gov.slice(-4) + '-' + tail;
  var token = crypto.randomUUID();
  var data = { gov: gov, name: name, power: power, kills: kills, vip: vip, kingdom: kd, why: why, spending: spend, role: role, buysRss: rss, hasFarms: farms,
    farmCount: farms === 'Yes' ? farmCount : '', farmMin: farms === 'Yes' ? fMin : '', farmMax: farms === 'Yes' ? fMax : '' };
  await env.DB.prepare('INSERT INTO apps (ref, ts, status, token, expect, data) VALUES (?, ?, ?, ?, ?, ?)').bind(ref, now.getTime(), 'Uploading', token, JSON.stringify(expect), JSON.stringify(data)).run();
  if (dc) { await ticketsTable(env); await env.DB.prepare('INSERT OR REPLACE INTO tickets (ref, uid, uname, n, ch, state, err) VALUES (?, ?, ?, ?, NULL, ?, NULL)').bind(ref, dc.uid, dc.uname, dc.n, 'waiting').run(); }
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
  var tk = await ticketFromWebsite(env, rec);
  await notifyApp(env, rec, got, tk);
  return { ok: true, ticket: tk && tk.url ? tk.url : '', ticketError: tk && tk.error ? tk.error : '' };
}

/* Tell the officers' Discord channel about a new application (secret DISCORD_APPS_WEBHOOK). Never blocks the applicant. */
function shortNum(v) {
  var x = Number(v) || 0;
  if (x >= 1e9) return (Math.round(x / 1e7) / 100) + 'B';
  if (x >= 1e6) return (Math.round(x / 1e4) / 100) + 'M';
  if (x >= 1e3) return (Math.round(x / 10) / 100) + 'K';
  return String(x);
}
async function notifyApp(env, rec, got, tk) {
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
      ].concat(tk ? [{ name: 'Discord ticket', value: tk.url ? '<#' + tk.ch + '> · ' + v(tk.uname, 40) : '⚠️ Could not be created: ' + v(tk.error, 200) }] : []),
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
  var tks = {};
  await ticketsTable(env);
  (await env.DB.prepare('SELECT ref, uid, uname, ch, state, err FROM tickets').all()).results.forEach(function (x) { tks[x.ref] = x; });
  var g = str(env.DISCORD_GUILD_ID);
  return { ok: true, statuses: APP_STATUSES, cats: APP_CATS, discord: dcOn(env), panel: /^[0-9]{5,25}$/.test(str(env.DISCORD_PANEL_CHANNEL_ID)), apps: res.results.map(function (r) {
    var k = tks[r.ref];
    return { ref: r.ref, ts: r.ts, status: r.status, data: JSON.parse(r.data || '{}'), got: JSON.parse(r.got || '{}'), note: r.note || '', by: r.by || '',
      ticket: k ? { user: k.uname || '', state: k.state || '', error: k.err || '', url: k.ch ? 'https://discord.com/channels/' + g + '/' + k.ch : '' } : null };
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
/* Delete one application and all its screenshots (admins only) */
async function adminAppDelete(env, p, who) {
  await appsTable(env);
  var ref = str(p.ref);
  if (!/^[A-Za-z0-9-]{4,40}$/.test(ref)) return { ok: false, error: 'That application no longer exists.' };
  var r = await env.DB.prepare('SELECT ref, data FROM apps WHERE ref = ?').bind(ref).first();
  if (!r) return { ok: false, error: 'That application no longer exists.' };
  var files = 0, bytes = 0, cursor;
  do {
    var list = await env.FILES.list({ prefix: 'apps/' + ref + '/', cursor: cursor, limit: 1000 });
    var keys = list.objects.map(function (o) { bytes += o.size || 0; return o.key; });
    if (keys.length) { await env.FILES.delete(keys); files += keys.length; }
    cursor = list.truncated ? list.cursor : null;
  } while (cursor);
  await env.DB.prepare('DELETE FROM apps WHERE ref = ?').bind(ref).run();
  await ticketsTable(env);
  var tk = await env.DB.prepare('SELECT ch FROM tickets WHERE ref = ?').bind(ref).first(), chGone = false;
  if (tk && tk.ch && dcOn(env)) { var dr = await dcApi(env, 'DELETE', '/channels/' + tk.ch); chGone = dr.ok || dr.status === 404; }
  await env.DB.prepare('DELETE FROM tickets WHERE ref = ?').bind(ref).run();
  var d = JSON.parse(r.data || '{}');
  await log(env, who, 'application', 'deleted ' + ref + ' (' + str(d.name) + ', ' + str(d.gov) + ') and ' + files + ' screenshot' + (files === 1 ? '' : 's'));
  return { ok: true, files: files, bytes: bytes, ticketDeleted: chGone };
}
async function adminAppSave(env, p, who) {
  await appsTable(env);
  var status = str(p.status), note = str(p.note).slice(0, 500), ref = str(p.ref);
  if (APP_STATUSES.indexOf(status) < 0) return { ok: false, error: 'Pick a status.' };
  var r = await env.DB.prepare('SELECT ref, data, status FROM apps WHERE ref = ?').bind(ref).first();
  if (!r) return { ok: false, error: 'That application no longer exists.' };
  if (r.status !== status) await ticketStatus(env, ref, status);
  await env.DB.prepare('UPDATE apps SET status = ?, note = ?, by = ? WHERE ref = ?').bind(status, note, str(who.Name), ref).run();
  var d = JSON.parse(r.data || '{}');
  await log(env, who, 'application', ref + ' (' + str(d.name) + ', ' + str(d.gov) + ') → ' + status + (note ? ': ' + note : ''));
  return { ok: true };
}

/* ---------- Discord: "Connect Discord" on the Migrate page and an automatic private ticket per application ----------
   Turned on only when these are set in Cloudflare:
   secrets DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN · variables DISCORD_CLIENT_ID, DISCORD_PUBLIC_KEY, DISCORD_GUILD_ID,
   DISCORD_CATEGORY_ID (where tickets go), DISCORD_STAFF_ROLES (role IDs that can see tickets, comma separated),
   DISCORD_PANEL_CHANNEL_ID (where the "Open my migration ticket" button is posted) */
var DC_API = 'https://discord.com/api/v10';
var DC_SEE = '117760'; /* view, send, embed links, attach files, read history */
function dcOn(env) { return !!(str(env.DISCORD_CLIENT_ID) && str(env.DISCORD_CLIENT_SECRET) && str(env.DISCORD_BOT_TOKEN) && str(env.DISCORD_GUILD_ID)); }
function siteUrl(env) { return (str(env.SITE_URL) || 'https://kingdom3914.com').replace(/[/]+$/, ''); }
function dcEsc(x, max) { x = str(x).replace(/[*_`~|>@#<]/g, function (c) { return '\\' + c; }); return (x || '—').slice(0, max || 100); }
async function dcTables(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS dlink (n TEXT PRIMARY KEY, uid TEXT NOT NULL, uname TEXT, tok TEXT, ts INTEGER NOT NULL)').run();
}
async function ticketsTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS tickets (ref TEXT PRIMARY KEY, uid TEXT, uname TEXT, n TEXT, ch TEXT, state TEXT, err TEXT)').run();
}
async function dcApi(env, method, path, body) {
  var r = await fetch(DC_API + path, { method: method, headers: { 'Authorization': 'Bot ' + str(env.DISCORD_BOT_TOKEN), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  var data = null; try { data = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, data: data, error: (data && data.message) || ('Discord error ' + r.status) };
}

/* Discord login: /discord/start?n=<random id from the page> → Discord → /discord/callback → back to the Migrate page */
async function discordRoute(env, req, path) {
  var u = new URL(req.url), back = siteUrl(env) + '/migration.html';
  if (!dcOn(env)) return Response.redirect(back + '?dc=off', 302);
  var redirect = u.origin + '/discord/callback', secret = str(env.DISCORD_CLIENT_SECRET);
  if (path === '/discord/start') {
    var n = str(u.searchParams.get('n'));
    if (!/^[a-f0-9]{32}$/.test(n)) return Response.redirect(back + '?dc=error', 302);
    var state = n + '.' + (await hmacHex(secret, 'dc:' + n)).slice(0, 32);
    return Response.redirect('https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id: str(env.DISCORD_CLIENT_ID), response_type: 'code',
      redirect_uri: redirect, scope: 'identify guilds.join', state: state, prompt: 'none' }).toString(), 302);
  }
  var st = str(u.searchParams.get('state')).split('.'), code = str(u.searchParams.get('code'));
  if (st.length !== 2 || !/^[a-f0-9]{32}$/.test(st[0]) || st[1] !== (await hmacHex(secret, 'dc:' + st[0])).slice(0, 32)) return Response.redirect(back + '?dc=error', 302);
  if (!code) return Response.redirect(back + '?dc=denied', 302);
  var tr = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: str(env.DISCORD_CLIENT_ID), client_secret: secret, grant_type: 'authorization_code', code: code, redirect_uri: redirect }).toString() });
  var tok = await tr.json().catch(function () { return {}; });
  if (!tr.ok || !tok.access_token) return Response.redirect(back + '?dc=error', 302);
  var me = await (await fetch(DC_API + '/users/@me', { headers: { 'Authorization': 'Bearer ' + tok.access_token } })).json().catch(function () { return {}; });
  if (!me || !me.id) return Response.redirect(back + '?dc=error', 302);
  await dcTables(env);
  var now = Date.now();
  await env.DB.prepare('INSERT OR REPLACE INTO dlink (n, uid, uname, tok, ts) VALUES (?, ?, ?, ?, ?)').bind(st[0], str(me.id), str(me.username).slice(0, 40), tok.access_token, now).run();
  await env.DB.prepare('DELETE FROM dlink WHERE ts < ?').bind(now - 86400000).run();
  return Response.redirect(back + '?dc=ok', 302);
}
async function dcLink(env, n) {
  n = str(n);
  if (!/^[a-f0-9]{32}$/.test(n)) return null;
  await dcTables(env);
  var r = await env.DB.prepare('SELECT n, uid, uname, tok, ts FROM dlink WHERE n = ?').bind(n).first();
  return r && r.ts > Date.now() - 6 * 3600000 ? r : null;
}
/* The Migrate page asks: is Discord required, and is this browser connected? */
async function discordWho(env, p) {
  if (!dcOn(env)) return { ok: true, on: false };
  var r = await dcLink(env, p.n);
  var pc = str(env.DISCORD_PANEL_CHANNEL_ID);
  return { ok: true, on: true, name: r ? r.uname : '', panel: /^[0-9]{5,25}$/.test(pc) ? 'https://discord.com/channels/' + str(env.DISCORD_GUILD_ID) + '/' + pc : '' };
}

/* Create the private ticket channel for one application and post the welcome. tok = the player's login token (website path) or '' (Discord button path). */
async function createTicket(env, ref, d, uid, uname, tok) {
  var g = str(env.DISCORD_GUILD_ID);
  await ticketsTable(env);
  async function fail(msg) {
    await env.DB.prepare('INSERT INTO tickets (ref, uid, uname, state, err) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ref) DO UPDATE SET uid = excluded.uid, uname = excluded.uname, state = excluded.state, err = excluded.err')
      .bind(ref, uid, uname, 'failed', str(msg).slice(0, 300)).run();
    return { error: msg, uname: uname };
  }
  try {
    if (tok) {
      var add = await dcApi(env, 'PUT', '/guilds/' + g + '/members/' + uid, { access_token: tok });
      if (!add.ok) return fail('Could not add them to the Discord server (' + add.error + ')');
    }
    var slug = str(d.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || str(d.gov);
    var over = [{ id: g, type: 0, allow: '0', deny: '1024' }, { id: uid, type: 1, allow: DC_SEE, deny: '0' }, { id: str(env.DISCORD_CLIENT_ID), type: 1, allow: DC_SEE, deny: '0' }];
    str(env.DISCORD_STAFF_ROLES).split(/[\s,]+/).forEach(function (id) { if (/^[0-9]{5,25}$/.test(id)) over.push({ id: id, type: 0, allow: DC_SEE, deny: '0' }); });
    var body = { name: 'app-' + slug, type: 0, topic: 'Migration application ' + ref + ' · ' + str(d.name) + ' (' + str(d.gov) + ')', permission_overwrites: over };
    if (/^[0-9]{5,25}$/.test(str(env.DISCORD_CATEGORY_ID))) body.parent_id = str(env.DISCORD_CATEGORY_ID);
    var ch = await dcApi(env, 'POST', '/guilds/' + g + '/channels', body);
    if (!ch.ok || !ch.data || !ch.data.id) return fail('Could not create the ticket channel (' + ch.error + ')');
    var chId = str(ch.data.id);
    await env.DB.prepare('INSERT INTO tickets (ref, uid, uname, ch, state, err) VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT(ref) DO UPDATE SET uid = excluded.uid, uname = excluded.uname, ch = excluded.ch, state = excluded.state, err = NULL')
      .bind(ref, uid, uname, chId, 'open').run();
    await dcApi(env, 'POST', '/channels/' + chId + '/messages', {
      content: '<@' + uid + '>', allowed_mentions: { users: [uid] },
      embeds: [{ color: 0xE7C690, title: 'Welcome, ' + dcEsc(d.name, 40) + '!',
        description: 'This is your private migration ticket. Our officers have your application and screenshots. They will review it and reply here, and you can ask questions anytime.\n\n' +
          '**Status:** 🕓 Received, waiting for review\n**Reference:** ' + ref,
        fields: [
          { name: 'Governor ID', value: dcEsc(d.gov, 20), inline: true },
          { name: 'Power', value: shortNum(d.power), inline: true },
          { name: 'Kill points', value: shortNum(d.kills), inline: true },
          { name: 'VIP', value: dcEsc(d.vip, 20), inline: true },
          { name: 'Kingdom', value: dcEsc(d.kingdom, 10), inline: true },
          { name: 'Role', value: dcEsc(d.role, 40), inline: true }
        ], footer: { text: 'Kingdom 3914 · status updates are posted here automatically' } }]
    });
    return { ch: chId, url: 'https://discord.com/channels/' + g + '/' + chId, uname: uname };
  } catch (e) { return fail(String((e && e.message) || e)); }
}
/* Website path: the player connected Discord on the Migrate page */
async function ticketFromWebsite(env, rec) {
  if (!dcOn(env)) return null;
  await ticketsTable(env);
  var tk = await env.DB.prepare('SELECT * FROM tickets WHERE ref = ?').bind(rec.ref).first();
  if (!tk || tk.state !== 'waiting') return null;
  var link = await dcLink(env, tk.n);
  var r = await createTicket(env, rec.ref, JSON.parse(rec.data || '{}'), tk.uid, tk.uname, link ? link.tok : '');
  if (r.ch) await env.DB.prepare('DELETE FROM dlink WHERE n = ?').bind(tk.n).run();
  return r;
}

/* Discord path: the player clicks "Open my migration ticket" in the Discord channel and pastes their application reference.
   Discord sends the click here (Interactions endpoint URL = <server>/discord/interactions), signed with the app's public key. */
function hexBytes(h) { var o = new Uint8Array(h.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
async function dcVerify(env, req, body) {
  var sig = str(req.headers.get('X-Signature-Ed25519')), ts = str(req.headers.get('X-Signature-Timestamp')), pk = str(env.DISCORD_PUBLIC_KEY);
  if (!/^[a-f0-9]{128}$/i.test(sig) || !ts || !/^[a-f0-9]{64}$/i.test(pk)) return false;
  try {
    var key = await crypto.subtle.importKey('raw', hexBytes(pk), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hexBytes(sig), new TextEncoder().encode(ts + body));
  } catch (e) { return false; }
}
async function discordInteraction(env, req, ctx) {
  var body = await req.text();
  if (!(await dcVerify(env, req, body))) return new Response('Bad signature', { status: 401 });
  var it = {}; try { it = JSON.parse(body); } catch (e) {}
  if (it.type === 1) return json({ type: 1 });
  var data = it.data || {};
  if (it.type === 3 && data.custom_id === 'k3914_open') {
    return json({ type: 9, data: { custom_id: 'k3914_ref', title: 'Open my migration ticket', components: [{ type: 1, components: [{ type: 4, custom_id: 'ref', label: 'Your application reference', style: 1, min_length: 8, max_length: 30, required: true, placeholder: 'Paste it from the website, e.g. M261113-4466-K7P2Q' }] }] } });
  }
  if (it.type === 5 && data.custom_id === 'k3914_ref') {
    var ref = '';
    (data.components || []).forEach(function (row) { (row.components || []).forEach(function (c) { if (c.custom_id === 'ref') ref = str(c.value); }); });
    var user = (it.member && it.member.user) || it.user || {};
    var work = (async function () {
      var msg;
      try { msg = await ticketFromButton(env, ref, str(user.id), str(user.username).slice(0, 40)); } catch (e) { msg = 'Something went wrong. Please try again or ask an officer.'; }
      await fetch(DC_API + '/webhooks/' + str(env.DISCORD_CLIENT_ID) + '/' + it.token + '/messages/@original', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: msg, allowed_mentions: { parse: [] } }) });
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
    return json({ type: 5, data: { flags: 64 } }); /* "thinking…", only visible to them */
  }
  return json({ type: 4, data: { content: 'Unknown action.', flags: 64 } });
}
async function ticketFromButton(env, refIn, uid, uname) {
  if (!dcOn(env)) return 'Tickets are not set up yet. Please ask an officer.';
  var ref = str(refIn).toUpperCase().replace(/[\s#:"'`]/g, '').replace(/^REF/, '');
  if (!uid || !/^M[0-9]{6}-[0-9]{1,4}-[0-9A-Z]{3,6}$/.test(ref)) return 'That doesn’t look like an application reference. Copy it from the website (it looks like **M261113-4466-K7P2Q**) and try again.';
  if (!(await allow(env, 'dct:' + uid, 5, 3600000))) return 'Too many tries. Please wait an hour or contact an officer.';
  await appsTable(env); await ticketsTable(env);
  var app = await env.DB.prepare("SELECT ref, data FROM apps WHERE ref = ? AND status != 'Uploading'").bind(ref).first();
  if (!app) return 'We couldn’t find application **' + ref + '**. Check that you copied the whole reference, or apply first at ' + siteUrl(env) + '/migration.html.';
  var tk = await env.DB.prepare('SELECT * FROM tickets WHERE ref = ?').bind(app.ref).first();
  if (tk && tk.ch && (tk.state === 'open' || tk.state === 'closed')) {
    if (tk.uid === uid) return tk.state === 'open' ? 'Your ticket is already open: <#' + tk.ch + '>' : 'Your ticket was closed by an officer. Please contact an officer if you need help.';
    return 'A ticket for this application was already opened by another Discord account. If this is your application, please contact an officer.';
  }
  var r = await createTicket(env, app.ref, JSON.parse(app.data || '{}'), uid, uname, '');
  return r.ch ? '✅ Your private ticket is ready: <#' + r.ch + '>' : 'We couldn’t create your ticket (' + r.error + '). Please contact an officer.';
}
/* Admin: post the "Open my migration ticket" button in the channel set as DISCORD_PANEL_CHANNEL_ID */
async function adminDiscordPanel(env, who) {
  if (!dcOn(env)) return { ok: false, error: 'Discord tickets are not set up.' };
  var ch = str(env.DISCORD_PANEL_CHANNEL_ID);
  if (!/^[0-9]{5,25}$/.test(ch)) return { ok: false, error: 'The channel for the button is not set (DISCORD_PANEL_CHANNEL_ID).' };
  var r = await dcApi(env, 'POST', '/channels/' + ch + '/messages', {
    embeds: [{ color: 0xE7C690, title: 'Migration to Kingdom 3914',
      description: '**1.** Apply on our website: ' + siteUrl(env) + '/migration.html\n**2.** At the end, press **Copy** next to your application reference.\n**3.** Click the button below and paste your reference.\n\nA private ticket opens where our officers review your application and chat with you.' }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Open my migration ticket', custom_id: 'k3914_open', emoji: { name: '🎫' } }] }]
  });
  if (!r.ok) return { ok: false, error: r.error };
  await log(env, who, 'application', 'posted the ticket button in Discord');
  return { ok: true };
}

var DC_STATUS = {
  Pending: '🕓 **Status:** back to waiting for review.',
  Contacted: '🔎 **Status:** under review. An officer is looking at your application.',
  Accepted: '✅ **Status: ACCEPTED!** Welcome to Kingdom 3914. An officer will share the next steps here.',
  Rejected: '❌ **Status:** not accepted this time. Thank you for applying to Kingdom 3914.'
};
async function ticketStatus(env, ref, status) {
  if (!dcOn(env) || !DC_STATUS[status]) return;
  try {
    await ticketsTable(env);
    var tk = await env.DB.prepare('SELECT uid, ch, state FROM tickets WHERE ref = ?').bind(ref).first();
    if (!tk || !tk.ch || tk.state !== 'open') return;
    await dcApi(env, 'POST', '/channels/' + tk.ch + '/messages', { content: '<@' + tk.uid + '> ' + DC_STATUS[status], allowed_mentions: { users: [tk.uid] } });
  } catch (e) {}
}

/* Admin / R4: close or reopen a ticket. Closing hides it from the player and renames it closed-… */
async function adminAppTicket(env, p, who) {
  if (!dcOn(env)) return { ok: false, error: 'Discord tickets are not set up.' };
  await ticketsTable(env);
  var ref = str(p.ref), op = str(p.op);
  var tk = await env.DB.prepare('SELECT * FROM tickets WHERE ref = ?').bind(ref).first();
  if (!tk || !tk.ch) return { ok: false, error: 'This application has no Discord ticket.' };
  if (op !== 'close' && op !== 'reopen') return { ok: false, error: 'Unknown action.' };
  var info = await dcApi(env, 'GET', '/channels/' + tk.ch);
  if (info.status === 404) { await env.DB.prepare('UPDATE tickets SET state = ? WHERE ref = ?').bind('gone', ref).run(); return { ok: false, error: 'The ticket channel was already deleted in Discord.' }; }
  if (!info.ok) return { ok: false, error: info.error };
  var name = str(info.data.name).replace(/^closed-/, '');
  var perm = await dcApi(env, 'PUT', '/channels/' + tk.ch + '/permissions/' + tk.uid, op === 'close' ? { type: 1, allow: '0', deny: '1024' } : { type: 1, allow: DC_SEE, deny: '0' });
  if (!perm.ok) return { ok: false, error: perm.error };
  await dcApi(env, 'PATCH', '/channels/' + tk.ch, { name: (op === 'close' ? 'closed-' : '') + name });
  await dcApi(env, 'POST', '/channels/' + tk.ch + '/messages', { content: (op === 'close' ? '🔒 Ticket closed by ' : '🔓 Ticket reopened by ') + dcEsc(who.Name, 40) + '.', allowed_mentions: { parse: [] } });
  var state = op === 'close' ? 'closed' : 'open';
  await env.DB.prepare('UPDATE tickets SET state = ? WHERE ref = ?').bind(state, ref).run();
  await log(env, who, 'application', ref + ' ticket ' + (op === 'close' ? 'closed' : 'reopened'));
  return { ok: true, state: state };
}
