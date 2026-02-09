/**
 * GET  /api/conversations — List user's conversations
 * POST /api/conversations — Create a new conversation
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getUserConversations, createConversation } from "@/lib/db/queries";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await getUserConversations(session.user.id);
  return NextResponse.json(conversations);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : undefined;

  const conversation = await createConversation({
    userId: session.user.id,
    title,
  });

  return NextResponse.json(conversation, { status: 201 });
}
