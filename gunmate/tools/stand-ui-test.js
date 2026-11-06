// Two browsers: Scholar's mate, the Qxf7 duel, then the king's last stand, all through the live server code.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errs = [];
  const mk = async n => { const p = await br.newPage({ viewport: { width: 960, height: 540 } }); p.on('pageerror', e => errs.push(n + ': ' + e.message)); return p; };
  const a = await mk('A'); await a.goto('http://localhost:8099/?test'); await a.fill('#name', 'Keigan'); await a.click('#bCreate'); await sleep(700);
  const code = await a.textContent('#lCode');
  const b = await mk('B'); await b.goto('http://localhost:8099/?test&room=' + code); await b.fill('#name', 'Pal'); await b.click('#bJoin'); await sleep(700);
  await a.click('#bStart'); await sleep(900);
  const sq = n => 'abcdefgh'.indexOf(n[0]) + (n[1] - 1) * 8;
  const move = async (p, f, t) => { await p.evaluate(([f, t]) => { GM.clickSquare(f); GM.clickSquare(t); }, [sq(f), sq(t)]); await sleep(700); };
  for (const [p, f, t] of [[a, 'e2', 'e4'], [b, 'e7', 'e5'], [a, 'f1', 'c4'], [b, 'b8', 'c6'], [a, 'd1', 'h5'], [b, 'g8', 'f6'], [a, 'h5', 'f7']]) await move(p, f, t);
  const shootUntil = async (pred, label) => {
    for (let i = 0; i < 120; i++) {
      await a.evaluate(() => { const d = GM.duel; if (!d || d.ending) { GM.fire(false); return; } GM.setLocked(true); const dx = d.foe.x - d.self.x, dz = d.foe.z - d.self.z, dy = d.foe.arm.h * 0.5 - d.self.arm.h * 0.84; GM.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); GM.fire(true); });
      if (await a.evaluate(pred)) break; await sleep(500);
    }
    await a.evaluate(() => GM.fire(false));
    console.log(label, JSON.stringify(await a.evaluate(() => ({ phase: GM.S.phase, stand: !!(GM.S.duel && GM.S.duel.lastStand), sans: GM.S.sans.slice(-2) }))));
  };
  await shootUntil(() => GM.S.duel && GM.S.duel.lastStand, 'after Qxf7 duel');
  await sleep(1200); await a.screenshot({ path: 'shots/last-stand-a.png' }); await b.screenshot({ path: 'shots/last-stand-b.png' });
  await shootUntil(() => GM.S.phase === 'over', 'after last stand');
  await sleep(1500); await a.screenshot({ path: 'shots/mate-a.png' });
  console.log('result', JSON.stringify(await b.evaluate(() => GM.S.result)), 'errors', errs.length ? errs : 'none');
  await br.close();
})();
