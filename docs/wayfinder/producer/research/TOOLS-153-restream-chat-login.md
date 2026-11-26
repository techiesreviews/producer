# TOOLS-153: Restream chat login and the small Worker piece

Researched 2026-11-09. Plain-English note for Lex; technical names are in brackets where the fleet needs them. Nothing was signed in to, no app was created, no secret was read or stored. Two harmless test requests were sent to Restream's public web addresses to check browser access rules (see section 6).

## 1. Answer and recommended design

Restream lets anyone with an account register an app themselves (no review step, plan requirement or fee is written anywhere in the docs). Reading a host's live chat needs the host to log in to Restream once and say yes to the app. The login is the standard "authorization code" kind and it needs a **secret** that must never sit in the browser. Restream says so itself, and the test in section 6 shows Restream's token address is not set up to be called from a web page. So the producer tool needs one small piece on its Cloudflare Worker: two tiny endpoints that swap a login code for a token, and refresh the token later, using the secret stored in Cloudflare. After that, the page talks to Restream's chat directly from the browser (a WebSocket) with the token, and the Worker is not involved any more.

Recommended design:

- One Restream developer app, owned by Lex, with only the chat-reading permission (`chat.read`). Optionally `profile.read` to show "connected as ...".
- Each visitor logs in with their own Restream account (public tool, everyone brings their own setup). Their tokens live only in their own browser.
- Worker holds one secret (the app's Client Secret) and has two endpoints: swap code for token, and refresh token. Optional third: sign-out (revoke).
- Page opens the chat WebSocket, filters to normal text messages, and shows likely questions on the private screen.
- Streams not sent through Restream have no chat feed in version 1 (matches the map: "Restream streams only").

## 2. Steps for Lex to register the Restream app

Do these after the core tool works (the map says so). Never paste the secret in chat, a card, a comment or the repo.

1. Make sure you are logged in at restream.io with the account you stream from. The only requirement the docs state is "a Restream account" (https://developers.restream.io/guide/getting-started).
2. Open https://developers.restream.io/apps and click **Create New**.
3. Fill in **Display name** and **Avatar**. Every visitor sees these on the Restream permission screen, so use the tool's public name (for example "Techies Producer") and a clean logo.
4. Add a **Redirect URI** under "Redirect URI's" (button "Add another" for more). Use the exact address the tool will use: `https://producer.techies.tools/auth/restream/callback`. The fleet confirms the exact path in the build card and tells you if it changes. Restream sends the visitor back to this address after they say yes. (Whether other forms such as http://localhost are accepted for testing is UNVERIFIED; ask the fleet before adding one.)
5. Under **Scopes**, tick only the chat-reading permission (`chat.read`). Tick `profile.read` only if the fleet asks for the "connected as" label. Do not tick anything else. (The exact checkbox wording on the page is UNVERIFIED; the scope names in the docs are `chat.read`, `profile.read`, `stream.read`, `channels.read` and others.)
6. On the app settings page, copy the **Client ID** (public, fine to share with the fleet and put in the repo's settings) and **Client Secret** (click the masked field to reveal, then copy).
7. Put the Client Secret straight into Cloudflare: Cloudflare dashboard, Workers & Pages, the producer Worker, Settings, Variables and Secrets, add a **Secret** with the name the fleet gives you (suggested: `RESTREAM_CLIENT_SECRET`). Save it as type "Secret", not plain text. Do not paste it anywhere else. (Cloudflare menu names from general knowledge; not re-checked in this research.)
8. Tell the fleet "app registered" and give them the Client ID only. The fleet sets it as a plain Worker setting.
9. If the secret ever leaks: on the app page click **Regenerate**, then update the Cloudflare secret. The app (and everyone's refreshing) stops working until you do.
10. Test with a second Restream account (a friend or a throwaway) to prove a visitor who does not own the app can connect. See risks.

## 3. Login and chat flow

```
Visitor clicks "Connect Restream chat"
  page: makes random "state", keeps it in this tab's session storage
  page -> browser goes to https://api.restream.io/login?response_type=code
          &client_id=ID&redirect_uri=CALLBACK&state=STATE
Restream: shows login (if needed) and "allow this app to read chat?"
  -> sends the browser back to CALLBACK?code=CODE&scope=...&state=STATE
        (if the visitor says no: back to CALLBACK with nothing)
page (callback): checks state matches. If not, stop.
  page -> Worker  POST /api/restream/token   { code }
  Worker -> Restream POST https://api.restream.io/oauth/token
            (grant_type=authorization_code, code, redirect_uri,
             Client ID + SECRET sent as Basic auth)
  Restream -> Worker: access token (1 hour) + refresh token (1 year)
  Worker -> page: the two tokens and their expiry times (never the secret)
page: keeps tokens in this browser only
page -> wss://chat.api.restream.io/ws?accessToken=ACCESS   (direct, no Worker)
Restream -> page: "connection_info" per channel, a heartbeat about every 45 s,
                  then "event" messages as viewers write
page: shows text messages that look like questions on the private screen
~50 minutes later: page -> Worker POST /api/restream/refresh { refresh_token }
  Worker -> Restream (same token address, grant_type=refresh_token + secret)
  page: stores the NEW pair (old pair is dead), reconnects the WebSocket
Sign out: page -> Worker POST /api/restream/revoke { token }; page wipes its storage
```

## 4. What the Worker holds and does

Holds (Cloudflare settings, never in the repo or the page):

- `RESTREAM_CLIENT_SECRET` (a Cloudflare **secret**).
- Client ID (public, plain setting) and the fixed redirect address.

Does (nothing else, no storage, no database, no logs of bodies):

1. `POST /api/restream/token`: receives `{ code }`, adds the redirect address, ID and secret, calls Restream's token address, returns the token JSON. Docs recommend sending ID and secret as a Basic auth header, not in the address.
2. `POST /api/restream/refresh`: receives `{ refresh_token }`, same call with `grant_type=refresh_token`, returns the new pair. Required by Restream's own docs: devices "should make a request to a proxy endpoint provided by the client web application".
3. Optional `POST /api/restream/revoke`: forwards sign-out to `https://api.restream.io/oauth/revoke` (docs list only `token` as a parameter, so the secret may not be needed; ask Restream or just route through the Worker for safety. UNVERIFIED).
4. Safeguards the fleet should add: only answer requests from the producer page's own origin, never print tokens or the secret in logs, simple rate limit, return Restream's error as-is.

What the browser receives: access token, refresh token, expiry times, granted scopes. Never the secret.

## 5. What happens without Restream

- **Stream not sent through Restream** (for example straight to YouTube, or the Wave.video stream with the guest): no chat feed. Restream's chat only collects chat from channels it streams to; every help page found assumes you go live through Restream (https://support.restream.io/en/articles/9288891-how-to-use-restream-chat-with-encoders). The page should grey out the chat panel with a tooltip ("Chat needs a Restream stream") and offer manual question entry. Other chat sources are in "Not yet specified" on the map.
- **Restream stream, nothing live yet:** the WebSocket should still connect, but the channels report problems instead of messages: `event_not_started` (no stream through Restream yet), `youtube_livechat_ended` / `youtube_broadcast_completed` (broadcast over), `facebook_event_not_live`, `restream_channel_connection_expired` (the host must reconnect the channel in Restream), `channel_added_manually` (Restream cannot read it). The page should show these in plain words. (Whether the socket stays open for a host with no live event is UNVERIFIED; the docs describe the error reasons but not that case outright.)
- **Not logged in / denied / token dead:** show "Connect Restream chat". If the visitor denies, Restream returns them with no parameters.
- **Connection drops:** if nothing arrives for 60 seconds, reconnect (docs rule); on reconnect, past messages can be fetched from the event chat history endpoint (`chat.read`).

## 6. Risks and UNVERIFIED

Verified from docs (section 7) or by test:

- Flow is authorization code with a client secret. The docs describe no PKCE, no implicit flow, no browser-only option (their "Capture" page mentions none). Whether Restream would accept PKCE or a login without a secret is UNVERIFIED and not relied on.
- Token address is not callable from a web page: on 2026-11-09 a test request from a pretend origin of `https://producer.techies.tools` got no cross-origin allowance headers back, neither for the check request (OPTIONS) nor for the real request (POST). Browsers would block it. This agrees with the docs' warning, so the Worker piece is required, not optional.
- Chat WebSocket from a browser page: the official sample is browser JavaScript using `new WebSocket('wss://chat.api.restream.io/ws?accessToken=...')`. Browsers do not apply the same cross-origin rule to WebSockets. I could not run a real browser connection (no token), so "works from producer.techies.tools" is UNVERIFIED until the first test, and also whether the server restricts by origin.
- Restream's normal REST address (`api.restream.io/v2/...`) answered a browser check request with an allowance for the producer origin, so reading things like the profile or chat history straight from the page looks fine (checked once, profile route only; other routes UNVERIFIED).
- Token life: access token 1 hour, refresh token 1 year. A refresh gives a new pair and kills the old one. Tokens in the browser: refresh token is long-lived, so the page should offer "Disconnect" (revoke and wipe).
- Two open tabs can race: if both refresh, one tab's new pair kills the other's. Use one tab, or lock between tabs (Web Locks / BroadcastChannel); the fleet decides.
- The WebSocket address carries the token in the web address (docs sample). Restream-side logs may see it; our Worker never does since the page connects directly. Never copy that address into logs, analytics or the repo.
- Public tool, each visitor with their own account: the docs say users see the app's name and avatar when they authorize it, so the design intends outside users. No approval, review, listing or "only the owner" rule appears in the developer docs or in the terms of service (https://restream.io/terms-of-service, section 7.1 allows software that interfaces with the Services). **Whether Restream quietly limits a new app to its owner's account is UNVERIFIED**; the second-account test (step 10) answers it. Terms section 13.5.4 asks app makers to disclose their data practices, so the tool's privacy text (TOOLS-152) should say: Restream tokens kept in your browser only, chat text not saved by our server.
- No plan or paid-account requirement is written anywhere in the docs; whether the free Restream plan can create apps or use the chat socket is UNVERIFIED. No rate limits are documented (the only limits mentioned are the platforms' own reply limits). No separate API terms were found. Contact for questions: developers@restream.io.
- Everyone's tokens come from Lex's one app. If the secret leaks or is regenerated, all visitors must log in again. Regenerating also breaks refresh until Cloudflare is updated.
- Scope for the chat WebSocket is not named on the chat page. `chat.read` is the only chat scope in the docs (chat URL, chat history, chat download) so it is the best match, but exact need is UNVERIFIED until the first real connection.
- Message details the page can rely on: each WebSocket item is an `event` action with `eventPayload.text`, an author object, `eventSourceId` (the platform: 2 Twitch, 13 YouTube, 19/20 Facebook, 25 Discord, 26 LinkedIn, 28 X, 29 Kick, 33 Rumble, among others) and a `timestamp` in seconds. Author field names differ per platform (`displayName` on YouTube, Twitch and Rumble; `name` on Facebook, LinkedIn and Trovo; `username` on Kick). The X text event (type 24) has no documented fields, so its text field is UNVERIFIED. Docs say new fields and types can appear, so the page must ignore unknowns. Super Chats and memberships are separate types; version 1 can show them or skip them (decide in the screen design card).
- Facebook personal profile, LinkedIn, X and Rumble are read-only sources (fine for this tool, which only reads).
- The Claude-connected Restream tools in this workspace belong to a different (MCP) login and say nothing about this web app flow; not used here.

## 7. Source links

- Restream API index: https://developers.restream.io/llms.txt
- Getting started (create app, fields): https://developers.restream.io/guide/getting-started
- Chat WebSocket: https://developers.restream.io/chat/getting-started
- Chat event sources (platform ids): https://developers.restream.io/chat/event-sources
- Chat events (types and fields): https://developers.restream.io/chat/events
- Chat actions (connection_info, heartbeat, envelope, timestamp): https://developers.restream.io/chat/actions
- Chat connections (error reasons, no-stream cases): https://developers.restream.io/chat/connections
- OAuth overview: https://developers.restream.io/authentication/overview
- Authorize dialog: https://developers.restream.io/authentication/authorize-dialog
- Capture the code: https://developers.restream.io/authentication/capture-the-code
- Code exchange (secret, 1 hour and 1 year): https://developers.restream.io/authentication/code-exchange
- Refreshing tokens (proxy warning, rotation): https://developers.restream.io/authentication/refreshing-tokens
- Revoking tokens: https://developers.restream.io/authentication/revoking-tokens
- Event chat history (`chat.read`): https://developers.restream.io/events/event-chat-history
- Chat URL (`chat.read`): https://developers.restream.io/private-api/chat-url
- Restream terms of service: https://restream.io/terms-of-service
- Help: chat with encoders: https://support.restream.io/en/articles/9288891-how-to-use-restream-chat-with-encoders
- Help: embed chat in streaming software: https://support.restream.io/en/articles/2524916-embed-chat-on-your-streaming-software
- Cloudflare Worker secrets (not re-checked): https://developers.cloudflare.com/workers/configuration/secrets/
- Restream API contact: developers@restream.io; ideas: https://ideas.restream.io/api-requests
