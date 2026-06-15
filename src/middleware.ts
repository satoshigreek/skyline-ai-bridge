import { NextResponse } from "next/server";

// CORS for /api/* so the static GitHub Pages site (satoshigreek.github.io) can
// reach this app's backend cross-origin for Rail C. The API exposes no secrets
// (server-side keys never leave) and is rate-limited, so an open allowlist is
// acceptable. Preflight (OPTIONS) is answered here.

export const config = { matcher: "/api/:path*" };

const ALLOW_HEADERS = "Content-Type, Authorization";
const ALLOW_METHODS = "GET, POST, OPTIONS";

export function middleware(req: Request) {
  const origin = req.headers.get("origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Access-Control-Allow-Headers": ALLOW_HEADERS,
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  const res = NextResponse.next();
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin");
  return res;
}
