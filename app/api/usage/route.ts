/**
 * GET /api/usage — Returns the authenticated user's usage summary.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getUserUsageSummary } from "@/lib/db/queries";
import { DEFAULT_RATE_LIMITS } from "@/lib/rate-limit/config";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const usage = await getUserUsageSummary(session.user.id);

  return NextResponse.json({
    ...usage,
    limits: {
      perHour: DEFAULT_RATE_LIMITS.perHour,
      perDay: DEFAULT_RATE_LIMITS.perDay,
    },
  });
}
