/* ============================================================
   Kingdom 3914 — bidding & credits logic (open per-rank auctions and secret-bid auctions)
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
