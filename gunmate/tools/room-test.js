// In-process room: castling, en passant and promotion through the referee (duels off), and a spectator.
const R = require('../src/rules.js'), { Room } = require('../src/room.js');
const ok = (n, v) => { console.log((v ? 'OK  ' : 'FAIL') + ' ' + n); if (!v) process.exitCode = 1; };
const r = new Room('T'); const box = { a: [], b: [], c: [] };
r.add('a', 'Ann', m => box.a.push(m)); r.add('b', 'Bob', m => box.b.push(m)); r.add('c', 'Cy', m => box.c.push(m));
ok('third is a spectator', r.players.get('c').seat === null);
r.handle('a', { t: 'settings', s: { clock: 0, inc: 0, duels: false } }); r.handle('a', { t: 'start' });
const play = (id, f, t, pr) => r.handle(id, { t: 'move', from: R.sqIndex(f), to: R.sqIndex(t), promo: pr });
[['a', 'e2', 'e4'], ['b', 'a7', 'a6'], ['a', 'e4', 'e5'], ['b', 'd7', 'd5'], ['a', 'e5', 'd6'], ['b', 'a6', 'a5'], ['a', 'g1', 'f3'], ['b', 'a5', 'a4'], ['a', 'f1', 'e2'], ['b', 'a4', 'a3'], ['a', 'e1', 'g1'],
 ['b', 'a3', 'b2'], ['a', 'd6', 'c7'], ['b', 'b2', 'a1', 'n']].forEach(m => play(...m));
ok('moves: ' + r.sans.join(' '), r.sans.join(' ') === 'e4 a6 e5 d5 exd6 a5 Nf3 a4 Be2 a3 O-O axb2 dxc7 bxa1=N');
const last = box.c.filter(m => m.t === 'state').pop();
ok('spectator sees the board', last.fen.startsWith('rnbqkbnr/1pP1pppp/8/8/8/5N2/P1PPBPPP/nNBQ1RK1 w'));
play('a', 'c7', 'b8', 'q'); ok('promotion with capture: ' + r.sans.slice(-1), r.sans.slice(-1)[0] === 'cxb8=Q');
