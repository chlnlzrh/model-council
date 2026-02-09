/**
 * Route protection middleware.
 *
 * Protects all dashboard routes (council, settings, analytics).
 * Redirects unauthenticated users to /login.
 * API routes return 401 instead of redirecting.
 */

import { auth } from "@/lib/auth/config";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isApi = req.nextUrl.pathname.startsWith("/api/");

  if (!req.auth) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/council/:path*",
    "/settings/:path*",
    "/analytics/:path*",
    "/api/conversations/:path*",
    "/api/council/:path*",
    "/api/models/:path*",
    "/api/presets/:path*",
  ],
};
