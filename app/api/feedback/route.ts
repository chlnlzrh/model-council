/**
 * GET /api/feedback — List the authenticated user's feedback submissions.
 * POST /api/feedback — Submit new feedback.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { createFeedback, getUserFeedback } from "@/lib/db/queries";
import { FeedbackSchema } from "@/lib/feedback/validation";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await getUserFeedback(session.user.id);
  return NextResponse.json({ feedback: items });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = FeedbackSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const item = await createFeedback({
    userId: session.user.id,
    ...parsed.data,
  });

  return NextResponse.json({ feedback: item }, { status: 201 });
}
