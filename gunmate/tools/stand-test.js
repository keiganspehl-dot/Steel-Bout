// Checkmate becomes a last-stand duel: king loses -> checkmate; king wins -> checker falls and play goes on.
const R = require('../src/rules.js'), { Room } = require('../src/room.js');
const ok = (n, v) => { console.log((v ? 'OK  ' : 'FAIL') + ' ' + n); if (!v) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function game(kingWins) {
  const r = new Room('T'); r.add('a', 'Ann', () => {}); r.add('b', 'Bob', () => {});
  r.handle('a', { t: 'settings', s: { clock: 5, inc: 0, duels: true } }); r.handle('a', { t: 'start' });
  const play = (id, f, t) => r.handle(id, { t: 'move', from: R.sqIndex(f), to: R.sqIndex(t) });
  [['a', 'e2', 'e4'], ['b', 'e7', 'e5'], ['a', 'f1', 'c4'], ['b', 'b8', 'c6'], ['a', 'd1', 'h5'], ['b', 'g8', 'f6'], ['a', 'h5', 'f7']].forEach(m => play(...m));
  ok('Qxf7 starts a capture duel', r.phase === 'duel' && !r.duel.m.lastStand);
  r.finishDuel('w', 'test'); await sleep(2800);
  ok('mate becomes a last stand (queen vs king)', r.phase === 'duel' && r.duel.m.lastStand && r.duel.type.w === 'q' && r.duel.type.b === 'k' && r.phase !== 'over');
  r.finishDuel(kingWins ? 'b' : 'w', 'test'); await sleep(2800);
  return r;
}
(async () => {
  const r1 = await game(false);
  ok('king loses: checkmate, white wins', r1.phase === 'over' && r1.result.result === 'w' && r1.result.reason === 'checkmate');
  const r2 = await game(true);
  ok('king wins: queen gone, game goes on, black to move: ' + r2.sans.slice(-1), r2.phase === 'play' && r2.st.turn === 'b' && !r2.st.b.includes('Q') && r2.sans.slice(-1)[0] === 'Qxf7+♔' && r2.taken.b.includes('q'));
  ok('black clock ticking again', r2.clocks && r2.clocks.b > 290000);
  // double check: stand vs the last mover; checker that would expose its own king cannot fall
  const st = R.fromFEN('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1');
  ok('checkers found', R.checkers(R.fromFEN('3rk3/8/8/8/8/8/8/3K3 w - - 0 1').b, R.sqIndex('d1'), 'b').join() === String(R.sqIndex('d8')));
  ok('pinned piece cannot be removed', R.removePiece(R.fromFEN('4r2k/8/8/8/8/8/4R3/4K3 b - - 0 1'), R.sqIndex('e2')) === null);
  void st; await sleep(0);
})();
// king attacks and loses its duel -> that side loses the game
(async () => {
  await sleep(6500);
  const r = new Room('K'); r.add('a', 'Ann', () => {}); r.add('b', 'Bob', () => {});
  r.handle('a', { t: 'settings', s: { clock: 0, inc: 0, duels: true } }); r.handle('a', { t: 'start' });
  r.st = R.fromFEN('4k3/8/8/8/8/8/3p4/4K3 w - - 0 1'); r.st.keys = [];
  r.handle('a', { t: 'move', from: R.sqIndex('e1'), to: R.sqIndex('d2') });
  ok('king capture starts a duel with a 60-health king', r.phase === 'duel' && r.duel.hp.w === 60);
  r.finishDuel('b', 'test'); await sleep(2800);
  ok('king lost the fight -> black wins: ' + (r.result && r.result.reason), r.phase === 'over' && r.result.result === 'b');
})();
// regression: the failed capture was the only way out of check -> the king is taken, not "stalemate"
(async () => {
  await sleep(13000);
  const r = new Room('C', env0); r.add('a', 'Ann', () => {}); r.add('b', 'Bob', () => {});
  r.handle('a', { t: 'settings', s: { clock: 0, inc: 0, duels: true } }); r.handle('a', { t: 'start' });
  r.st = R.fromFEN('4k3/8/8/8/8/8/3r4/3QK3 b - - 0 1'); r.st.keys = []; // black rook takes queen? use a check position instead
  r.st = R.fromFEN('3rk3/8/8/8/8/8/8/3QK3 b - - 0 1'); r.st.keys = [];
  r.st = R.fromFEN('4k3/8/8/8/8/8/4r3/3QK3 w - - 0 1'); r.st.keys = [];
  r.st = R.fromFEN('k7/8/8/8/7q/8/8/4K2R w - - 0 1'); r.st.keys = []; // white king in check from the h4 queen; Rxh4 is a way out
  r.handle('a', { t: 'move', from: R.sqIndex('h1'), to: R.sqIndex('h4') });
  ok('Rxh4 (a way out of check) starts a duel', r.phase === 'duel');
  r.finishDuel('b', 'test'); await sleep(2800);
  ok('lost the escape duel while in check: black takes the king (' + (r.result && r.result.reason) + ')', r.phase === 'over' && r.result.result === 'b' && /king was taken/.test(r.result.reason));
  process.exit();
})();
const env0 = { now: () => Date.now(), later: (f, ms) => setTimeout(f, ms), cancel: t => clearTimeout(t) };
