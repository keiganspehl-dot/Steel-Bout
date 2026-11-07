# Gunmate

Chess where every capture is a first-person gunfight. Full standard chess rules; online play with friends
(two seats plus spectators) on our own small Fly.io server, and a practice mode against a bot.

## Files
- `src/rules.js` chess rules (castling, en passant, promotion, check, mate, stalemate, threefold, fifty-move,
  insufficient material) plus the "attacker lost its duel" outcome. Checked with the standard perft positions.
- `src/room.js` the referee for one table: seats, clocks, moves, duel health, fire-rate and hit checks.
  The server runs it for online tables; practice runs it inside the page.
- `src/game.js`, `src/index.html` the client (three.js r149).
- `server/` what goes to Fly: `server.js` (no npm packages: http, a small WebSocket at /ws, gzip), `Dockerfile`, `fly.toml`.
- `build.js` builds `dist/index.html` and copies it plus the rules into `server/`. Run `node build.js` after any change.
- `tools/` tests: `node tools/rules-test.js`, `node tools/room-test.js`, and with the server running locally
  (`cd server && PORT=8099 node server.js`) `node tools/net-test.js`.

## Duel rules
Capture = duel on the real board, other pieces are cover. 3 s countdown, then 45 s. Attacker topples the
defender: capture happens. Defender wins: the attacker falls and the turn passes, except that a king losing ANY duel loses the game (kings are the weakest fighters: 60 health, 22 damage) and a
piece whose fall would expose its own king (it holds its ground). Time out: higher health fraction wins, tie goes to
the defender. Chess clocks pause during duels. Checkmate is a forced fight too (last stand): the mated king duels the checking piece; king loses = checkmate, king wins = the checker falls (unless that would expose its own king, then mate stands) and play continues. Captures as plain chess can be chosen in the table settings.

## Deploy to Fly
From the `server/` folder, with flyctl installed and signed in (`fly auth login`):

    fly apps create gunmate          # once; pick another name if taken and change app = in fly.toml
    fly deploy --ha=false

The site is then https://gunmate.fly.dev. One shared-cpu-1x 256 MB machine; it stops when nobody is connected and
wakes on the next visit (the first load after a sleep takes a couple of seconds).
From a cloud container: start dockerd and use `fly deploy --local-only --ha=false` with
`SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` and `FLY_API_TOKEN` set.

## Network fairness
Each player moves and aims locally (no input delay), and a hit is claimed by the shooter against what they see.
The server keeps a short position history per player (stamped with arrival time minus half the sender's round
trip) and judges each shot against where the target was on the *shooter's* screen (lag compensation), so a
high-ping player and a low-ping player get the same fight. Opponents are drawn with dead reckoning (30 Hz packets
carrying velocity). Countdowns start at the same server instant for both players (client subtracts half its RTT).
Test: `node tools/lag-test.js`.
