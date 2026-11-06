// Gunmate server for Fly.io. No npm packages: Node's own http, crypto and zlib.
// Serves the single-page game (gzipped once at boot) and a WebSocket at /ws where every room is refereed
// by room.js, so the rules, clocks and duel health live on the server, not in anyone's browser.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const { Room } = require('./room.js');
const PORT = process.env.PORT || 8080;

const html = fs.readFileSync(path.join(__dirname, 'index.html'));
const gz = zlib.gzipSync(html, { level: 9 });
const etag = '"' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 16) + '"';

const srv = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.end('ok'); return; }
  if (url === '/stats') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rooms: rooms.size, sockets: sockets })); return; }
  if (url !== '/' && url !== '/index.html') { res.statusCode = 302; res.setHeader('location', '/'); res.end(); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('etag', etag);
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('content-encoding', 'gzip'); res.end(gz); }
  else res.end(html);
});

// ---------- a small WebSocket server (RFC 6455, text frames only) ----------
let sockets = 0, nextId = 1;
function wsFrame(str) {
  const data = Buffer.from(str), n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : null;
  if (!head) { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return Buffer.concat([h, data]); }
  return Buffer.concat([head, data]);
}
srv.on('upgrade', (req, sock) => {
  if (req.url.split('?')[0] !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  sockets++;
  const c = { id: 'p' + nextId++, sock, room: null, alive: true, buf: Buffer.alloc(0), frag: [], rate: [0, 0] };
  c.send = m => { if (!sock.destroyed) sock.write(wsFrame(JSON.stringify(m))); };
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    if (c.buf.length > 1 << 20) return sock.destroy();
    for (;;) {
      const b = c.buf; if (b.length < 2) break;
      const fin = b[0] & 0x80, op = b[0] & 15, masked = b[1] & 0x80;
      let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 65536) return sock.destroy();
      const mOff = off; if (masked) off += 4;
      if (b.length < off + len) break;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[mOff + (i & 3)];
      c.buf = b.subarray(off + len);
      if (op === 8) { try { sock.end(Buffer.from([0x88, 0])); } catch (e) {} return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload.subarray(0, 125)])); continue; }
      if (op === 10) { c.alive = true; continue; }
      if (op === 1 || op === 0) {
        c.frag.push(payload);
        if (fin) { const text = Buffer.concat(c.frag).toString(); c.frag = []; onText(c, text); }
      }
    }
  });
  const gone = () => { if (c.dead) return; c.dead = true; sockets--; leave(c); };
  sock.on('close', gone); sock.on('error', gone); sock.on('end', gone);
  c.alive = true; pool.add(c);
});
const pool = new Set();
// keep Fly's proxy from timing out quiet sockets, and drop dead ones
setInterval(() => {
  for (const c of pool) {
    if (c.dead) { pool.delete(c); continue; }
    if (!c.alive) { c.sock.destroy(); pool.delete(c); continue; }
    c.alive = false;
    try { c.sock.write(Buffer.from([0x89, 0])); } catch (e) {}
  }
}, 25000).unref();

// ---------- rooms ----------
const rooms = new Map();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { for (;;) { let s = ''; for (let i = 0; i < 5; i++) s += ALPHA[crypto.randomInt(ALPHA.length)]; if (!rooms.has(s)) return s; } }
function leave(c) {
  const r = c.room; c.room = null; if (!r) return;
  r.remove(c.id);
  if (r.empty()) r.emptySince = Date.now();
}
setInterval(() => { // rooms with nobody connected go after 3 minutes (rejoin window is 90 s)
  for (const [k, r] of rooms) if (r.empty() && Date.now() - (r.emptySince || 0) > 180000) rooms.delete(k);
}, 30000).unref();

function onText(c, text) {
  const now = Date.now();
  if (now - c.rate[0] > 1000) { c.rate = [now, 0]; }
  if (++c.rate[1] > 80) return; // flood guard
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'create' || m.t === 'join') {
    leave(c);
    const code = m.t === 'create' ? newCode() : String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    let r = rooms.get(code);
    if (!r) {
      if (m.t === 'join') { c.send({ t: 'error', text: 'No room with code ' + code + '.', code: 'noroom' }); return; }
      r = new Room(code); rooms.set(code, r);
    }
    if (r.add(c.id, m.name, c.send, String(m.token || '').slice(0, 40))) {
      c.room = r; r.emptySince = 0;
      if (m.t === 'create' && m.s) r.handle(c.id, { t: 'settings', s: m.s });
    }
    return;
  }
  if (m.t === 'ping') { c.send({ t: 'pong', at: m.at }); return; }
  if (c.room) c.room.handle(c.id, m);
}

srv.listen(PORT, () => console.log('Gunmate server on', PORT));
