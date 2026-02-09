/**
 * GET /api/conversations/[id]/export — Export conversation as Markdown.
 *
 * Returns a downloadable .md file with the full conversation including
 * all 3 stages for each council turn.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getConversationWithStages } from "@/lib/db/queries";
import { getModelDisplayName } from "@/lib/council/model-colors";

function buildMarkdown(conversation: NonNullable<Awaited<ReturnType<typeof getConversationWithStages>>>): string {
  const lines: string[] = [];

  lines.push(`# ${conversation.title}`);
  lines.push("");
  lines.push(`*Exported from Model Council on ${new Date().toISOString().split("T")[0]}*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of conversation.messages) {
    if (msg.role === "user") {
      lines.push(`## User`);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
    } else if (msg.stages) {
      // Stage 1 — Individual Responses
      const { stage1, stage2, stage3 } = msg.stages;

      if (stage1 && stage1.length > 0) {
        lines.push("### Stage 1: Individual Responses");
        lines.push("");
        for (const r of stage1) {
          lines.push(`#### ${getModelDisplayName(r.model)}`);
          lines.push("");
          lines.push(`> *${r.model}* · ${r.responseTimeMs ? `${(r.responseTimeMs / 1000).toFixed(1)}s` : "N/A"}`);
          lines.push("");
          lines.push(r.response);
          lines.push("");
        }
      }

      // Stage 2 — Rankings
      if (stage2) {
        const { rankings, labelMap } = stage2;

        if (labelMap.length > 0) {
          lines.push("### Stage 2: Peer Rankings");
          lines.push("");
          lines.push("**Label Map:**");
          lines.push("");
          for (const entry of labelMap) {
            lines.push(`- ${entry.label} → ${getModelDisplayName(entry.model)}`);
          }
          lines.push("");
        }

        if (rankings.length > 0) {
          for (const r of rankings) {
            lines.push(`#### Evaluation by ${getModelDisplayName(r.model)}`);
            lines.push("");
            lines.push(r.rankingText);
            lines.push("");
          }
        }
      }

      // Stage 3 — Synthesis
      if (stage3) {
        lines.push("### Stage 3: Chairman Synthesis");
        lines.push("");
        lines.push(`*Chairman: ${getModelDisplayName(stage3.model)}* · ${stage3.responseTimeMs ? `${(stage3.responseTimeMs / 1000).toFixed(1)}s` : "N/A"}`);
        lines.push("");
        lines.push(stage3.response);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await getConversationWithStages(id);

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (conversation.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const markdown = buildMarkdown(conversation);
  const filename = `${conversation.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase()}.md`;

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
