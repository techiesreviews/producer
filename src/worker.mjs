// Cloudflare Worker: serves the one static page from ./dist (the ASSETS binding). It logs nothing, keeps nothing and
// never reads a request body: anything but GET or HEAD is refused before it reaches the page.
export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  },
};
