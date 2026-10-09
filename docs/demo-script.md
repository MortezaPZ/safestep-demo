# Three-minute demo

This path has been run. Follow it in order.

## Five minutes before

```bash
cd backend
npm install
npm run seed
npm start
```

Open two browser windows side by side. The app is `http://localhost:4000`.

| Window | Account |
| --- | --- |
| Left | Primary user, phone `09121110001` |
| Right, private / incognito | Family member with emergency access, phone `09121110002` |

The second window must be private. Otherwise both windows share one session and the live update is invisible.

The login page can fill these accounts. Password: `Test@1234`. A third seeded phone, `09121110003`, is family without emergency access. Display names in the seed are Persian.

Both windows should show a green live chip before you start.

## 0:00 to 0:25. Opening

Two people want different things. The person being cared for wants to go out. The family wants to know when something is wrong. A product that only thinks about safety gets switched off. The design is that tension.

On the left dashboard, the first line is not a report about the person. It is their own control: who is receiving the location, and a button to stop sharing.

## 0:25 to 0:50. Status and an invite

Point at the status card. Green means inside the home zone. Amber means outside. Grey means unknown. Color is never the only signal. The status text is always next to it.

Open Family, create an invite, and pick an access level. The three levels are enforced in the database, not only as labels. The code is six digits, single use, valid for fifteen minutes, and the server stores only a hash.

## 0:50 to 1:20. The family view

The right window is already connected. The family member sees the live point. The solid circle is the safe zone. The dashed circle is the exit threshold.

## 1:20 to 2:00. Live update

On the left, open presentation mode, choose the route that leaves the zone, and start it.

Say this before the point moves: the coordinates are fake, and the screen says so. The pings still go through the real API, into the real table, through the real engine. Each row is flagged simulated.

Both windows should move the blue point together. Wait for the alert, about ten seconds at eight times speed. It should land on the family dashboard in under two seconds, with type, time, distance, and zone radius.

Then the technical point. The dashed circle exists because "distance greater than radius" on twenty noisy boundary pings produced nineteen alerts. This engine produced zero, and a real exit still produces one. The test is `backend/tests/geofence.test.js`.

## 2:00 to 2:30. SOS

On the left dashboard, press the red SOS button. Red is used only here. If every alert were red, a real request for help would not stand out.

A dialog opens with a three-second countdown. It names who will be notified. Nothing is sent until the countdown finishes. Cancelling does not leave a red alert on the family screen.

On the right, a red emergency bar appears with a call action. It reaches only the family member who has emergency access. The third seeded account can see location and ordinary alerts and does not receive SOS. That split is in the query.

## 2:30 to 2:50. History and stopping the share

Open route history. Older segments are lighter. Newer segments are stronger. The day's stats are on the page. Delete history removes the rows. It does not set a hidden flag.

Back on the dashboard, turn sharing off and confirm. The right window should say the location is hidden, immediately, without an error.

## 2:50 to 3:00. Close

There is no dead button and no blank page in this path. The suite at the time of the demo was 83 tests. The layout is right-to-left, dates are Jalali, a dark theme exists, and the touch targets are large.

The gap from this demo to a finished product is depth of data and the mobile app, not a missing backend. The written status is `docs/progress.md`.

## If something fails

| Problem | What to do |
| --- | --- |
| The live chip is not green | Reload. The WebSocket reconnects |
| The point does not move | Presentation mode: confirm the simulator is running |
| No alert | The route must be the one that leaves the zone, not the neighborhood loop |
| The map is grey | Map tiles need a network. The rest of the demo still runs |
| Both windows are the same user | The second window must be private |
| The database is in a bad state | Run `npm run seed` again |

## Questions that come up

Does it work, or is it a picture? The backend is real. Run `npm test` in `backend`.

Why is there no phone notification? The FCM path is implemented. It stays on the in-app fallback until `FCM_SERVER_KEY` is set. `/health` shows which mode is active.

Where is the mobile app? This demo repository is the backend and the web dashboard. The Flutter client lives in the main SafeStep repository. Say that directly.

How does real GPS work? The phone posts to the same endpoint and sets `is_simulated` to false.
