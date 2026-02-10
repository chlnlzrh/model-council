/**
 * Database repository functions.
 *
 * All database access goes through these functions — no raw queries
 * elsewhere in the codebase. Grouped by domain entity.
 */

import { eq, desc, and, asc, gte, sql } from "drizzle-orm";
import { db } from "./index";
import {
  users,
  conversations,
  messages,
  stage1Responses,
  stage2Rankings,
  stage2LabelMap,
  stage3Synthesis,
  modelPresets,
  deliberationStages,
} from "./schema";
import type {
  Stage1Response,
  Stage2Response,
  Stage2Metadata,
  Stage3Response,
  CouncilResult,
  DeliberationMode,
  DeliberationStageData,
} from "@/lib/council/types";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function createUser(data: {
  email: string;
  passwordHash: string;
  name?: string;
}) {
  const [user] = await db
    .insert(users)
    .values({
      email: data.email,
      passwordHash: data.passwordHash,
      name: data.name ?? null,
    })
    .returning();
  return user;
}

export async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user ?? null;
}

export async function getUserById(id: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function createConversation(data: {
  userId: string;
  title?: string;
  mode?: DeliberationMode;
  modelPresetId?: string;
}) {
  const [conv] = await db
    .insert(conversations)
    .values({
      userId: data.userId,
      title: data.title ?? "New Council",
      mode: data.mode ?? "council",
      modelPresetId: data.modelPresetId ?? null,
    })
    .returning();
  return conv;
}

export async function getUserConversations(userId: string) {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      mode: conversations.mode,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
}

export async function getConversationById(id: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return conv ?? null;
}

export async function updateConversationTitle(id: string, title: string) {
  const [conv] = await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return conv ?? null;
}

export async function deleteConversation(id: string) {
  await db.delete(conversations).where(eq(conversations.id, id));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function createMessage(data: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
}) {
  const [msg] = await db.insert(messages).values(data).returning();
  return msg;
}

export async function getMessagesByConversation(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

// ---------------------------------------------------------------------------
// Stage 1 — Individual Responses
// ---------------------------------------------------------------------------

export async function saveStage1Responses(
  messageId: string,
  responses: Stage1Response[]
) {
  if (responses.length === 0) return;
  await db.insert(stage1Responses).values(
    responses.map((r) => ({
      messageId,
      model: r.model,
      response: r.response,
      responseTimeMs: r.responseTimeMs,
    }))
  );
}

export async function getStage1ByMessage(messageId: string) {
  return db
    .select()
    .from(stage1Responses)
    .where(eq(stage1Responses.messageId, messageId));
}

// ---------------------------------------------------------------------------
// Stage 2 — Rankings + Label Map
// ---------------------------------------------------------------------------

export async function saveStage2Rankings(
  messageId: string,
  rankings: Stage2Response[]
) {
  if (rankings.length === 0) return;
  await db.insert(stage2Rankings).values(
    rankings.map((r) => ({
      messageId,
      model: r.model,
      rankingText: r.rankingText,
      parsedRanking: r.parsedRanking,
      responseTimeMs: null,
    }))
  );
}

export async function saveStage2LabelMapEntries(
  messageId: string,
  labelToModel: Record<string, string>
) {
  const entries = Object.entries(labelToModel);
  if (entries.length === 0) return;
  await db.insert(stage2LabelMap).values(
    entries.map(([label, model]) => ({
      messageId,
      label,
      model,
    }))
  );
}

export async function getStage2ByMessage(messageId: string) {
  const [rankings, labelMap] = await Promise.all([
    db
      .select()
      .from(stage2Rankings)
      .where(eq(stage2Rankings.messageId, messageId)),
    db
      .select()
      .from(stage2LabelMap)
      .where(eq(stage2LabelMap.messageId, messageId)),
  ]);
  return { rankings, labelMap };
}

// ---------------------------------------------------------------------------
// Stage 3 — Synthesis
// ---------------------------------------------------------------------------

export async function saveStage3Synthesis(
  messageId: string,
  synthesis: Stage3Response
) {
  await db.insert(stage3Synthesis).values({
    messageId,
    model: synthesis.model,
    response: synthesis.response,
    responseTimeMs: synthesis.responseTimeMs,
  });
}

export async function getStage3ByMessage(messageId: string) {
  const [result] = await db
    .select()
    .from(stage3Synthesis)
    .where(eq(stage3Synthesis.messageId, messageId))
    .limit(1);
  return result ?? null;
}

// ---------------------------------------------------------------------------
// Composite: Save full council result for a message
// ---------------------------------------------------------------------------

export async function saveCouncilResult(
  messageId: string,
  result: CouncilResult
) {
  await Promise.all([
    saveStage1Responses(messageId, result.stage1),
    saveStage2Rankings(messageId, result.stage2),
    saveStage2LabelMapEntries(
      messageId,
      result.stage2Metadata.labelToModel
    ),
    saveStage3Synthesis(messageId, result.stage3),
  ]);
}

// ---------------------------------------------------------------------------
// Full conversation with all stages (for loading a saved conversation)
// ---------------------------------------------------------------------------

export async function getConversationWithStages(conversationId: string) {
  const conv = await getConversationById(conversationId);
  if (!conv) return null;

  const msgs = await getMessagesByConversation(conversationId);

  const messagesWithStages = await Promise.all(
    msgs.map(async (msg) => {
      if (msg.role === "user") {
        return { ...msg, stages: null };
      }

      const [stage1, stage2, stage3] = await Promise.all([
        getStage1ByMessage(msg.id),
        getStage2ByMessage(msg.id),
        getStage3ByMessage(msg.id),
      ]);

      return {
        ...msg,
        stages: { stage1, stage2, stage3 },
      };
    })
  );

  return { ...conv, messages: messagesWithStages };
}

// ---------------------------------------------------------------------------
// Model Presets
// ---------------------------------------------------------------------------

export async function createModelPreset(data: {
  userId: string;
  name: string;
  councilModels: string[];
  chairmanModel: string;
  isDefault?: boolean;
}) {
  // If this preset is default, un-default others
  if (data.isDefault) {
    await db
      .update(modelPresets)
      .set({ isDefault: false })
      .where(
        and(
          eq(modelPresets.userId, data.userId),
          eq(modelPresets.isDefault, true)
        )
      );
  }

  const [preset] = await db
    .insert(modelPresets)
    .values({
      userId: data.userId,
      name: data.name,
      councilModels: data.councilModels,
      chairmanModel: data.chairmanModel,
      isDefault: data.isDefault ?? false,
    })
    .returning();
  return preset;
}

export async function getUserPresets(userId: string) {
  return db
    .select()
    .from(modelPresets)
    .where(eq(modelPresets.userId, userId))
    .orderBy(desc(modelPresets.createdAt));
}

export async function getDefaultPreset(userId: string) {
  const [preset] = await db
    .select()
    .from(modelPresets)
    .where(
      and(
        eq(modelPresets.userId, userId),
        eq(modelPresets.isDefault, true)
      )
    )
    .limit(1);
  return preset ?? null;
}

export async function deleteModelPreset(id: string) {
  await db.delete(modelPresets).where(eq(modelPresets.id, id));
}

// ---------------------------------------------------------------------------
// Analytics — Stage 2 Data (for win rates)
// ---------------------------------------------------------------------------

export async function getStage2DataForUser(
  userId: string,
  fromDate: Date | null
) {
  const rankingsQuery = db
    .select({
      messageId: stage2Rankings.messageId,
      rankerModel: stage2Rankings.model,
      parsedRanking: stage2Rankings.parsedRanking,
    })
    .from(stage2Rankings)
    .innerJoin(messages, eq(stage2Rankings.messageId, messages.id))
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      fromDate
        ? and(eq(conversations.userId, userId), gte(messages.createdAt, fromDate))
        : eq(conversations.userId, userId)
    );

  const labelMapQuery = db
    .select({
      messageId: stage2LabelMap.messageId,
      label: stage2LabelMap.label,
      model: stage2LabelMap.model,
    })
    .from(stage2LabelMap)
    .innerJoin(messages, eq(stage2LabelMap.messageId, messages.id))
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      fromDate
        ? and(eq(conversations.userId, userId), gte(messages.createdAt, fromDate))
        : eq(conversations.userId, userId)
    );

  const [rankings, labelMaps] = await Promise.all([
    rankingsQuery,
    labelMapQuery,
  ]);

  return { rankings, labelMaps };
}

// ---------------------------------------------------------------------------
// Analytics — Stage 1 Times (for response times)
// ---------------------------------------------------------------------------

export async function getStage1TimesForUser(
  userId: string,
  fromDate: Date | null
) {
  return db
    .select({
      model: stage1Responses.model,
      responseTimeMs: stage1Responses.responseTimeMs,
    })
    .from(stage1Responses)
    .innerJoin(messages, eq(stage1Responses.messageId, messages.id))
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      fromDate
        ? and(eq(conversations.userId, userId), gte(messages.createdAt, fromDate))
        : eq(conversations.userId, userId)
    );
}

// ---------------------------------------------------------------------------
// Analytics — Usage Stats
// ---------------------------------------------------------------------------

export async function getUsageStatsForUser(
  userId: string,
  fromDate: Date | null
) {
  const sessionCountQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      fromDate
        ? and(eq(conversations.userId, userId), gte(conversations.createdAt, fromDate))
        : eq(conversations.userId, userId)
    );

  const messageDatesQuery = db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      fromDate
        ? and(
            eq(conversations.userId, userId),
            eq(messages.role, "assistant"),
            gte(messages.createdAt, fromDate)
          )
        : and(eq(conversations.userId, userId), eq(messages.role, "assistant"))
    )
    .orderBy(asc(messages.createdAt));

  const [sessionCountResult, messageDates] = await Promise.all([
    sessionCountQuery,
    messageDatesQuery,
  ]);

  return {
    totalSessions: sessionCountResult[0]?.count ?? 0,
    messageDates,
  };
}

// ---------------------------------------------------------------------------
// Deliberation Stages — Generic storage for all non-Council modes
// ---------------------------------------------------------------------------

export async function saveDeliberationStage(
  messageId: string,
  stage: DeliberationStageData
) {
  const [row] = await db
    .insert(deliberationStages)
    .values({
      messageId,
      stageType: stage.stageType,
      stageOrder: stage.stageOrder,
      model: stage.model,
      role: stage.role,
      content: stage.content,
      parsedData: stage.parsedData,
      responseTimeMs: stage.responseTimeMs,
    })
    .returning();
  return row;
}

export async function saveDeliberationStages(
  messageId: string,
  stages: DeliberationStageData[]
) {
  if (stages.length === 0) return;
  await db.insert(deliberationStages).values(
    stages.map((s) => ({
      messageId,
      stageType: s.stageType,
      stageOrder: s.stageOrder,
      model: s.model,
      role: s.role,
      content: s.content,
      parsedData: s.parsedData,
      responseTimeMs: s.responseTimeMs,
    }))
  );
}

export async function getDeliberationStagesByMessage(messageId: string) {
  return db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(asc(deliberationStages.stageOrder));
}

export async function getConversationMode(conversationId: string) {
  const [conv] = await db
    .select({ mode: conversations.mode })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return (conv?.mode as DeliberationMode) ?? null;
}

// ---------------------------------------------------------------------------
// Analytics — Mode Distribution
// ---------------------------------------------------------------------------

export async function getModeDistributionForUser(
  userId: string,
  fromDate: Date | null
) {
  return db
    .select({
      mode: conversations.mode,
      count: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(
      fromDate
        ? and(eq(conversations.userId, userId), gte(conversations.createdAt, fromDate))
        : eq(conversations.userId, userId)
    )
    .groupBy(conversations.mode);
}

// ---------------------------------------------------------------------------
// Analytics — Deliberation Stages (for mode-specific metrics)
// ---------------------------------------------------------------------------

export async function getDeliberationStagesForAnalytics(
  userId: string,
  fromDate: Date | null,
  mode?: string
) {
  const baseConditions = fromDate
    ? and(eq(conversations.userId, userId), gte(messages.createdAt, fromDate))
    : eq(conversations.userId, userId);

  const conditions = mode
    ? and(baseConditions, eq(conversations.mode, mode))
    : baseConditions;

  return db
    .select({
      messageId: deliberationStages.messageId,
      stageType: deliberationStages.stageType,
      stageOrder: deliberationStages.stageOrder,
      model: deliberationStages.model,
      role: deliberationStages.role,
      parsedData: deliberationStages.parsedData,
      responseTimeMs: deliberationStages.responseTimeMs,
      mode: conversations.mode,
    })
    .from(deliberationStages)
    .innerJoin(messages, eq(deliberationStages.messageId, messages.id))
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(conditions);
}

// ---------------------------------------------------------------------------
// Analytics — Deliberation Response Times (non-council modes)
// ---------------------------------------------------------------------------

export async function getDeliberationResponseTimesForUser(
  userId: string,
  fromDate: Date | null
) {
  return db
    .select({
      model: deliberationStages.model,
      responseTimeMs: deliberationStages.responseTimeMs,
      mode: conversations.mode,
    })
    .from(deliberationStages)
    .innerJoin(messages, eq(deliberationStages.messageId, messages.id))
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      fromDate
        ? and(eq(conversations.userId, userId), gte(messages.createdAt, fromDate))
        : eq(conversations.userId, userId)
    );
}
