interface Env {
  ASSETS: Fetcher;
}

function withSecurityHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", "camera=(self), microphone=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  if (pathname === "/" || pathname === "/index.html" || pathname === "/sw.js") {
    headers.set("Cache-Control", "no-cache");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let response = await env.ASSETS.fetch(request);

    if (response.status === 404 && request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
      response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }

    return withSecurityHeaders(response, url.pathname);
  },
};

export default worker;
