const R = require('../src/rules.js');
const t = (name, fen, d, want) => { const s = Date.now(); const n = R.perft(R.fromFEN(fen), d); console.log((n === want ? 'OK  ' : 'FAIL') + ' ' + name + ' d' + d + ' ' + n + ' (want ' + want + ') ' + (Date.now() - s) + 'ms'); if (n !== want) process.exitCode = 1; };
t('start', R.START, 4, 197281);
t('kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862);
t('pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624);
t('pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 4, 422333);
t('pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379);
// states
const st = s => R.status(R.fromFEN(s));
const eq = (n, a, b) => { console.log((a === b ? 'OK  ' : 'FAIL') + ' ' + n + ' ' + a); if (a !== b) process.exitCode = 1; };
eq('mate', st('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3').reason, 'checkmate');
eq('stalemate', st('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').reason, 'stalemate');
eq('insuff KB', st('8/8/8/4k3/8/8/2B5/4K3 w - - 0 1').reason, 'insufficient material');
eq('fifty', st('8/8/8/4k3/8/8/2R5/4K3 w - - 100 80').reason, 'fifty-move rule');
// threefold by knight shuffle
let g = R.newGame(); const mv = (f, to) => { const m = R.findMove(g, R.sqIndex(f), R.sqIndex(to)); g = R.makeMove(g, m); };
for (let i = 0; i < 2; i++) { mv('g1', 'f3'); mv('g8', 'f6'); mv('f3', 'g1'); mv('f6', 'g8'); }
eq('threefold', R.status(g).reason, 'threefold repetition');
// san + fail move
g = R.newGame(); mv('e2', 'e4'); mv('d7', 'd5');
const cap = R.findMove(g, R.sqIndex('e4'), R.sqIndex('d5'));
eq('san', R.san(g, cap), 'exd5');
const f = R.failMove(g, cap); eq('failed attacker falls', f.b[R.sqIndex('e4')] + '|' + f.turn + '|' + f.fell, '|b|true');
// pinned attacker holds: white Ke1, Be2 pinned by rook e8, black pawn d3? use Ne2 pinned capturing c3? bishop on e2 captures d3 off-line
const p = R.fromFEN('4r2k/8/8/8/8/3p4/4B3/4K3 w - - 0 1');
const pm = R.findMove(p, R.sqIndex('e2'), R.sqIndex('d3'));
eq('pinned capture illegal', pm, null);
const p2 = R.fromFEN('4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1'); // rook e2 captures e8 along pin
const pm2 = R.findMove(p2, R.sqIndex('e2'), R.sqIndex('e8')); const f2 = R.failMove(p2, pm2);
eq('pinned attacker holds ground', f2.b[R.sqIndex('e2')] + '|' + f2.fell, 'R|false');
console.log('bot', R.san(R.newGame(), R.botMove(R.newGame(), 3)));
