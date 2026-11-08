const R = require('../src/rules.js'), { Room } = require('../src/room.js');
let clock = 1e6, timers = [];
const env = { now: () => clock, later: (f, ms) => { timers.push({ f, at: clock + ms }); return 1; }, cancel: () => {} };
const adv = ms => { clock += ms; const due = timers.filter(t => t.at <= clock); timers = timers.filter(t => t.at > clock); due.forEach(t => t.f()); };
const stats = {}; const samples = {};
for (let g = 0; g < 400; g++) {
  timers = [];
  const r = new Room('F', env); r.add('a', 'A', () => {}); r.add('b', 'B', () => {});
  r.handle('a', { t: 'settings', s: { clock: 0, inc: 0, duels: true } }); r.handle('a', { t: 'start' });
  const seat = { w: 'a', b: 'b' }; let ev = [];
  for (let i = 0; i < 400 && r.phase !== 'over'; i++) {
    if (r.phase === 'play') {
      if (R.legalMoves(r.st).some(m => m.cap && R.typeOf(m.cap) === 'k')) { stats.KING_CAPTURABLE = (stats.KING_CAPTURABLE || 0) + 1; break; }
      const ms = R.legalMoves(r.st); const m = ms[Math.floor(Math.random() * ms.length)];
      r.handle(seat[r.st.turn], { t: 'move', from: m.from, to: m.to, promo: m.promo });
      if (r.phase === 'duel') ev.push((r.duel.m.lastStand ? 'STAND ' : 'duel ') + R.san ? '' : '');
      if (r.phase === 'duel') ev.push((r.duel.m.lastStand ? 'STAND:' : 'duel:') + R.typeOf(r.duel.m.piece) + 'x' + R.typeOf(r.duel.m.cap));
    } else if (r.phase === 'duel') {
      const d = r.duel; if (d.m.lastStand && ev[ev.length-1] !== 'STAND') {} 
      r.finishDuel(Math.random() < 0.5 ? d.att : R.other(d.att), 'x'); adv(3000);
      if (d.m.lastStand) ev.push('standEnd');
    }
  }
  const k = r.result ? r.result.reason : 'none'; stats[k] = (stats[k] || 0) + 1; for (const x of ev) if (/x k$|xk$/.test(x) && !x.startsWith('STAND')) stats.kingCaptureDuels = (stats.kingCaptureDuels || 0) + 1;
  if (k === 'stalemate' && !samples.stale) samples.stale = ev.slice(-5);
  if (k.startsWith('checkmate') ) samples.mate = samples.mate || ev.slice(-3);
}
console.log(stats, samples);
