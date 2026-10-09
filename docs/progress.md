# SafeStep demo progress

Written so a reader can see what is built, what is simulated, and what is still missing, without reading the source.

Date of the original note: 23 August 2026 (Jalali 1 Shahrivar 1405). Status at that date: a technical demo that can be presented.

## 1. One paragraph

A runnable system exists: a Node.js backend, PostgreSQL, real authentication, a geofence engine with hysteresis, long-stop detection, live updates over WebSocket, and a right-to-left web dashboard. The three-minute path from sign-in to an emergency alert was executed and tested. The simulated part is the source of the GPS coordinates. The interface labels that mode, and each stored row has `is_simulated`.

## 2. What actually runs

Checked on this machine.

### Backend

| Piece | Status | Note |
| --- | --- | --- |
| Data model and migrations | Done | 11 tables, versioned, run on PostgreSQL |
| JWT | Done | 15-minute access token, 30-day refresh with rotation |
| Password hash | Done | bcrypt, configurable rounds |
| Invite code | Done | 6 digits, single use, 15-minute expiry, HMAC-SHA256 |
| Record-level access | Done | Three levels, enforced in SQL |
| Geofence | Done | Haversine, 25 m hysteresis, debounce, cooldown |
| Long stop | Done | Moving window, scatter radius, gap detection |
| GPS loss | Done | Configurable threshold |
| Low battery | Done | 6-hour cooldown |
| WebSocket | Done | One room per user, authenticated on connect |
| SOS | Done | Live position, or the last known point marked stale |
| Rate limits | Done | Separate limits for auth, SOS, and invite codes |
| Input validation | Done | zod on every endpoint |
| REST API | Done | 35 endpoints |

### Web dashboard

| Page | Status |
| --- | --- |
| Sign-in and registration, with seeded demo accounts | Done |
| Primary-user dashboard: status, chips, SOS, map | Done |
| Family dashboard | Done |
| Alerts, filtered by type and read state | Done |
| Safe zones: tap the map, slide the radius | Done |
| Family members: invite code, access level, disconnect | Done |
| Route history with a time gradient | Done |
| Settings: privacy, alerts, thresholds, theme | Done |
| Presentation mode | Done |

Each page has loading, empty, error, and success states.

### Quality recorded at that date

| Measure | Value |
| --- | --- |
| Unit tests | 57 (Haversine, geofence, long stop) |
| Integration tests | 26 (registration through SOS) |
| Total | 83, all passing at that date |
| Browser console errors | None observed |
| Unwanted horizontal scroll | None observed |

Later dependency updates can change the test run. The command is `npm test` in `backend`.

## 3. What is simulated

### GPS

The coordinates are simulated. Everything after that is the real path. Simulated pings go through `POST /api/v1/locations/ping`, land in the same table, run through the same geofence engine, and raise the same alerts.

Marking:

- `is_simulated` on every row of `location_pings`
- A presentation-mode chip on the status card, on the map, and on related alerts
- A page that states what is real and what is not

### Push

The FCM path is implemented: device tokens, payload, batch send, invalid-token cleanup, high priority for a critical alert. A real send is off because no FCM key was configured. The adapter falls back to an in-app WebSocket delivery plus a log line. In the demo that path is under a second. Set `FCM_SERVER_KEY` in `.env` to turn the real send on. No code change. `/health` shows the current mode.

### History seed

The seed script builds two days of route history and eight sample alerts. The routes use the same geometry functions and a walking speed. They are not real events. Every row has `is_simulated = true`.

## 4. Decisions

### Hysteresis

Without a dead band, a person standing on the zone edge flips in and out on ordinary urban GPS noise (about 10 to 30 meters).

On 20 noisy pings at the boundary:

| Method | Alerts |
| --- | --- |
| Distance greater than radius | 19 |
| This engine (hysteresis and debounce) | 0 |

A real exit still produces exactly one alert. The test is `backend/tests/geofence.test.js`.

Three independent checks:

1. Dead band: exit at radius plus 25 m, return at radius minus 25 m
2. Debounce: two consecutive pings in the same direction
3. Cooldown: at least 60 seconds between two alerts of the same type

### Two database paths

`docker compose up` starts PostgreSQL, as requested. The second driver is PGlite, PostgreSQL compiled to WebAssembly inside the Node process. The same SQL and the same migrations run on both. On a laptop without Docker, `npm start` still comes up.

### No web build step

The dashboard is ES modules and Leaflet. Leaflet, socket.io, and the Vazirmatn font are served locally (445 KB) so the demo does not depend on a CDN. Map tiles from OpenStreetMap still need a network.

### Invite codes use HMAC

A 6-digit code has 10^6 values. bcrypt would not stop an online guess. Rate limiting and the 15-minute expiry do that. bcrypt also cannot be looked up directly. HMAC with the server key can, and a database leak alone does not enable an offline search.

## 5. Independence and safety

When the primary user turns sharing off:

| Behavior | Result |
| --- | --- |
| Store the ping | Continues. The person's own history stays theirs |
| Broadcast location to the family | Stops |
| Zone-exit alert | Stops. That alert would leak location |
| SOS | Still works. The person started it |

The family screen says sharing is paused. It does not show an error. The primary dashboard always shows how many people are receiving the location, who they are, and a control to stop.

## 6. Not in this demo at the date of the note

| Item | Status then | Estimate then |
| --- | --- | --- |
| Flutter app | Source written, not compiled. The Flutter SDK was not on the demo machine | About a day to build and fix |
| Real FCM | Structure done, key missing | About two hours |
| SMS verification | Sign-up has no SMS check | About a day, plus an SMS contract |
| Background tracking | Needs platform permissions and native work | Two to three days |
| Battery-aware ping interval | Not built | About two days |
| PostGIS | Haversine in the service. Needed at larger scale | About a day |
| Admin console | Not built | About two days |
| English UI strings | Structure ready, translations not written | About a day |
| Load test | Not run on the demo tree | About a day |

The main SafeStep repository later added a Flutter client, a PostgreSQL load note, and an English set of documents. This demo tree is the presentation build: backend and web.

## 7. Roadmap suggested at that date

1. Finish the mobile build, connect FCM, add SMS verification.
2. Background tracking, battery interval, load test, and centralized logs.
3. An admin console, analytical reports, an English UI, and a usability test with real users.

## 8. Run it yourself

```bash
cd backend
npm install
npm run seed
npm start
```

Open `http://localhost:4000`. The login page can fill the seeded accounts. The password is `Test@1234`.

```bash
cd backend
npm test
```

The timed walk-through is `docs/demo-script.md`.
