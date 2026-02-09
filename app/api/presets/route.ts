/**
 * GET  /api/presets — List user's model presets
 * POST /api/presets — Create a new preset
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { getUserPresets, createModelPreset } from "@/lib/db/queries";

const CreatePresetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  councilModels: z.array(z.string()).min(2, "Select at least 2 models"),
  chairmanModel: z.string().min(1, "Chairman model is required"),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const presets = await getUserPresets(session.user.id);
  return NextResponse.json(presets);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreatePresetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const preset = await createModelPreset({
    userId: session.user.id,
    ...parsed.data,
  });

  return NextResponse.json(preset, { status: 201 });
}
