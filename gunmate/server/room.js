// Gunmate room: one chess table with two seats and spectators. The room is the single source of truth:
// it checks every move with Rules, runs the clocks, referees the capture duels (health, fire rate, hit sanity)
// and decides results. The Fly server runs one per room code; solo practice runs the same code in the page.
(function (root) {
  'use strict';
  const Rules = typeof require !== 'undefined' ? require('./rules.js') : root.Rules;

  const S = 4; // metres per board square in the duel arena
  // file a..h runs along +x, rank 1 sits at +z (white's side)
  const sqPos = sq => ({ x: ((sq & 7) - 3.5) * S, z: (3.5 - (sq >> 3)) * S });
  // the six arms: original names, tuned so value roughly follows chess value
  const ARMS = {
    p: { name: 'Picket carbine', hp: 100, dmg: 20, interval: 0.24, pellets: 1, spread: 0.010, range: 60, speed: 7.0, h: 2.3, r: 0.75 },
    n: { name: 'Lancer scattergun', hp: 135, dmg: 10, interval: 0.80, pellets: 8, spread: 0.065, range: 26, speed: 8.0, h: 2.8, r: 0.85, doubleJump: true },
    b: { name: 'Vesper long rifle', hp: 125, dmg: 48, interval: 0.95, pellets: 1, spread: 0.002, range: 90, speed: 7.2, h: 3.1, r: 0.80, scope: true },
    r: { name: 'Bastion repeater', hp: 190, dmg: 9, interval: 0.085, pellets: 1, spread: 0.028, range: 50, speed: 5.6, h: 2.8, r: 1.00 },
    q: { name: 'Regent rifle', hp: 200, dmg: 15, interval: 0.11, pellets: 1, spread: 0.013, range: 70, speed: 8.4, h: 3.4, r: 0.90 },
    k: { name: 'Crown revolver', hp: 60, dmg: 22, interval: 0.55, pellets: 1, spread: 0.006, range: 60, speed: 6.6, h: 3.6, r: 0.90 }
  };
  const HEAD = 0.8;          // top 20% of a piece is the head: x1.6 damage
  const DUEL_COUNT = 3000;   // countdown before shooting
  const DUEL_LEN = 45000;    // then this long to win
  const AFTER = 2600;        // pause to show who toppled
  const REJOIN = 90000;      // a seated player who drops has this long to come back

  const clean = s => String(s || '').replace(/[^\w \-'.]/g, '').trim().slice(0, 16) || 'Player';

  class Room {
    constructor(code, env = {}) {
      this.code = code;
      this.now = env.now || (() => Date.now());
      this.later = env.later || ((f, ms) => setTimeout(f, ms));
      this.cancel = env.cancel || (t => clearTimeout(t));
      this.players = new Map();
      this.host = null;
      this.settings = { clock: 10, inc: 0, duels: true };
      this.phase = 'lobby';
      this.st = null; this.sans = []; this.last = null; this.result = null;
      this.timers = {};
      this.seq = 0;
    }
    // ---------- membership ----------
    add(id, name, send, token) {
      for (const p of this.players.values()) {
        if (token && p.token === token && !p.connected) { // rejoin
          this.players.delete(p.id); p.id = id; p.send = send; p.connected = true; p.name = clean(name);
          this.players.set(id, p); this.cancel(this.timers['drop' + p.seat]);
          if (this.host === null || !this.players.has(this.host)) this.host = id;
          this.sendRoom(); this.sendState(p); return true;
        }
      }
      if (this.players.size >= 10) { send({ t: 'error', text: 'That room is full.' }); return false; }
      this.players.set(id, { id, name: clean(name), seat: null, send, connected: true, token, rtt: 60 });
      if (this.host === null || !this.players.has(this.host)) this.host = id;
      // first two people take the seats automatically
      const p = this.players.get(id);
      if (this.phase === 'lobby') { if (!this.seatOf('w')) p.seat = 'w'; else if (!this.seatOf('b')) p.seat = 'b'; }
      this.sendRoom(); if (this.st) this.sendState(p);
      return true;
    }
    remove(id) {
      const p = this.players.get(id); if (!p) return;
      if (p.seat && (this.phase === 'play' || this.phase === 'duel')) {
        p.connected = false;
        this.timers['drop' + p.seat] = this.later(() => {
          if (!p.connected && this.phase !== 'over' && this.phase !== 'lobby') this.end(Rules.other(p.seat), p.name + ' left the table');
          if (!p.connected) { this.players.delete(p.id); this.fixHost(); this.sendRoom(); }
        }, REJOIN);
      } else this.players.delete(id);
      this.fixHost(); this.sendRoom();
    }
    fixHost() {
      if (this.host !== null && this.players.has(this.host) && this.players.get(this.host).connected) return;
      this.host = null;
      for (const p of this.players.values()) if (p.connected) { this.host = p.id; break; }
    }
    empty() { for (const p of this.players.values()) if (p.connected) return false; return true; }
    seatOf(c) { for (const p of this.players.values()) if (p.seat === c) return p; return null; }
    each(f) { for (const p of this.players.values()) if (p.connected) f(p); }
    all(m) { this.each(p => p.send(m)); }
    others(id, m) { this.each(p => { if (p.id !== id) p.send(m); }); }
    roomMsg() {
      return { t: 'room', code: this.code, host: this.host, settings: this.settings, phase: this.phase,
        players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, seat: p.seat, on: p.connected })) };
    }
    sendRoom() { this.each(p => p.send(Object.assign(this.roomMsg(), { you: p.id }))); }

    // ---------- game ----------
    start() {
      const w = this.seatOf('w'), b = this.seatOf('b');
      if (!w || !b) return;
      this.st = Rules.newGame(); this.sans = []; this.last = null; this.result = null; this.duel = null;
      this.clocks = this.settings.clock ? { w: this.settings.clock * 60000, b: this.settings.clock * 60000 } : null;
      this.drawOffer = null; this.rematch = new Set(); this.taken = { w: [], b: [] };
      this.phase = 'play'; this.seq++; this.gameNo = (this.gameNo || 0) + 1;
      this.startTurn(); this.sendRoom(); this.sendState();
    }
    startTurn() {
      this.turnAt = this.now();
      this.cancel(this.timers.flag);
      if (this.clocks) {
        const c = this.st.turn;
        this.timers.flag = this.later(() => this.flag(c), this.clocks[c] + 30);
      }
    }
    spend() { // charge the side to move for its thinking time
      if (!this.clocks) return;
      const c = this.st.turn;
      this.clocks[c] = Math.max(0, this.clocks[c] - (this.now() - this.turnAt));
      this.cancel(this.timers.flag);
    }
    flag(c) {
      if (this.phase !== 'play' || this.st.turn !== c) return;
      this.spend();
      if (this.clocks[c] > 0) return this.startTurn();
      // a flag fall only wins if the other side could still mate at all
      const o = Rules.other(c), only = this.st.b.every(p => !p || Rules.colorOf(p) !== o || Rules.typeOf(p) === 'k');
      this.end(only ? 'draw' : o, only ? 'time ran out, but no mating material' : (c === 'w' ? 'White' : 'Black') + ' ran out of time');
    }
    stateMsg() {
      const s = this.st;
      const m = { t: 'state', seq: this.seq, game: this.gameNo || 0, phase: this.phase, settings: this.settings, sans: this.sans, last: this.last, result: this.result, drawOffer: this.drawOffer, taken: this.taken };
      if (s) {
        m.fen = Rules.toFEN(s); m.turn = s.turn; m.check = Rules.inCheck(s);
        if (this.clocks) m.clocks = { w: this.clocks.w, b: this.clocks.b, running: this.phase === 'play' ? s.turn : null, since: this.phase === 'play' ? this.now() - this.turnAt : 0 };
      }
      if (this.duel) m.duel = this.duelInfo();
      m.rematch = this.rematch ? [...this.rematch] : [];
      return m;
    }
    sendState(p) { const m = this.stateMsg(); if (p) p.send(m); else this.all(m); }
    end(result, reason) {
      if (this.phase === 'over') return;
      if (this.phase === 'play') this.spend();
      for (const k in this.timers) this.cancel(this.timers[k]);
      this.phase = 'over'; this.result = { result, reason }; this.duel = null;
      this.rematch = new Set();
      this.sendRoom(); this.sendState();
    }
    checkEnd() {
      const s = Rules.status(this.st);
      // checkmate is never automatic while duels are on: the trapped king gets a last stand against the checker
      if (s.over && s.reason === 'checkmate' && this.settings.duels) { this.startLastStand(); return true; }
      if (s.over) { this.end(s.result, s.reason); return true; }
      return false;
    }
    move(p, msg) {
      if (this.phase !== 'play' || p.seat !== this.st.turn) return;
      const m = Rules.findMove(this.st, msg.from | 0, msg.to | 0, msg.promo && 'qrbn'.includes(msg.promo) ? msg.promo : 'q');
      if (!m) { p.send({ t: 'error', text: 'Illegal move.' }); this.sendState(p); return; }
      this.spend();
      this.drawOffer = null;
      const san = Rules.san(this.st, m);
      if (m.cap && this.settings.duels) return this.startDuel(m, san);
      this.apply(m, san, true);
    }
    startLastStand() {
      const c = this.st.turn, b = this.st.b, k = Rules.kingSq(b, c);
      const ch = Rules.checkers(b, k, Rules.other(c));
      const sq = this.last && ch.includes(this.last.to) ? this.last.to : ch[0];
      this.startDuel({ from: sq, to: k, capSq: k, piece: b[sq], cap: b[k], lastStand: true }, '');
    }
    standOver(m, won) {
      const att = Rules.colorOf(m.piece);
      if (won) { this.taken[att].push('k'); this.end(att, 'checkmate'); return; }
      const ns = Rules.removePiece(this.st, m.from);
      if (!ns) { this.end(att, 'checkmate (the checking piece could not fall)'); return; }
      this.st = ns;
      this.taken[Rules.other(att)].push(Rules.typeOf(m.piece));
      const i = this.sans.length - 1; if (i >= 0) this.sans[i] = this.sans[i].replace(/#$/, '+') + '♔';
      this.last = { from: m.from, to: m.from, failed: true, fell: true, stand: true };
      this.phase = 'play'; this.duel = null;
      if (!this.checkEnd()) this.startTurn();
      this.sendState();
    }
    apply(m, san, won) {
      if (m.lastStand) return this.standOver(m, won);
      // lose your king, lose the game
      if (!won && Rules.typeOf(m.piece) === 'k') {
        const c = Rules.colorOf(m.piece);
        this.sans.push(san.replace(/[+#]$/, '') + '✗');
        this.taken[Rules.other(c)].push('k');
        this.last = { from: m.from, to: m.to, failed: true, fell: true };
        this.end(Rules.other(c), (c === 'w' ? 'White' : 'Black') + "'s king fell in a gunfight");
        return;
      }
      if (won) {
        if (m.cap) this.taken[Rules.colorOf(m.piece)].push(Rules.typeOf(m.cap));
        this.st = Rules.makeMove(this.st, m);
      } else {
        const before = this.st.turn;
        this.st = Rules.failMove(this.st, m);
        if (this.st.fell) this.taken[Rules.other(before)].push(Rules.typeOf(m.piece));
      }
      this.sans.push(won ? san : san.replace(/[+#]$/, '') + '✗');
      this.last = { from: m.from, to: m.to, failed: !won, fell: !won && this.st.fell };
      if (this.clocks) this.clocks[Rules.other(this.st.turn)] += this.settings.inc * 1000;
      this.phase = 'play';
      this.duel = null;
      if (!this.checkEnd()) this.startTurn();
      this.sendState();
    }
    // ---------- duels ----------
    startDuel(m, san) {
      const ac = Rules.colorOf(m.piece), dc = Rules.other(ac);
      const at = Rules.typeOf(m.piece), dt = Rules.typeOf(m.cap);
      const now = this.now(), id = ++this.seq;
      this.duel = {
        id, m, san, att: ac, start: now + DUEL_COUNT, endAt: now + DUEL_COUNT + DUEL_LEN,
        type: { [ac]: at, [dc]: dt }, sq: { [ac]: m.from, [dc]: m.capSq },
        hp: { [ac]: ARMS[at].hp, [dc]: ARMS[dt].hp }, max: { [ac]: ARMS[at].hp, [dc]: ARMS[dt].hp },
        pos: { [ac]: Object.assign({ y: 0 }, sqPos(m.from)), [dc]: Object.assign({ y: 0 }, sqPos(m.capSq)) },
        lastShot: { w: 0, b: 0 }, pk: { w: [0, 0], b: [0, 0] }, over: false, hist: { w: [], b: [] }
      };
      for (const c of [ac, dc]) this.duel.hist[c].push(Object.assign({ t: now - 2000, vx: 0, vy: 0, vz: 0 }, this.duel.pos[c]));
      this.phase = 'duel';
      this.timers.duel = this.later(() => this.duelTimeout(id), DUEL_COUNT + DUEL_LEN + 50);
      this.sendRoom(); this.sendState();
    }
    duelInfo() {
      const d = this.duel;
      return { id: d.id, from: d.m.from, to: d.m.to, capSq: d.m.capSq, att: d.att, type: d.type, sq: d.sq, hp: d.hp, max: d.max,
        now: this.now(), start: d.start, endAt: d.endAt, startIn: d.start - this.now(), endIn: d.endAt - this.now(), over: d.over, lastStand: !!d.m.lastStand };
    }
    duelTimeout(id) {
      const d = this.duel; if (!d || d.id !== id || d.over) return;
      const def = Rules.other(d.att);
      const fa = d.hp[d.att] / d.max[d.att], fd = d.hp[def] / d.max[def];
      this.finishDuel(fa > fd ? d.att : def, 'time');
    }
    finishDuel(winner, how) {
      const d = this.duel; if (!d || d.over) return;
      d.over = true; this.cancel(this.timers.duel);
      const won = winner === d.att;
      this.all({ t: 'duelEnd', id: d.id, winner, attackerWon: won, how, hp: d.hp });
      this.timers.after = this.later(() => { if (this.duel === d) this.apply(d.m, d.san, won); }, AFTER);
    }
    duelPos(p, msg) {
      const d = this.duel; if (!d || d.over || !p.seat) return;
      const c = p.seat, now = this.now(), pk = d.pk[c];
      if (now - pk[0] > 1000) { pk[0] = now; pk[1] = 0; }
      if (++pk[1] > 75) return; // rate limit
      const lim = 4 * S + 3, x = +msg.x, y = +msg.y, z = +msg.z;
      if (![x, y, z].every(Number.isFinite) || Math.abs(x) > lim || Math.abs(z) > lim || y < -1 || y > 12) return;
      d.pos[c] = { x, y, z };
      const cv = v => (Number.isFinite(+v) ? Math.max(-20, Math.min(20, +v)) : 0), vx = cv(msg.vx), vy = cv(msg.vy), vz = cv(msg.vz);
      // history stamped with when the move really happened (arrival minus half the sender's round trip)
      const h = d.hist[c], last = h[h.length - 1], t = Math.max(last ? last.t : 0, now - p.rtt / 2);
      h.push({ t, x, y, z, vx, vy, vz }); while (h.length > 60) h.shift();
      this.others(p.id, { t: 'p', c, x, y, z, vx, vy, vz, yaw: +msg.yaw || 0, pitch: +msg.pitch || 0, mv: msg.mv ? 1 : 0 });
    }
    // where player c really was at time t (server clock); extrapolates a little past the newest sample
    posAt(d, c, t) {
      const h = d.hist[c]; if (!h.length) return d.pos[c];
      if (t <= h[0].t) return h[0];
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].t <= t) {
          const a = h[i], b = h[i + 1];
          if (b) { const k = (t - a.t) / Math.max(1, b.t - a.t); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }; }
          const e = Math.min(0.2, (t - a.t) / 1000); return { x: a.x + a.vx * e, y: Math.max(0, a.y + a.vy * e), z: a.z + a.vz * e };
        }
      }
      return h[0];
    }
    shot(p, msg) {
      const d = this.duel; if (!d || d.over || !p.seat) return;
      const c = p.seat, o = Rules.other(c), now = this.now();
      if (now < d.start - 150) return;
      const W = ARMS[d.type[c]];
      if (now - d.lastShot[c] < W.interval * 1000 * 0.8) return;
      d.lastShot[c] = now;
      const O = msg.o, D = msg.d;
      if (!Array.isArray(O) || !Array.isArray(D) || O.length !== 3 || D.length !== 3 || ![...O, ...D].every(Number.isFinite)) return;
      let hits = Math.max(0, Math.min(W.pellets, msg.hits | 0)), heads = Math.max(0, Math.min(hits, msg.heads | 0));
      // sanity: the shot leaves near the shooter and its line passes near the target's last known spot
      // lag compensation: judge the shot against where the target was on the shooter's screen
      const me = d.pos[c], tg = this.posAt(d, o, now - p.rtt / 2), T = ARMS[d.type[o]];
      if (Math.hypot(O[0] - me.x, O[2] - me.z) > 3.5) hits = 0;
      if (hits) {
        const len = Math.hypot(D[0], D[1], D[2]) || 1, dx = D[0] / len, dy = D[1] / len, dz = D[2] / len;
        const cy = tg.y + T.h * 0.5, vx = tg.x - O[0], vy = cy - O[1], vz = tg.z - O[2];
        const along = vx * dx + vy * dy + vz * dz;
        const miss = Math.hypot(vx - dx * along, vy - dy * along, vz - dz * along);
        if (along < 0 || along > W.range + 3 || miss > T.r + T.h * 0.5 + 1.6) hits = 0;
      }
      if (!hits) heads = 0;
      const dmg = Math.round(hits * W.dmg + heads * W.dmg * 0.6);
      this.others(p.id, { t: 'shot', c, o: O, d: D, hit: hits > 0 });
      if (dmg > 0) {
        d.hp[o] = Math.max(0, d.hp[o] - dmg);
        this.all({ t: 'hp', hp: d.hp, by: c, dmg, head: heads > 0 });
        if (d.hp[o] <= 0) this.finishDuel(c, 'toppled');
      }
    }
    // ---------- messages ----------
    handle(id, msg) {
      const p = this.players.get(id); if (!p || !msg || typeof msg.t !== 'string') return;
      const isHost = id === this.host;
      switch (msg.t) {
        case 'sit':
          if (this.phase === 'lobby' || this.phase === 'over') {
            const c = msg.c === 'w' || msg.c === 'b' ? msg.c : null;
            if (c && this.seatOf(c) && this.seatOf(c) !== p) return;
            p.seat = c; this.sendRoom();
          }
          break;
        case 'settings':
          if (isHost && this.phase !== 'play' && this.phase !== 'duel' && msg.s) {
            const s = msg.s;
            if ([0, 1, 3, 5, 10, 15, 30].includes(s.clock)) this.settings.clock = s.clock;
            if ([0, 2, 5, 10].includes(s.inc)) this.settings.inc = s.inc;
            if (typeof s.duels === 'boolean') this.settings.duels = s.duels;
            this.sendRoom();
          }
          break;
        case 'swap':
          if (isHost && (this.phase === 'lobby' || this.phase === 'over'))
            for (const q of this.players.values()) if (q.seat) q.seat = Rules.other(q.seat);
          this.sendRoom(); break;
        case 'start':
          if (isHost && (this.phase === 'lobby' || this.phase === 'over')) this.start();
          break;
        case 'move': this.move(p, msg); break;
        case 'p': this.duelPos(p, msg); break;
        case 'shot': this.shot(p, msg); break;
        case 'resign':
          if ((this.phase === 'play' || this.phase === 'duel') && p.seat) this.end(Rules.other(p.seat), (p.seat === 'w' ? 'White' : 'Black') + ' resigned');
          break;
        case 'draw':
          if (this.phase !== 'play' || !p.seat) return;
          if (this.drawOffer && this.drawOffer !== p.seat) this.end('draw', 'draw agreed');
          else { this.drawOffer = p.seat; this.sendState(); }
          break;
        case 'decline':
          if (this.drawOffer && p.seat && this.drawOffer !== p.seat) { this.drawOffer = null; this.sendState(); }
          break;
        case 'rematch':
          if (this.phase !== 'over' || !p.seat) return;
          this.rematch.add(p.seat);
          if (this.rematch.has('w') && this.rematch.has('b')) {
            for (const q of this.players.values()) if (q.seat) q.seat = Rules.other(q.seat);
            this.start();
          } else this.sendState();
          break;
        case 'chat': {
          const text = String(msg.text || '').slice(0, 140).trim();
          if (text) this.all({ t: 'chat', name: p.name, seat: p.seat, text });
          break;
        }
        case 'rtt': p.rtt = Math.max(0, Math.min(500, +msg.ms || 0)); break;
        case 'name': p.name = clean(msg.name); this.sendRoom(); break;
      }
    }
  }
  const api = { Room, ARMS, S, sqPos, HEAD, DUEL_COUNT, DUEL_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GRoom = api;
})(this);
