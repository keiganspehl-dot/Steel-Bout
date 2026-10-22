// Steel Bout game server for Fly.io: serves the game page and runs a small MQTT-over-WebSocket relay at /mqtt,
// so players reach each other through our own server on the ordinary web port instead of borrowed public brokers.
const http = require('http'), fs = require('fs'), path = require('path');
const aedes = require('aedes')();
const ws = require('websocket-stream');
const PORT = process.env.PORT || 8080;
const page = () => fs.readFileSync(path.join(__dirname, 'index.html'));
// only Steel Bout topics, small messages
aedes.authorizePublish = (c, p, cb) => cb(p.topic.startsWith('steelbout/') && p.payload.length < 16384 ? null : new Error('no'));
aedes.authorizeSubscribe = (c, s, cb) => cb(null, s.topic.startsWith('steelbout/') ? s : null);
const srv = http.createServer((req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-cache');
  res.end(page());
});
ws.createServer({ server: srv, path: '/mqtt' }, aedes.handle);
srv.listen(PORT, () => console.log('Steel Bout server on', PORT));
