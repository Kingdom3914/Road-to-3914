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
      var a = num(c.Amount); received += a;
      ledger.push({ time: toTime(c.Date), amount: a, reason: str(c.Reason) });
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

  return { state: state, checkBid: checkBid, toTime: toTime };
})();
