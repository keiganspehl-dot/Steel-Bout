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
  void st; process.exit();
})();
