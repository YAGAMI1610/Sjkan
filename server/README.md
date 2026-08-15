# CADE Meme Madness — Reference Backend

Implements Part B of the production build spec:

| # | Requirement | Where |
|---|---|---|
| 9 | Server-authoritative round outcomes | `POST /api/round/outcome` |
| 10 | Accounts + multi-device persistence | `X-Device-Id` auth + `Store` (swap for a real DB) |
| 11 | Real-time/polled leaderboard | `GET /api/leaderboard` + central 15s tick |
| 12 | Rate limiting / abuse prevention | 24h daily claim, one-time boosts, one vote/round — all enforced in `server.js`, not the client |

## Run it

```
cd server
npm install
npm start        # listens on :3001 by default
```

Then serve the frontend and set, before `app.js`/`api-client.js` load:

```html
<script>window.CADE_API_BASE = "http://localhost:3001/api";</script>
```

If no backend is reachable, `api-client.js` automatically falls back to the
original local/localStorage simulation — the game still works standalone.

## Auth model

Lightweight device-linked accounts: the client generates a random device id
once (`cade_mm_device_id` in localStorage) and sends it as `X-Device-Id` on
every request. This is intentionally the simplest thing that gives "my
progress follows me across sessions on this device," and is a drop-in
upgrade path to email/OAuth later — every route only reads `req.account`,
resolved once in the `auth` middleware.

## Swapping in a real database

Everything talks to the `Store` object at the top of `server.js`. Replace its
methods with calls to Postgres/Mongo/etc. and no route logic needs to change.
The in-memory `Map` here is for reference/dev only — it resets on restart and
does not scale across multiple server instances.

## Endpoints

- `GET  /api/health`
- `POST /api/round/outcome`
- `POST /api/daily-claim`
- `POST /api/boost` `{ id }`
- `POST /api/session/start` `{ session }`
- `POST /api/round/submit` `{ sessionId, round }`
- `POST /api/session/end` `{ sessionId, session }`
- `GET  /api/leaderboard`
- `GET  /api/history`
- `GET  /api/records`
- `POST /api/meme/submit` `{ meme }`
- `POST /api/vote` `{ roundId, coinTicker }`

## Known simplifications (call out in a real launch)

- In-memory store — swap for a real DB before shipping.
- The outcome endpoint doesn't itself verify server-side elapsed time before
  responding; add a `roundStartedAt` check if you want to fully close the
  "call it early" loophole rather than just moving generation server-side.
- No auth beyond a device id — fine for a points-only game, not sufficient
  if real money or PII enters the picture.
