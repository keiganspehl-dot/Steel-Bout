// Two clients play over the real server: a duel won by the attacker, a repelled attack, then Scholar's mate.
const R = require('../src/rules.js'), { sqPos } = require('../src/room.js');
const URL = process.argv[2] || 'ws://localhost:8099/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(name) {
  const ws = new WebSocket(URL), c = { ws, msgs: [], name, state: null, room: null };
  ws.onmessage = e => { const m = JSON.parse(e.data); c.msgs.push(m); if (m.t === 'state') c.state = m; if (m.t === 'room') c.room = m; };
  c.send = m => ws.send(JSON.stringify(m));
  c.open = new Promise(r => ws.onopen = r);
  c.wait = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(f); if (m) { c.msgs.splice(0, c.msgs.indexOf(m) + 1); return m; } await sleep(20); } throw new Error(name + ' timeout'); };
  return c;
}
const ok = (n, v) => { console.log((v ? 'OK  ' : 'FAIL') + ' ' + n); if (!v) process.exitCode = 1; };
(async () => {
  const a = client('Ann'), b = client('Bob'); await a.open; await b.open;
  a.send({ t: 'create', name: 'Ann', token: 'ta', s: { clock: 5, inc: 2, duels: true } });
  const room = await a.wait(m => m.t === 'room'); ok('room code ' + room.code, /^[A-Z0-9]{5}$/.test(room.code));
  ok('settings applied', (await a.wait(m => m.t === 'room' && m.settings.clock === 5)).settings.inc === 2);
  b.send({ t: 'join', code: room.code, name: 'Bob', token: 'tb' });
  const r2 = await b.wait(m => m.t === 'room'); ok('bob seated black', r2.players.find(p => p.name === 'Bob').seat === 'b');
  a.send({ t: 'start' }); await a.wait(m => m.t === 'state' && m.phase === 'play');
  const mv = async (c, f, t, promo) => { c.send({ t: 'move', from: R.sqIndex(f), to: R.sqIndex(t), promo }); await sleep(120); };
  b.send({ t: 'move', from: R.sqIndex('e7'), to: R.sqIndex('e5') }); await sleep(200); ok('out of turn ignored', !b.msgs.some(m => m.t === 'state' && m.sans.length));
  a.send({ t: 'move', from: R.sqIndex('e2'), to: R.sqIndex('e5') }); await a.wait(m => m.t === 'error'); ok('illegal move rejected', true);
  await mv(a, 'e2', 'e4'); await mv(b, 'd7', 'd5');
  // capture: exd5 starts a duel; Ann wins by shooting
  await mv(a, 'e4', 'd5');
  const ds = await b.wait(m => m.t === 'state' && m.phase === 'duel'); ok('duel started', ds.duel && ds.duel.type.w === 'p' && ds.duel.type.b === 'p');
  const pw = sqPos(R.sqIndex('e4')), pb = sqPos(R.sqIndex('d5'));
  a.send({ t: 'shot', o: [pw.x, 2, pw.z], d: [pb.x - pw.x, 0, pb.z - pw.z], hits: 1, heads: 0 }); await sleep(100);
  ok('shot during countdown ignored', !a.msgs.some(m => m.t === 'hp'));
  await sleep(3000);
  // a bogus hit aimed the wrong way gives no damage
  a.send({ t: 'shot', o: [pw.x, 2, pw.z], d: [0, 1, 0], hits: 1, heads: 1 }); await sleep(400);
  ok('bogus hit rejected', !a.msgs.some(m => m.t === 'hp'));
  for (let i = 0; i < 5; i++) { a.send({ t: 'shot', o: [pw.x, 2, pw.z], d: [pb.x - pw.x, -0.3, pb.z - pw.z], hits: 1, heads: 1 }); await sleep(260); }
  const end = await b.wait(m => m.t === 'duelEnd'); ok('attacker won duel', end.attackerWon && end.winner === 'w');
  const after = await b.wait(m => m.t === 'state' && m.phase === 'play', 5000);
  ok('capture applied: ' + after.sans.join(' '), after.sans[2] === 'exd5' && after.turn === 'b' && after.fen.startsWith('rnbqkbnr/ppp1pppp/8/3P4'));
  ok('clock running for black with increment', after.clocks.running === 'b' && after.clocks.w > 300000 - 20000);
  // Bob recaptures Qxd5 and LOSES the duel by time-out tie? Let Ann (defender) shoot
  a.msgs.length = 0; await mv(b, 'd8', 'd5');
  await a.wait(m => m.t === 'state' && m.phase === 'duel'); await sleep(3100);
  const qa = sqPos(R.sqIndex('d8')), qd = sqPos(R.sqIndex('d5'));
  for (let i = 0; i < 8; i++) { a.send({ t: 'shot', o: [qd.x, 2, qd.z], d: [qa.x - qd.x, 0.05, qa.z - qd.z], hits: 1, heads: 1 }); await sleep(260); }
  const e2 = await a.wait(m => m.t === 'duelEnd'); ok('defender won duel', !e2.attackerWon);
  const af2 = await a.wait(m => m.t === 'state' && m.phase === 'play', 5000);
  ok('queen fell, pawn stays, white to move: ' + af2.sans.slice(-1), af2.fen.startsWith('rnb1kbnr/ppp1pppp/8/3P4') && af2.turn === 'w' && af2.taken.w.includes('q'));
  // draw offer + decline, chat
  a.send({ t: 'draw' }); const off = await b.wait(m => m.t === 'state' && m.drawOffer === 'w'); ok('draw offered', !!off);
  b.send({ t: 'decline' }); await b.wait(m => m.t === 'state' && !m.drawOffer); ok('draw declined', true);
  b.send({ t: 'chat', text: 'gg <b>' }); ok('chat relayed', (await a.wait(m => m.t === 'chat')).text === 'gg <b>');
  // reconnect: Bob drops and comes back with his token keeping his seat
  b.ws.close(); await sleep(300);
  const b2 = client('Bob2'); await b2.open; b2.send({ t: 'join', code: room.code, name: 'Bob', token: 'tb' });
  const rr = await b2.wait(m => m.t === 'room'); ok('rejoined with seat', rr.players.find(p => p.id === rr.you).seat === 'b');
  // resign
  b2.send({ t: 'resign' }); const ov = await a.wait(m => m.t === 'state' && m.phase === 'over'); ok('resign ends game: ' + ov.result.reason, ov.result.result === 'w');
  // rematch swaps colours
  a.msgs.length = 0; a.send({ t: 'rematch' }); b2.send({ t: 'rematch' });
  const rm = await a.wait(m => m.t === 'room' && m.phase === 'play'); ok('rematch swapped colours', rm.players.find(p => p.name === 'Ann').seat === 'b');
  // join a missing room
  const c = client('Cy'); await c.open; c.send({ t: 'join', code: 'ZZZZZ', name: 'Cy' }); ok('missing room error', (await c.wait(m => m.t === 'error')).code === 'noroom');
  process.exit();
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
