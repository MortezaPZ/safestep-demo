# SafeStep Demo

A safety and tracking demo for someone who wants to go out independently, and for the family that needs to know when something is wrong.

The person can see who is watching and can cut sharing with one action. The family is still notified when that person raises an emergency.

This repository is the backend and the web dashboard. The Flutter client lives in the separate `safestep` repository and is not in this demo tree.

## Overview

One command starts an API and a web console on embedded PGlite, so the demo does not need Docker or a PostgreSQL install. The same SQL migrations run. A second mode starts a real PostgreSQL with Docker Compose.

## Features

Primary user:

- A three-state status card: inside the zone, outside, or unknown
- A large SOS control with a 3-second countdown that can be cancelled
- A banner that lists who can see the location, with an immediate stop
- A safe zone drawn on the map, with a live radius preview
- Family members and a permission level for each
- Route history, including a real delete

Family member:

- A live map
- An alert timeline filtered by type and read state
- An emergency bar with a call action when an SOS arrives
- Route history for a chosen day

Engine:

- Geofencing with Haversine, hysteresis, and debounce
- A long-stop detector on a moving window and a scatter radius
- Lost-GPS and low-battery alerts
- WebSocket broadcast with sub-second delay in the demo

## Technology Stack

- Node.js 20+
- Express
- PostgreSQL 16, or PGlite when Docker is not used
- Leaflet and Socket.IO in a no-build web dashboard
- zod for request validation

## Architecture

```
web dashboard (ES modules + Leaflet)
        |  REST + WebSocket
Node.js + Express
  routes -> controllers -> services -> repositories
                |              |
         geofence engine   stop detector
                |
         notification adapter (FCM or WebSocket)
                |
         PostgreSQL or PGlite
```

Services do not import Express or Socket.IO. The geofence engine and the stop detector are tested without a server and without mocks. That is what the unit files cover. The SOS integration test runs Express, JWT, the database, the geofence engine, and alert delivery for real.

WebSocket events: `location:update`, `alert:new`, `sharing:changed`, `zone:state`, `simulator:status`.

## Installation

No Docker:

```bash
cd backend
npm install
npm run seed
npm start
```

Open `http://localhost:4000`.

Docker:

```bash
docker compose up
```

Compose starts PostgreSQL, runs migrations, and loads the sample data.

Seeded logins. The password for all three is `Test@1234`.

| Phone | Role |
| --- | --- |
| `09121110001` | Primary user |
| `09121110002` | Family member, including emergency access |
| `09121110003` | Family member, without emergency access |

The seeded display names are Persian. Open a second window in a private session, or both tabs share one login.

The three-minute walkthrough is `docs/demo-script.md`.

## Usage

Base path: `/api/v1`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Register with a mobile number |
| `POST` | `/auth/login` | Log in |
| `POST` | `/auth/refresh` | Rotate the refresh token |
| `POST` | `/auth/logout` | Log out |
| `GET` | `/auth/me` | Profile and settings |
| `POST` | `/guardianships/invites` | Create a 6-digit invite |
| `POST` | `/guardianships/redeem` | Family member redeems the code |
| `GET` | `/guardianships` | Relationships in both directions |
| `PATCH` | `/guardianships/:id` | Change the permission level |
| `DELETE` | `/guardianships/:id` | Revoke access |
| `POST` | `/locations/ping` | Store a fix and run the engines |
| `GET` | `/locations/status` | The caller's own status |
| `GET` | `/locations/watching` | People this account watches |
| `GET` | `/locations/current` | Latest fix for one user |
| `GET` | `/locations/history` | Route history |
| `DELETE` | `/locations/history` | Delete the stored route |
| `PUT` | `/locations/sharing` | Turn sharing on or off |
| `GET` `POST` | `/safe-zones` | List and create zones |
| `POST` | `/safe-zones/preview` | Preview before save |
| `PATCH` `DELETE` | `/safe-zones/:id` | Edit and delete |
| `GET` | `/alerts` | Alerts, filter by type and unread |
| `POST` | `/alerts/:id/read` | Mark read |
| `POST` | `/alerts/:id/resolve` | Close an alert |
| `POST` | `/sos` | Emergency alert, rate-limited |
| `GET` | `/sos/contacts` | Emergency contacts |
| `GET` `PATCH` | `/settings` | User settings |
| `POST` | `/devices` | Register a push token |
| `GET` | `/simulator/routes` | Simulation paths |
| `POST` | `/simulator/start` and `/stop` | Control the simulator |
| `GET` | `/health` | Service health |

Who can see what is enforced in SQL, not only in the page:

| Role | Live location | Normal alert | SOS | History | Delete data |
| --- | --- | --- | --- | --- | --- |
| Primary user | yes | yes | yes | yes | yes |
| `view_location` | yes | no | no | yes | no |
| `receive_alerts` | no | yes | no | no | no |
| `emergency` | no | yes | yes | no | no |
| Revoked | no | no | no | no | no |

`backend/tests/sos.integration.test.js` checks that SOS reaches only the emergency permission.

When the primary user turns sharing off, pings are still stored for that user, family broadcast stops, and a zone-exit alert is not sent, because that alert would leak location. The SOS button still works, because the person started it.

Invite codes are single-use, expire in 15 minutes, are rate-limited, and are redeemed atomically. They are stored as an HMAC with a key that is not in the database. Passwords use bcrypt. Refresh tokens rotate, and reuse revokes the session family. The logger strips coordinates before it writes.

## Testing

```bash
cd backend && npm test
```

| File | Tests | What it covers |
| --- | --- | --- |
| `backend/tests/geo.test.js` | 19 | Haversine, centroid, scatter, interpolation |
| `backend/tests/geofence.test.js` | 21 | Hysteresis, debounce, chatter |
| `backend/tests/stopDetector.test.js` | 17 | Stop, movement, data gaps, lost GPS |
| `backend/tests/sos.integration.test.js` | 26 | Register through SOS on the real stack |
| Total | 83 | |

## Limitations

This is a technical demo, not a store release.

| Item | State |
| --- | --- |
| Flutter app | Not in this repository |
| Real FCM | The adapter is implemented. Set `FCM_SERVER_KEY`. Otherwise delivery is in-app plus WebSocket. `/health` shows which one is active |
| SMS verification | Registration does not confirm the phone |
| Background tracking | Needs native Android and iOS permissions. Not demonstrated here |
| Battery-aware ping interval | The interval is fixed |
| PostGIS | Distances use Haversine in the service |
| Admin panel | Not built |
| Load test | Not part of this demo tree |

The simulator is the only fake piece: the source of the coordinates. Storage, the geofence engine, the stop detector, permission checks, and the live broadcast are the real code. Simulated pings go through the same endpoint and are stored with `is_simulated`.

Map tiles need the internet. The rest of the demo runs offline.

Values in `.env.example` are for local use. Generate a real secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## License

Technical demo. See the repository license file if one is present.
