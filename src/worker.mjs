// Cloudflare Worker: serves the one static page from ./dist (the ASSETS binding) and answers /mcp and /api/*.
// Only the MCP routes (/mcp and /mcp/<tool>) use the MCP_LIMITER Durable Object; only they and /api/relay reach a RELAY object. It logs nothing,
// keeps nothing and reads no request body except the MCP routes' own capped one: the page itself accepts GET and HEAD only.
import { clientOf, durableLimiter, memoryLimiter } from "./limiter.mjs";
import { handleMcp } from "./mcp.mjs";
import { RELAY_CLOSE, RELAY_PROTOCOL, RELAY_TOKEN_PREFIX } from "./protocol.mjs";
import { checkToken, newToken, relayName, TOKEN_RE } from "./token.mjs";

export { McpLimiter } from "./limiter.mjs";
export { Relay } from "./relay.mjs";

// Per-instance guards for the page's own calls (in memory, keyed by client as limiter.mjs groups it, never stored).
// The page asks for a token when the host presses Copy connect message or Connect with MCP, and reconnects its relay
// with backoff (1, 2, 4 … 30 s), so a host never comes near these; a script that mints tokens or opens relays does.
const tokenGuard = memoryLimiter(10);
const relayGuard = memoryLimiter(20);

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const reply = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...noStore, ...extra } });
const foreign = (request, url) => {
  const origin = request.headers.get("Origin");
  return origin && origin !== url.origin;
};
async function limited(guard, request) {
  const verdict = await guard.limit({ key: clientOf(request) });
  return verdict.success ? null : reply({ error: "Too many requests" }, 429, { "Retry-After": "60" });
}

// A socket that is closed at once, so the page hears why (RELAY_CLOSE.ended makes it forget the token). No relay object is touched.
function closedSocket(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": RELAY_PROTOCOL } });
}

async function relayStub(env, token) {
  return env.RELAY.get(env.RELAY.idFromName(await relayName(token)));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    // /mcp is the MCP server; /mcp/<tool> is its short route for an agent that runs curl (card 186).
    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      const tool = pathname === "/mcp" || pathname === "/mcp/" ? undefined : pathname.slice("/mcp/".length);
      const stubs = new Map();
      const relayFor = (token) => ({
        async op(message) {
          if (!stubs.has(token)) stubs.set(token, await relayStub(env, token));
          return stubs.get(token).op(message);
        },
      });
      return handleMcp(request, { limiter: env.MCP_LIMITER && durableLimiter(env.MCP_LIMITER), relayFor, tool });
    }
    if (pathname === "/api/agent-token") {
      // A new agent token with the Worker's own time inside (see token.mjs). It touches no relay object.
      if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, { Allow: "POST" });
      if (foreign(request, url)) return reply({ error: "Forbidden" }, 403);
      const refused = await limited(tokenGuard, request);
      if (refused) return refused;
      const { token, born } = newToken();
      return reply({ token, createdAt: born });
    }
    if (pathname === "/api/relay") {
      if (request.headers.get("Upgrade") !== "websocket") return reply({ error: "Expected a WebSocket" }, 426);
      if (foreign(request, url)) return reply({ error: "Forbidden" }, 403);
      const refused = await limited(relayGuard, request);
      if (refused) return refused;
      // The token travels as a subprotocol, never in the address: relayProtocols(token) of protocol.mjs.
      const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((p) => p.trim());
      const token = protocols.find((p) => p.startsWith(RELAY_TOKEN_PREFIX))?.slice(RELAY_TOKEN_PREFIX.length) ?? "";
      if (!protocols.includes(RELAY_PROTOCOL) || !TOKEN_RE.test(token)) return reply({ error: "Unauthorized" }, 401);
      // Past its time (or from the future): refused here, before any relay object is touched.
      const t = checkToken(token);
      if (!t.ok) return closedSocket(RELAY_CLOSE.ended, t.reason);
      const stub = await relayStub(env, token);
      return stub.fetch("https://relay/tab", { headers: { Upgrade: "websocket", "X-Token-Born": String(t.born) } });
    }
    if (pathname.startsWith("/api/")) return reply({ error: "Not found" }, 404);
    // The page: GET and HEAD only, refused before anything is read.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  },
};
