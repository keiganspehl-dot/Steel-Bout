// Builds dist/index.html (one self-contained page) and copies the shared rules into server/.
const fs = require('fs'), path = require('path');
const d = f => path.join(__dirname, f), rd = f => fs.readFileSync(d(f), 'utf8');
let html = rd('src/index.html');
const font = fs.readFileSync(d('src/grenze.woff2')).toString('base64');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
html = html.replace('/*FONT*/', () => font).replace('/*THREE*/', () => safe(rd('src/three.min.js'))).replace('/*RULES*/', () => safe(rd('src/rules.js')))
  .replace('/*ROOM*/', () => safe(rd('src/room.js'))).replace('/*GAME*/', () => safe(rd('src/game.js')));
fs.mkdirSync(d('dist'), { recursive: true });
fs.writeFileSync(d('dist/index.html'), html);
fs.copyFileSync(d('dist/index.html'), d('server/index.html'));
fs.copyFileSync(d('src/rules.js'), d('server/rules.js'));
fs.copyFileSync(d('src/room.js'), d('server/room.js'));
console.log('built', (html.length / 1024).toFixed(0) + ' KB', 'gzipped', (require('zlib').gzipSync(html, { level: 9 }).length / 1024).toFixed(0) + ' KB');
