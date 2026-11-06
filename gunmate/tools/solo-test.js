const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  const c = await br.newPage({ viewport: { width: 1280, height: 720 } });
  c.on('pageerror', e => errs.push(e.message)); c.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await c.goto('http://localhost:8099/?test'); await sleep(1000);
  await c.screenshot({ path: 'shots/menu2.png' });
  await c.evaluate(() => GM.startSolo(3, 'w')); await sleep(600);
  const sq = n => 'abcdefgh'.indexOf(n[0]) + (n[1] - 1) * 8;
  // play until a duel happens or 12 moves
  for (let i = 0; i < 14; i++) {
    const st = await c.evaluate(() => ({ phase: GM.S.phase, turn: GM.S.turn, fen: GM.S.fen, duel: !!GM.duel }));
    if (st.duel) break;
    if (st.turn === 'w' && st.phase === 'play') {
      await c.evaluate(() => { const R = GM.R, s = R.fromFEN(GM.S.fen); const ms = R.legalMoves(s); const m = ms.find(m => m.cap) || R.botMove(s, 1); GM.clickSquare(m.from); GM.clickSquare(m.to); });
    }
    await sleep(1500);
  }
  const d = await c.evaluate(() => GM.duel && { me: GM.duel.d.type[GM.duel.meC], foe: GM.duel.d.type[GM.duel.foeC] });
  console.log('duel', JSON.stringify(d), JSON.stringify(await c.evaluate(() => GM.S.sans)));
  await c.evaluate(() => GM.setLocked(true));
  await sleep(5000);
  await c.screenshot({ path: 'shots/solo-duel.png' });
  console.log('hp after 5s idle', JSON.stringify(await c.evaluate(() => GM.duel && GM.duel.hp)));
  await sleep(9000);
  console.log('state', JSON.stringify(await c.evaluate(() => ({ phase: GM.S.phase, sans: GM.S.sans, duel: !!GM.duel }))));
  await c.screenshot({ path: 'shots/solo-after.png' });
  console.log('errors', errs.length ? errs.join('\n') : 'none');
  await br.close();
})();
