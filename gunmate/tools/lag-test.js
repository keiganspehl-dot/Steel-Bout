// Lag compensation: shots are judged against where the target was on the SHOOTER's screen,
// so a high-ping player and a low-ping player get the same fight.
const R = require('../src/rules.js'), { Room, sqPos, ARMS } = require('../src/room.js');
const ok = (n, v) => { console.log((v ? 'OK  ' : 'FAIL') + ' ' + n); if (!v) process.exitCode = 1; };
let clock = 1e6; const timers = [];
const env = { now: () => clock, later: (f, ms) => { timers.push({ f, at: clock + ms }); return timers.length; }, cancel: () => {} };
const adv = ms => { clock += ms; for (const t of timers.splice(0)) { if (t.at <= clock) t.f(); else timers.push(t); } };
function setup(rttW, rttB) {
  const r = new Room('L', env); const msgs = { a: [], b: [] };
  r.add('a', 'Ann', m => msgs.a.push(m)); r.add('b', 'Bob', m => msgs.b.push(m));
  r.handle('a', { t: 'settings', s: { clock: 0, inc: 0, duels: true } }); r.handle('a', { t: 'start' });
  const mv = (id, f, t) => r.handle(id, { t: 'move', from: R.sqIndex(f), to: R.sqIndex(t) });
  mv('a', 'e2', 'e4'); mv('b', 'd7', 'd5'); mv('a', 'e4', 'd5'); // pawn vs pawn duel
  r.handle('a', { t: 'rtt', ms: rttW }); r.handle('b', { t: 'rtt', ms: rttB });
  adv(3200);
  return { r, msgs };
}
// Bob (black, defender) runs sideways at 6 m/s. Ann has 160 ms ping and aims at where she SEES him (his position "now" on her screen).
{
  const { r } = setup(160, 20), d = r.duel, a0 = sqPos(R.sqIndex('e4')), b0 = sqPos(R.sqIndex('d5'));
  let bx = b0.x; const V = 6;
  // Bob's packets reach the server 10 ms after he sends them (his half ping), every 33 ms
  for (let i = 0; i < 12; i++) { adv(33); bx += V * 0.033; r.handle('b', { t: 'p', x: bx, y: 0, z: b0.z, vx: V, vy: 0, vz: 0, yaw: 0, pitch: 0, mv: 1 }); r.handle('a', { t: 'p', x: a0.x, y: 0, z: a0.z, vx: 0, vy: 0, vz: 0 }); }
  // what Ann sees: Bob's true position about 80 ms (half her ping) before the server receives her shot, i.e. bx - V*0.08 + his own half-ping delay
  const seen = bx - V * (0.080 - 0.010);
  const aim = [seen - a0.x, 0.4, b0.z - a0.z];
  const hp0 = d.hp.b;
  r.handle('a', { t: 'shot', o: [a0.x, 2, a0.z], d: aim, hits: 1, heads: 0 });
  ok('high-ping shooter hits the moving target as seen on her screen (' + (hp0 - d.hp.b) + ' dmg)', d.hp.b < hp0);
  // a shot aimed 5 m behind where he really was is still rejected
  adv(400); const hp1 = d.hp.b;
  r.handle('a', { t: 'shot', o: [a0.x, 2, a0.z], d: [bx - 9 - a0.x, 0.4, b0.z - a0.z], hits: 1, heads: 0 });
  ok('wildly wrong aim still rejected', d.hp.b === hp1);
}
// equal fairness: swap who has the lag
for (const [rw, rb] of [[20, 160], [160, 20], [60, 60]]) {
  const { r } = setup(rw, rb), d = r.duel, a0 = sqPos(R.sqIndex('e4')), b0 = sqPos(R.sqIndex('d5'));
  let ax = a0.x; const V = -6; // Ann strafes
  for (let i = 0; i < 12; i++) { adv(33); ax += V * 0.033; r.handle('a', { t: 'p', x: ax, y: 0, z: a0.z, vx: V, vy: 0, vz: 0 }); r.handle('b', { t: 'p', x: b0.x, y: 0, z: b0.z, vx: 0, vy: 0, vz: 0 }); }
  const seen = ax - V * (rb / 2000 - rw / 2000) - V * 0.0; // Bob sees Ann as she was about half of her ping before reaching him
  const hp0 = d.hp.w;
  r.handle('b', { t: 'shot', o: [b0.x, 2, b0.z], d: [ax + V * (rw / 2000 - rb / 2000) - b0.x, 0.4, a0.z - b0.z], hits: 1, heads: 0 });
  void seen; ok('shooter ping ' + rb + ' ms vs target ping ' + rw + ' ms: shot on target counts', d.hp.w < hp0);
}
process.exit();
