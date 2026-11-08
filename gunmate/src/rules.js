// Gunmate chess rules: full standard chess (castling, en passant, promotion, check, checkmate, stalemate,
// threefold repetition, fifty-move rule, insufficient material) plus the duel outcome where an attacker loses.
// Shared by the Fly server (authoritative) and the browser (solo play, move hints). No dependencies.
(function (root) {
  'use strict';
  const FILES = 'abcdefgh';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const colorOf = p => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
  const typeOf = p => (p ? p.toLowerCase() : null);
  const sqName = s => FILES[s & 7] + ((s >> 3) + 1);
  const sqIndex = n => FILES.indexOf(n[0]) + (parseInt(n[1], 10) - 1) * 8;
  const fileOf = s => s & 7, rankOf = s => s >> 3;
  const other = c => (c === 'w' ? 'b' : 'w');

  function fromFEN(fen) {
    const [pos, turn, castle, ep, half, full] = fen.split(' ');
    const b = new Array(64).fill('');
    const rows = pos.split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[7 - r]) {
        if (/\d/.test(ch)) f += +ch; else b[r * 8 + f++] = ch;
      }
    }
    const st = { b, turn, castle: castle === '-' ? '' : castle, ep: ep === '-' ? -1 : sqIndex(ep), half: +half || 0, full: +full || 1, keys: [] };
    st.keys.push(posKey(st));
    return st;
  }
  function toFEN(st) {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let s = '', e = 0;
      for (let f = 0; f < 8; f++) {
        const p = st.b[r * 8 + f];
        if (!p) e++; else { if (e) s += e; e = 0; s += p; }
      }
      if (e) s += e; rows.push(s);
    }
    return rows.join('/') + ' ' + st.turn + ' ' + (st.castle || '-') + ' ' + (st.ep < 0 ? '-' : sqName(st.ep)) + ' ' + st.half + ' ' + st.full;
  }
  const newGame = () => fromFEN(START);

  const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);

  // is square sq attacked by colour c?
  function attacked(b, sq, c) {
    const f = fileOf(sq), r = rankOf(sq);
    const pawnDir = c === 'w' ? -1 : 1; // attacking pawn sits one rank behind (from its point of view)
    for (const df of [-1, 1]) {
      const s = at(f + df, r + pawnDir);
      if (s >= 0 && b[s] === (c === 'w' ? 'P' : 'p')) return true;
    }
    for (const [df, dr] of KN) { const s = at(f + df, r + dr); if (s >= 0 && b[s] === (c === 'w' ? 'N' : 'n')) return true; }
    for (const [df, dr] of KG) { const s = at(f + df, r + dr); if (s >= 0 && b[s] === (c === 'w' ? 'K' : 'k')) return true; }
    const slide = (dirs, kinds) => {
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
          const p = b[rr * 8 + ff];
          if (p) { if (colorOf(p) === c && kinds.includes(typeOf(p))) return true; break; }
          ff += df; rr += dr;
        }
      }
      return false;
    };
    return slide(DIAG, 'bq') || slide(ORTH, 'rq');
  }
  const kingSq = (b, c) => b.indexOf(c === 'w' ? 'K' : 'k');
  const inCheck = (st, c = st.turn) => { const k = kingSq(st.b, c); return k >= 0 && attacked(st.b, k, other(c)); };

  function pseudo(st) {
    const { b, turn: c } = st, out = [];
    const add = (from, to, extra) => out.push(Object.assign({ from, to, piece: b[from], cap: b[to] || null, capSq: b[to] ? to : -1 }, extra));
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (!p || colorOf(p) !== c) continue;
      const t = typeOf(p), f = fileOf(s), r = rankOf(s);
      if (t === 'p') {
        const dir = c === 'w' ? 1 : -1, startR = c === 'w' ? 1 : 6, lastR = c === 'w' ? 7 : 0;
        const pushP = (to, extra) => {
          if (rankOf(to) === lastR) for (const pr of 'qrbn') add(s, to, Object.assign({ promo: pr }, extra));
          else add(s, to, extra);
        };
        const one = at(f, r + dir);
        if (one >= 0 && !b[one]) {
          pushP(one);
          const two = at(f, r + 2 * dir);
          if (r === startR && !b[two]) add(s, two, { double: true });
        }
        for (const df of [-1, 1]) {
          const to = at(f + df, r + dir);
          if (to < 0) continue;
          if (b[to] && colorOf(b[to]) !== c) pushP(to);
          else if (to === st.ep) {
            const cs = at(f + df, r);
            out.push({ from: s, to, piece: p, cap: b[cs], capSq: cs, enPassant: true });
          }
        }
      } else if (t === 'n' || t === 'k') {
        for (const [df, dr] of t === 'n' ? KN : KG) {
          const to = at(f + df, r + dr);
          if (to >= 0 && (!b[to] || colorOf(b[to]) !== c)) add(s, to);
        }
        if (t === 'k') {
          const home = c === 'w' ? 4 : 60, o = other(c);
          if (s === home && !attacked(b, s, o)) {
            const K = c === 'w' ? 'K' : 'k', Q = c === 'w' ? 'Q' : 'q', R = c === 'w' ? 'R' : 'r';
            if (st.castle.includes(K) && b[s + 3] === R && !b[s + 1] && !b[s + 2] && !attacked(b, s + 1, o) && !attacked(b, s + 2, o))
              add(s, s + 2, { castle: 'K' });
            if (st.castle.includes(Q) && b[s - 4] === R && !b[s - 1] && !b[s - 2] && !b[s - 3] && !attacked(b, s - 1, o) && !attacked(b, s - 2, o))
              add(s, s - 2, { castle: 'Q' });
          }
        }
      } else {
        const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
        for (const [df, dr] of dirs) {
          let ff = f + df, rr = r + dr;
          while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
            const to = rr * 8 + ff;
            if (b[to]) { if (colorOf(b[to]) !== c) add(s, to); break; }
            add(s, to); ff += df; rr += dr;
          }
        }
      }
    }
    return out;
  }

  // board-only move (used for legality testing and makeMove)
  function applyBoard(b, m) {
    const nb = b.slice();
    if (m.capSq >= 0) nb[m.capSq] = '';
    nb[m.to] = m.promo ? (colorOf(m.piece) === 'w' ? m.promo.toUpperCase() : m.promo) : m.piece;
    nb[m.from] = '';
    if (m.castle === 'K') { nb[m.from + 1] = nb[m.from + 3]; nb[m.from + 3] = ''; }
    if (m.castle === 'Q') { nb[m.from - 1] = nb[m.from - 4]; nb[m.from - 4] = ''; }
    return nb;
  }
  function legalMoves(st) {
    const c = st.turn;
    return pseudo(st).filter(m => { const nb = applyBoard(st.b, m); return !attacked(nb, kingSq(nb, c), other(c)); });
  }
  function stripCastle(castle, sq) {
    const map = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' };
    if (sq === 4) castle = castle.replace(/[KQ]/g, '');
    if (sq === 60) castle = castle.replace(/[kq]/g, '');
    if (map[sq] !== undefined) castle = castle.replace(map[sq], '');
    return castle;
  }
  function posKey(st) {
    // en passant only counts when a capture is actually possible (FIDE repetition rule)
    let ep = '-';
    if (st.ep >= 0) {
      const c = st.turn, f = fileOf(st.ep), r = rankOf(st.ep) + (c === 'w' ? -1 : 1);
      for (const df of [-1, 1]) { const s = at(f + df, r); if (s >= 0 && st.b[s] === (c === 'w' ? 'P' : 'p')) ep = sqName(st.ep); }
    }
    return st.b.map(p => p || '.').join('') + st.turn + (st.castle || '-') + ep;
  }
  function finishTurn(st, nb, castle, ep, resetHalf) {
    const ns = { b: nb, turn: other(st.turn), castle, ep, half: resetHalf ? 0 : st.half + 1, full: st.full + (st.turn === 'b' ? 1 : 0), keys: resetHalf ? [] : st.keys.slice() };
    ns.keys.push(posKey(ns));
    return ns;
  }
  // the move succeeds (normal chess)
  function makeMove(st, m) {
    const nb = applyBoard(st.b, m);
    let castle = stripCastle(stripCastle(st.castle, m.from), m.to);
    if (m.capSq >= 0) castle = stripCastle(castle, m.capSq);
    return finishTurn(st, nb, castle, m.double ? (m.from + m.to) >> 1 : -1, typeOf(m.piece) === 'p' || !!m.cap);
  }
  // the attacker lost its duel: it falls, unless it is the king or its fall would leave its own king in check;
  // then it holds its ground. Either way the turn passes.
  function failMove(st, m) {
    const nb = st.b.slice();
    let fell = false;
    if (typeOf(m.piece) !== 'k') {
      nb[m.from] = '';
      if (!attacked(nb, kingSq(nb, st.turn), other(st.turn))) fell = true; else nb[m.from] = m.piece;
    }
    const castle = fell ? stripCastle(st.castle, m.from) : st.castle;
    const ns = finishTurn(st, nb, castle, -1, fell);
    ns.fell = fell;
    return ns;
  }
  // squares holding colour-c pieces that attack square sq
  function checkers(b, sq, c) {
    const out = [], tf = fileOf(sq), tr = rankOf(sq);
    for (let s = 0; s < 64; s++) {
      const p = b[s]; if (!p || colorOf(p) !== c) continue;
      const t = typeOf(p), df = tf - fileOf(s), dr = tr - rankOf(s), adf = Math.abs(df), adr = Math.abs(dr);
      let hit = false;
      if (t === 'p') hit = adf === 1 && dr === (c === 'w' ? 1 : -1);
      else if (t === 'n') hit = (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
      else if (t === 'k') hit = Math.max(adf, adr) === 1;
      else {
        const diag = adf === adr && adf > 0, orth = (adf === 0) !== (adr === 0);
        if ((t === 'b' && diag) || (t === 'r' && orth) || (t === 'q' && (diag || orth))) {
          const sf = Math.sign(df), sr = Math.sign(dr); let f = fileOf(s) + sf, r = rankOf(s) + sr; hit = true;
          while (f !== tf || r !== tr) { if (b[r * 8 + f]) { hit = false; break; } f += sf; r += sr; }
        }
      }
      if (hit) out.push(s);
    }
    return out;
  }
  // a piece taken off the board outside a normal move (it lost the king's last stand); the turn does not pass
  function removePiece(st, sq) {
    const p = st.b[sq], c = colorOf(p), nb = st.b.slice(); nb[sq] = '';
    if (typeOf(p) === 'k' || attacked(nb, kingSq(nb, c), other(c))) return null;
    const ns = { b: nb, turn: st.turn, castle: stripCastle(st.castle, sq), ep: st.ep, half: 0, full: st.full, keys: [] };
    ns.keys.push(posKey(ns));
    return ns;
  }
  function insufficient(b) {
    const pcs = [];
    for (let s = 0; s < 64; s++) if (b[s] && typeOf(b[s]) !== 'k') pcs.push([typeOf(b[s]), s]);
    if (pcs.length === 0) return true;
    if (pcs.length === 1 && 'nb'.includes(pcs[0][0])) return true;
    if (pcs.every(([t]) => t === 'b')) { const sh = pcs.map(([, s]) => (fileOf(s) + rankOf(s)) & 1); return sh.every(x => x === sh[0]); }
    return false;
  }
  // result for the side to move: null while play goes on
  function status(st) {
    // a side without a king has lost it (can only happen if a king was taken)
    for (const c of ['w', 'b']) if (kingSq(st.b, c) < 0) return { over: true, result: other(c), reason: 'king taken' };
    const moves = legalMoves(st), chk = inCheck(st);
    if (!moves.length) return chk ? { over: true, result: other(st.turn), reason: 'checkmate' } : { over: true, result: 'draw', reason: 'stalemate' };
    if (insufficient(st.b)) return { over: true, result: 'draw', reason: 'insufficient material' };
    if (st.half >= 100) return { over: true, result: 'draw', reason: 'fifty-move rule' };
    const k = st.keys[st.keys.length - 1];
    if (st.keys.filter(x => x === k).length >= 3) return { over: true, result: 'draw', reason: 'threefold repetition' };
    return { over: false, check: chk };
  }
  function san(st, m) {
    if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
    const t = typeOf(m.piece);
    let s = '';
    if (t === 'p') { if (m.cap) s = FILES[fileOf(m.from)]; }
    else {
      s = t.toUpperCase();
      const rivals = legalMoves(st).filter(o => o.to === m.to && o.from !== m.from && o.piece === m.piece);
      if (rivals.length) {
        if (!rivals.some(o => fileOf(o.from) === fileOf(m.from))) s += FILES[fileOf(m.from)];
        else if (!rivals.some(o => rankOf(o.from) === rankOf(m.from))) s += rankOf(m.from) + 1;
        else s += sqName(m.from);
      }
    }
    if (m.cap) s += 'x';
    s += sqName(m.to);
    if (m.promo) s += '=' + m.promo.toUpperCase();
    const ns = makeMove(st, m), stt = status(ns);
    if (stt.over && stt.reason === 'checkmate') s += '#'; else if (inCheck(ns)) s += '+';
    return s;
  }
  function findMove(st, from, to, promo) {
    const ms = legalMoves(st).filter(m => m.from === from && m.to === to);
    if (!ms.length) return null;
    return ms.find(m => (m.promo || null) === (ms[0].promo ? (promo || 'q') : null)) || null;
  }
  function perft(st, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of legalMoves(st)) n += d === 1 ? 1 : perft(makeMove(st, m), d - 1);
    return n;
  }

  // ---------- simple bot: alpha-beta with piece-square tables ----------
  const PST = {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0],
    n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    r: [0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0, 0, 5, 5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    k: [20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10, -20, -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30]
  };
  function evaluate(b) { // from white's view, centipawns
    let s = 0;
    for (let q = 0; q < 64; q++) {
      const p = b[q]; if (!p) continue;
      const t = typeOf(p), w = colorOf(p) === 'w';
      const v = VAL[t] * 100 + PST[t][w ? q : (7 - rankOf(q)) * 8 + fileOf(q)];
      s += w ? v : -v;
    }
    return s;
  }
  function search(st, depth, alpha, beta, ply) {
    const moves = legalMoves(st);
    if (!moves.length) return inCheck(st) ? -100000 + ply : 0;
    if (depth === 0) return (st.turn === 'w' ? 1 : -1) * evaluate(st.b);
    moves.sort((a, b) => (b.cap ? VAL[typeOf(b.cap)] * 10 - VAL[typeOf(b.piece)] : 0) - (a.cap ? VAL[typeOf(a.cap)] * 10 - VAL[typeOf(a.piece)] : 0));
    for (const m of moves) {
      const v = -search(makeMove(st, m), depth - 1, -beta, -alpha, ply + 1);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }
  // level 1..3; a little noise so the bot is not a wall
  function botMove(st, level = 2) {
    const moves = legalMoves(st);
    if (!moves.length) return null;
    const depth = level >= 3 ? 3 : level === 2 ? 2 : 1;
    let best = null, bestV = -Infinity;
    for (const m of moves) {
      const ns = makeMove(st, m);
      let v = -search(ns, depth - 1, -Infinity, Infinity, 1);
      if (ns.keys.filter(k => k === ns.keys[ns.keys.length - 1]).length >= 2) v -= 30; // avoid shuffling
      if (m.cap && typeOf(m.piece) === 'k') v -= 600; // a king that loses its duel loses the game
      v += (Math.random() - 0.5) * (level === 1 ? 120 : level === 2 ? 40 : 10);
      if (v > bestV) { bestV = v; best = m; }
    }
    return best;
  }

  const api = { START, VAL, FILES, newGame, fromFEN, toFEN, legalMoves, makeMove, failMove, status, inCheck, san, findMove, perft,
    sqName, sqIndex, colorOf, typeOf, other, botMove, checkers, removePiece, evaluate, kingSq, attacked };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Rules = api;
})(this);
