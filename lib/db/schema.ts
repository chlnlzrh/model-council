/**
 * Drizzle ORM schema — 9 tables for Model Council.
 *
 * Auth tables (users, accounts, sessions, verificationTokens) follow
 * the Auth.js Drizzle adapter convention.
 *
 * Application tables: conversations, messages, stage1Responses,
 * stage2Rankings, stage2LabelMap, stage3Synthesis, modelPresets.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Auth.js tables
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ---------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------

export const conversations = pgTable("conversations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New Council"),
  mode: text("mode").notNull().default("council"),
  modelPresetId: text("model_preset_id"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const stage1Responses = pgTable("stage1_responses", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  response: text("response").notNull(),
  responseTimeMs: integer("response_time_ms"),
});

export const stage2Rankings = pgTable("stage2_rankings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  rankingText: text("ranking_text").notNull(),
  parsedRanking: jsonb("parsed_ranking"),
  responseTimeMs: integer("response_time_ms"),
});

export const stage2LabelMap = pgTable(
  "stage2_label_map",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    model: text("model").notNull(),
  },
  (t) => [uniqueIndex("label_map_unique").on(t.messageId, t.label)]
);

export const stage3Synthesis = pgTable("stage3_synthesis", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  response: text("response").notNull(),
  responseTimeMs: integer("response_time_ms"),
});

// ---------------------------------------------------------------------------
// Deliberation Stages — Generic storage for all non-Council modes
// ---------------------------------------------------------------------------

export const deliberationStages = pgTable("deliberation_stages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  stageType: text("stage_type").notNull(),
  stageOrder: integer("stage_order").notNull(),
  model: text("model"),
  role: text("role"),
  content: text("content").notNull(),
  parsedData: jsonb("parsed_data"),
  responseTimeMs: integer("response_time_ms"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Model Presets
// ---------------------------------------------------------------------------

export const modelPresets = pgTable("model_presets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  councilModels: jsonb("council_models").notNull().$type<string[]>(),
  chairmanModel: text("chairman_model").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
