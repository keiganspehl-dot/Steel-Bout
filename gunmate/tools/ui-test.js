const { chromium } = require('playwright');
const URL = 'http://localhost:8099/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  const mk = async name => { const p = await br.newPage({ viewport: { width: 1280, height: 720 } }); p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); }); return p; };
  const a = await mk('A');
  await a.goto(URL + '?test'); await sleep(1500);
  await a.screenshot({ path: 'shots/menu.png' });
  await a.fill('#name', 'Keigan');
  await a.click('#bCreate'); await sleep(800);
  const code = await a.textContent('#lCode'); console.log('code', code);
  const b = await mk('B');
  await b.goto(URL + '?test&room=' + code); await b.fill('#name', 'Friend'); await b.click('#bJoin'); await sleep(800);
  await a.screenshot({ path: 'shots/lobby.png' });
  await a.click('#bStart'); await sleep(1200);
  const sq = n => 'abcdefgh'.indexOf(n[0]) + (n[1] - 1) * 8;
  const move = async (p, f, t) => { await p.evaluate(([f, t]) => { GM.clickSquare(f); GM.clickSquare(t); }, [sq(f), sq(t)]); await sleep(900); };
  await move(a, 'e2', 'e4'); await move(b, 'd7', 'd5');
  await a.evaluate(() => GM.clickSquare(12 + 16)); await sleep(300);
  await a.screenshot({ path: 'shots/board-select.png' });
  await a.evaluate(() => GM.clickSquare(35)); await sleep(1500);
  console.log('A duel', await a.evaluate(() => !!GM.duel), 'B duel', await b.evaluate(() => !!GM.duel));
  await a.screenshot({ path: 'shots/duel-count-a.png' });
  await sleep(2500);
  // A (attacker) aims at B and fires
  await a.evaluate(() => { GM.setLocked(true); const d = GM.duel; const dx = d.foe.x - d.self.x, dz = d.foe.z - d.self.z; GM.aim(Math.atan2(-dx, -dz), -0.05); GM.fire(true); });
  await b.evaluate(() => { GM.setLocked(true); GM.keys.KeyA = true; });
  await sleep(700);
  await a.screenshot({ path: 'shots/duel-a.png' }); await b.screenshot({ path: 'shots/duel-b.png' });
  await sleep(4000);
  await a.evaluate(() => GM.fire(false)); await b.evaluate(() => { GM.keys.KeyA = false; });
  console.log('hp', JSON.stringify(await a.evaluate(() => GM.duel && GM.duel.hp)));
  await a.screenshot({ path: 'shots/duel-end-a.png' });
  await sleep(3500);
  console.log('after', JSON.stringify(await a.evaluate(() => ({ phase: GM.S.phase, sans: GM.S.sans }))));
  await a.screenshot({ path: 'shots/board-after.png' });
  // solo practice
  const c = await mk('C'); await c.goto(URL + '?test'); await c.evaluate(() => GM.startSolo(2, 'w')); await sleep(800);
  for (const [f, t] of [['e2', 'e4'], ['d2', 'd4'], ['g1', 'f3'], ['f1', 'c4']]) { await move(c, f, t); await sleep(400); }
  console.log('solo', JSON.stringify(await c.evaluate(() => ({ phase: GM.S.phase, sans: GM.S.sans, duel: !!GM.duel }))));
  await c.screenshot({ path: 'shots/solo.png' });
  console.log('errors', errs.length ? errs.join('\n') : 'none');
  await br.close();
})();
