/**
 * DELETE /api/presets/[id] — Delete a model preset
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { deleteModelPreset } from "@/lib/db/queries";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await deleteModelPreset(id);
  return NextResponse.json({ ok: true });
}
