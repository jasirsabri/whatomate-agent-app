# Whatomate Agent App

A lightweight React Native (Expo) client for agents to view their assigned
WhatsApp conversations and reply, built directly against the Whatomate REST
API, with live updates over its WebSocket.

| Phase | What it does | Status |
|---|---|---|
| 1 | Login, conversation list, chat thread | ✅ done |
| 2 | Live WebSocket feed instead of polling | ✅ done |
| 3 | Push notifications when backgrounded | ✅ done |
| 4 | Team scoping, Active/Historic split, manager Queue, WhatsApp-style UI | ✅ done |
| 5 | Standalone Android build (EAS, real `.apk`, no Expo Go needed) | ✅ done |

## Auth: how login actually works here

This took a few wrong turns worth recording, since the fix relies on
something non-obvious.

Whatomate's `/api/auth/login` endpoint **never returns tokens in the JSON
response body** — only as `httpOnly` cookies (`whm_access`, `whm_refresh`),
meant for its browser dashboard. A real browser's JavaScript can't read an
`httpOnly` cookie's value via `document.cookie`, which made it look like
native login wasn't possible at all — that's why this app briefly used
per-agent API keys instead (see git history / earlier version if curious).

It turns out React Native's networking layer **does** expose the raw
`Set-Cookie` response header to JS, unlike a browser (verified directly
against this server before relying on it — see `src/api/cookies.ts`).
`httpOnly` only blocks `document.cookie`; it says nothing about a
non-browser client reading its own HTTP response headers. So:

1. `src/api/auth.ts` posts email/password to `/api/auth/login` directly
   (not through the shared `apiClient`, which doesn't have a token yet)
2. Reads `response.headers['set-cookie']`, pulls out `whm_access` with
   `extractCookieValue()`

**One real limitation, confirmed on-device rather than assumed:**
Whatomate's login response sets *three* cookies at once (`whm_access`,
`whm_refresh`, `whm_csrf`), sent as three separate `Set-Cookie` headers.
On Android, React Native's networking bridge only ever surfaces **one**
of them to JS — verified by testing, not just reasoning about it; a
comma-aware parser was tried first in case they'd arrived joined into one
string, but the other two genuinely never reach JS at all. So this app
only ever gets `whm_access`, never `whm_refresh`.

Practical consequence: there's no working token refresh. Instead:

- The **access token's expiry was extended server-side** (`config.toml`
  → `[jwt]` → `access_expiry_mins`, bumped from the 15-minute default to
  600 = 10 hours) so a login lasts a full workday in practice
- When it does eventually expire, the app signs out cleanly with a clear
  "Your session expired, please sign in again" message (see
  `sessionExpiredMessage` in `AuthContext`), rather than a confusing error
- Sign-out still calls `/api/auth/logout`, but harmlessly no-ops
  server-side revocation since there's no refresh token to revoke —
  local sign-out is what actually matters for this app

A more complete fix exists (a native cookie-jar reader like
`@react-native-cookies/cookies`, which should see all three cookies
correctly since the *native* OkHttp layer likely receives them fine — it's
specifically the JS bridge that drops two of them) but requires leaving
Expo Go for a custom dev client. Parked for now since the extended access
token expiry makes this a non-issue in practice.

This also incidentally solves the multi-agent problem the API-key approach
had: every agent just signs in with their own existing Whatomate account —
nothing to generate, own, or hand out.

### WebSocket auth

The socket only accepts a JWT, authenticated via a message sent right
after connecting (`{"type":"auth","payload":{"token":"<jwt>"}}` — no
header-based auth on `/ws` itself, and no ack on success or failure beyond
the connection just closing if it's rejected). Since we hold a real access
token from login, the socket layer uses that directly
(`ensureFreshAccessToken()` in `src/api/client.ts`) — no separate
token-minting endpoint needed. Note this means the socket can't refresh
either, for the same reason as above; it reconnects (and the app signs
out) once the access token expires.

`new_message` and `status_update` events are broadcast **org-wide**, not
scoped to the assigned agent or open contact — the app filters client-side
by matching `assigned_user_id` / `contact_id` against what's relevant to
the screen currently showing.

## Settings

Reachable only from the login screen ("Server settings" link) — there's
no entry point to it once signed in, since there's nothing here that
applies to an active session:

- **Change the server URL** — so this same app can be shared with agents
  at a different Whatomate organization/instance, not just this one.
  Defaults to `https://whatomate.consyst.biz`. Changing it clears any
  saved login (see below), since old credentials wouldn't mean anything
  against a different server.
- **Forget saved login** — only shown when "Remember me" has been used on
  the login screen; wipes the saved email/password from this device.
- **Contact tag** — scopes the conversation list to contacts tagged with
  this (default `Customer`), since Sales/Support/Careers/Procurement/
  Finance all share one WhatsApp number and tags are the only way to tell
  them apart at the Contact level.
- **Team name** — your own team's name, plain text (not a UUID), resolved
  to the actual team ID at runtime via `GET /api/teams`. Used to scope
  both the Queue and its agent-assignment list to your team specifically.
  Must match the team's name in Whatomate exactly (case-insensitive) —
  ask your manager if you're not sure what it's called there. This field
  is deliberately generic (not "Sales Team") so the same app works for
  any team at any Whatomate org, not just Sales at Consyst.

**Sign out** lives on the Profile tab (bottom bar), alongside your own
availability toggle — not in Settings, since it's a session action tied
to being signed in, not a pre-login setting.

Nothing else in the app is currently user-configurable — the WebSocket
reconnect timing and keep-alive interval are internal implementation
details, not settings.

## What's in this build

- **Login** — email/password, as above, with an optional "Remember me"
  (on by default, with an explicit toggle to opt out) that saves
  credentials in the same secure hardware-backed storage as the session
  token — never plain storage — so a fresh app start or an expired
  session doesn't mean retyping them. Removable anytime via "Forget saved
  login" in Settings
- **Conversation list** — `GET /api/contacts?tags=<configured tag>`,
  further split into two tabs: **Active** (`service_window_open: true` —
  can still send a free-form reply, per WhatsApp's real 24-hour customer
  service window) and **Historic** (window closed, would need a template
  to re-engage). Pull-to-refresh, search, live-updates on relevant
  `new_message`/`contact_update` events, refetch on screen focus as a
  fallback
- **Chat thread** — `GET/POST /api/contacts/{id}/messages`, live-updates
  via the socket instead of polling, `set_contact` sent while a thread is
  open. Re-scrolls to the latest message when the keyboard opens — it
  previously didn't, since the keyboard shrinks the list's visible height
  without changing its content size, so the auto-scroll (which only
  triggers on content-size change) never fired for that case, leaving the
  newest message hidden behind the keyboard. When `service_window_open`
  is false (refreshed on focus, and also flipped to open the instant a
  fresh incoming message arrives via the socket while the chat is
  already sitting open — a customer replying while you're watching the
  screen used to leave the "window closed" banner stuck until you left
  and came back), the input row is replaced entirely with an explanation
  rather than left sitting there inviting a failed send — matches
  WhatsApp's actual rule directly instead of reacting to the failure
  after the fact. A failed send (for this or any other reason) now shows
  the real server error text inline under the message, and a
  status-update race that could previously leave a genuinely-failed
  message stuck showing a stale "sent" checkmark is fixed (see
  `applyPendingStatus` / `pendingStatusUpdatesRef` in the source — the
  WebSocket correction can arrive before the optimistic add of the
  message it's about, since they're independent async paths; it's now
  held and applied the moment that message actually appears, rather than
  silently dropped). Also gains a header **Mark Resolved** button — see
  the fuller explanation under Queue below for why this, not Queue, is
  the primary place for it.
- **Queue** (manager-only) — visible only to accounts with **Transfers:
  Write** (checked live via `GET /api/me` and the same permission logic
  Whatomate's own backend uses — see `src/hooks/useCanManageQueue.ts`).
  Shows your configured team's active transfers, split into three
  sections rather than one flat list, since assignment doesn't change a
  transfer's status (it stays `"active"` either way — only `agent_id`
  changes), which made a flat "Waiting Xm" list look stuck/wrong once
  something was actually picked up:
  - 🔴 **Needs Attention** — `sla_breached` or `escalation_level > 0`,
    shown first regardless of assignment, since a breached-but-assigned
    item is more urgent than a fresh unassigned one. Note: SLA tracking
    is opt-in per org (off by default in Whatomate) — this section will
    just stay empty if it's not turned on for your org.
  - 🟠 **Waiting** — unassigned, not yet breached
  - 🟢 **In Progress** — assigned, on track (`picked_up_at` used for
    "picked up Xm ago", distinct from when it originally entered queue)

  Tapping a row opens **Transfer Detail** (`TransferDetailScreen.tsx`) —
  a read-only preview of the actual conversation, not a straight jump to
  assignment like before. This exists because assigning blind (name and
  phone number only, no idea what the customer actually said) is a real
  problem, not a nice-to-have — a manager needs to read *something*
  before picking who handles it. The same screen also doubles as
  **supervisor monitoring** for already-assigned conversations: an
  In Progress row opens the exact same live-updating view (reusing
  `MessageBubble`, the same rendering the agent's own chat screen uses,
  extracted out specifically so both stay visually identical rather than
  risking drift between two copies), just with "Reassign" as the
  secondary action instead of "Assign" being the primary one. Deliberately
  **read-only, no reply capability** — the point is visibility, not a
  second person quietly co-driving the same conversation without the
  agent knowing. **Requires `Contacts: Read` permission** on top of
  `Transfers: Write` — reading messages for a contact not yet assigned to
  you needs that separately (checked directly against Whatomate's
  `GetMessages` handler); without it, the screen shows a clear message
  about the permission gap rather than a confusing generic "not found".
  No self-pickup — assignment itself is still a manager-only action, by
  design.

  **Mark Resolved** (checkmark button on each row) — closes a transfer out
  by calling `PUT /api/chatbot/transfers/{id}/resume`. This exists because
  a transfer's `status` has no other reliable way to leave `"active"` on
  demand: there's no automatic completion signal when an agent simply
  finishes a conversation. The only other path out is a background SLA
  job that auto-closes stale transfers, and that only fires if SLA
  tracking *and* an `AutoCloseHours` value are both explicitly configured
  for the org (off by default) — without this manual action, a genuinely
  finished conversation could sit showing as "In Progress" indefinitely.
  Confirms via a native `Alert` before calling it, since it can't be
  undone from this screen. Removes the item locally on success rather
  than waiting on a refetch, since "resumed" is a terminal state — no
  further update will ever arrive for it.

  **This is the secondary place for Mark Resolved, though** — the primary
  one is the Chat screen itself (see below), since the agent handling a
  conversation is the one who actually knows it's done, and Whatomate's
  own permission model backs this up (`resume` needs no special
  permission, unlike `assign` — suggesting it's meant to belong to
  whoever's doing the work). Regular agents never see the Queue tab at
  all, so without the Chat-screen version, most of the app's users would
  have no way to resolve anything themselves.
- **Live search** — filters the conversation list on every keystroke, no
  network calls, matching name, phone number, or the last message's
  preview text (`last_message_preview` — already loaded for every
  contact). Stays scoped to whichever tab (Active/Historic) is open.
  Whatomate has no message-content search endpoint at all (checked
  thoroughly) — this searches "the last thing they said," not full chat
  history; finding a contact by something said weeks ago would need a
  real search endpoint added server-side, a separate, bigger project.
- **Unread badge on the Chats tab** — a small green bubble on the tab
  icon itself, matching WhatsApp's own bottom-bar convention. Counts
  conversations with at least one unread message, not the sum of all
  unread messages (reads as more useful than alarming for a tab badge).
- **Profile** (every agent, always visible) — shows your name/email/role
  and an **Available** toggle (`PUT /api/me/availability`). Marking
  yourself away has a real effect, not just cosmetic: Whatomate
  automatically returns any conversations currently assigned to you back
  to the queue, which the app surfaces as a message so it isn't a
  surprise. Sign Out lives here too.
- **Visual design** — styled to match WhatsApp's current (2024+) look
  rather than the older solid-green style: white headers with green used
  selectively (unread badges, the send button, active filter chips),
  rounded message bubbles with a subtle shadow and a faked "tail" corner,
  WhatsApp's exact checkmark convention for message status (single gray =
  sent, double gray = delivered, double blue = read), and filter chips
  for Active/Historic matching the chat-filter pattern WhatsApp itself
  introduced. Shared tokens live in `src/theme.ts`.
- **Bottom tab bar** — Chats / Queue (only if visible) / Profile, matching
  WhatsApp's own move from top tabs to a bottom bar in its 2026 redesign.
  Chat and the assignment screen still push up over the tab bar and cover
  it, same as WhatsApp's own chat screens do.

## Known limitations

- **No working-hours-based auto-availability** — checked Whatomate's
  source for this before considering building it: `BusinessHoursConfig`
  exists, but it's an org/WhatsApp-account-level setting for chatbot flow
  routing (e.g. a different auto-reply outside business hours), not
  anything tied to individual agents. There's no per-agent schedule to
  hook into — `is_available` is purely a manual toggle. Automating it
  (e.g. "away every day after 6pm") would need a separate always-on
  service calling `PUT /api/me/availability` on a timer — real, but a
  bigger, separate project, not something this app alone can do (Expo Go
  apps don't run reliably in the background). Parked for now; manual
  toggle on the Profile tab is what exists today.
- **Queue has no live updates yet** — unlike the conversation list and
  chat thread, the Queue screen only refreshes on pull-to-refresh and
  screen focus, not via the WebSocket. Whatomate does broadcast
  transfer-created/assigned events, but wiring those up was deliberately
  left for a fast-follow rather than blocking this round on it.
- **Sessions last ~10 hours, not indefinitely** — no working token
  refresh (see "Auth" above for why). A full day's use only needs one
  morning login; if it does expire mid-use, you're signed out with a
  clear message rather than a confusing error.
- **Text messages only** — media replies need a `media_url` Whatomate can
  fetch, which needs the pending S3 storage setup solved first. Templates,
  canned responses, and interactive buttons aren't wired up either.
- **In-app notification sound (foreground only)** — plays a local
  on-device notification (sound + banner) for a new incoming message
  assigned to you, while the app is open — toggle on the Profile tab,
  default on. This is deliberately independent of push notifications: it
  reacts to the same WebSocket `new_message` events already driving the
  live Chats list, needs no Firebase/FCM setup, and no server-side bridge
  service. Suppressed for whichever chat is currently open (reuses the
  `set_contact` tracking already in `SocketContext`), and only fires for
  genuinely incoming messages (not our own outgoing replies). See
  `src/notifications.ts`. Notification permission is requested once when
  `MainTabs` first mounts (i.e. right after signing in) rather than only
  when the toggle is touched — since the toggle defaults to "on" in the
  app's own preference, a person would have no reason to ever tap it,
  meaning the permission request would silently never fire on a fresh
  install. Profile also checks the actual OS permission status on focus
  and shows a plain warning (with a retry button) if the toggle says "on"
  but the phone has notifications blocked for the app — this exact gap
  is what caused silent no-sound behavior during testing before the fix.
  Tapping a notification opens the specific chat it's about — the
  contact's id travels in the notification's `data` payload, resolved via
  `GET /api/contacts/{id}` (to get full, current contact details rather
  than reconstructing a partial one from the WS event) and navigated to
  via a `navigationRef` (`src/navigation/navigationRef.ts`), since the tap
  handler lives outside any screen's component tree. Handles both the
  app-already-running case and the rarer cold-start case (app was fully
  killed, the tap itself launched it), the latter checked once per app
  process to avoid re-navigating to the same old chat on every sign-in.
- **Background push notifications** — now built. A separate always-on
  service (`whatomate-push-bridge/`, deployed independently, not part of
  this app) holds its own WebSocket connection to Whatomate and calls
  Expo's push API when a relevant message arrives and the app isn't
  already open. See that project's own README for how it works and how
  it's deployed. On the app side: a push token is fetched and registered
  once notification permission is granted (`MainTabs.tsx`), a lightweight
  heartbeat goes out on the same cadence as the existing WS ping while
  connected (`SocketContext.tsx`) — this is what lets the bridge skip
  pushing to a device whose app is already open, since the foreground
  local notification already covers that case with better suppression
  than the bridge could ever do server-side — and the token is
  unregistered on sign-out, before tokens are cleared (order matters
  there — see the comment in `AuthContext.tsx`). Tapping a push opens the
  right chat via the same tap-handling built for local notifications;
  no separate code was needed since the bridge sends the same `contactId`
  data field. One honest edge case: right at the moment of backgrounding,
  there's a brief window (up to the heartbeat staleness threshold) where
  a message could arrive after the local notification stops firing but
  before the bridge considers the device stale — a rare, narrow gap, not
  fully closed in this version.
- **Manager alerts are a distinct notification kind, not a variant of the
  agent one.** The bridge also listens for `agent_transfer` events with
  no `agent_id` — a brand-new, unassigned chat entering the team's
  queue — and pushes "New chat needs an agent" to *every* manager on the
  team at once, immediately, regardless of whether their app is open
  (there's no local/in-app equivalent to defer to yet for this event, the
  way there is for messages). Tapping it opens the Queue tab directly
  rather than a specific transfer, since another manager may have already
  picked it up by the time it's tapped — `NotificationTapAction` in
  `src/notifications.ts` is the discriminated type that tells this apart
  from a chat-opening tap, and `src/navigation/types.ts` types `Main`'s
  params to accept a nested `{ screen: 'QueueTab' }` target for it.

## Setup

You'll need [Expo Go](https://expo.dev/go) installed on your phone — for
Android specifically, make sure the version matches this project's Expo
SDK (Play Store availability can lag a new SDK release by weeks; see
`expo.dev/go?sdkVersion=<version>&platform=android&device=true` for a
direct sideload if the Play Store version errors with "Project is
incompatible").

```bash
cd whatomate-agent-app
npm install
npm start
```

Scan the QR code with Expo Go, then sign in with your normal Whatomate
email/password.

## Configuration

Server URL, contact tag, team name, and the push notification server URL
are all editable from Settings (pre-login) rather than hardcoded — see
`src/config.ts` for the defaults and persistence logic (`getServerUrl()`,
`getContactTag()`, `getTeamName()`, `getPushBridgeUrl()`, each backed by
secure on-device storage).

## Project structure

```
src/
├── api/
│   ├── client.ts     # axios instance, token storage, clean sign-out on expiry
│   ├── auth.ts        # login (Set-Cookie extraction) + logout
│   ├── cookies.ts      # extractCookieValue() helper
│   ├── contacts.ts      # conversation list (tag-filtered)
│   ├── messages.ts       # chat thread — read & send
│   ├── me.ts               # current user + permission check
│   ├── teams.ts             # team list, name→ID resolution, team members
│   ├── transfers.ts          # queue list + assign
│   ├── errors.ts                 # turns any caught error into a real message
│   └── logging.ts                  # logs errors without ever printing credentials
├── context/
│   ├── AuthContext.tsx      # session state
│   └── SocketContext.tsx     # the one shared WebSocket connection
├── hooks/
│   └── useCanManageQueue.ts    # live Transfers:Write permission check
├── ws/
│   ├── decodeJwt.ts           # unverified local JWT decode (for user_id/exp)
│   └── types.ts                 # WS message/payload shapes
├── navigation/
│   ├── types.ts                  # shared param lists (avoids circular imports)
│   ├── index.tsx                  # root stack — Login/Settings vs. Main/Chat/AssignAgent
│   ├── MainTabs.tsx                 # bottom tab bar — Chats / Queue / Profile
│   └── ChatHeaderTitle.tsx            # avatar+name header for the Chat screen
├── screens/
│   ├── LoginScreen.tsx
│   ├── SettingsScreen.tsx
│   ├── ConversationListScreen.tsx
│   ├── ChatScreen.tsx
│   ├── QueueScreen.tsx
│   ├── AssignAgentScreen.tsx
│   └── ProfileScreen.tsx
├── theme.ts                          # shared WhatsApp-style design tokens
├── utils/
│   └── formatTimestamp.ts              # WhatsApp-style relative timestamps
└── config.ts
```

## Troubleshooting

- **"Incorrect email or password"** — exactly what it says; this is a real
  login now, same credentials as the web dashboard.
- **"Could not reach the server"** — check the phone's network can reach
  `whatomate.consyst.biz` and the droplet's firewall allows inbound HTTPS.
- **Blank conversation list** — you only see contacts already *assigned*
  to your account (`assigned_user_id`). An unassigned contact won't show
  up even though it exists.
- **"Could not find a team named..."** (Queue) — the Team Name in Settings
  must match Whatomate's Teams list exactly; ask your manager for the
  exact name if unsure.
- **Empty agent list when assigning** — either the team genuinely has no
  other members, or this account lacks Teams: Read and isn't itself a
  member of the team — both are shown as distinct messages, not a silent
  empty screen.
