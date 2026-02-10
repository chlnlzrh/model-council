/**
 * Database-backed rate limit checker.
 *
 * Runs 4 parallel count queries against usage_logs to check
 * per-minute, per-hour, per-day, and concurrent limits.
 *
 * Stale protection: any "started" row older than 5 minutes is
 * treated as failed and excluded from the concurrent count.
 */

import { db } from "@/lib/db/index";
import { usageLogs } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import {
  DEFAULT_RATE_LIMITS,
  type RateLimits,
  type RateLimitResult,
} from "./config";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function checkRateLimit(
  userId: string,
  limits: RateLimits = DEFAULT_RATE_LIMITS
): Promise<RateLimitResult> {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS);

  const countQuery = (since: Date) =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(usageLogs)
      .where(and(eq(usageLogs.userId, userId), gte(usageLogs.createdAt, since)));

  const concurrentQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.userId, userId),
        eq(usageLogs.status, "started"),
        gte(usageLogs.createdAt, staleThreshold)
      )
    );

  const [minuteResult, hourResult, dayResult, concurrentResult] =
    await Promise.all([
      countQuery(oneMinuteAgo),
      countQuery(oneHourAgo),
      countQuery(oneDayAgo),
      concurrentQuery,
    ]);

  const minuteCount = minuteResult[0]?.count ?? 0;
  const hourCount = hourResult[0]?.count ?? 0;
  const dayCount = dayResult[0]?.count ?? 0;
  const concurrentCount = concurrentResult[0]?.count ?? 0;

  if (concurrentCount >= limits.maxConcurrent) {
    return {
      allowed: false,
      limitType: "maxConcurrent",
      current: concurrentCount,
      limit: limits.maxConcurrent,
      retryAfterSeconds: 10,
    };
  }

  if (minuteCount >= limits.perMinute) {
    return {
      allowed: false,
      limitType: "perMinute",
      current: minuteCount,
      limit: limits.perMinute,
      retryAfterSeconds: 60,
    };
  }

  if (hourCount >= limits.perHour) {
    return {
      allowed: false,
      limitType: "perHour",
      current: hourCount,
      limit: limits.perHour,
      retryAfterSeconds: 300,
    };
  }

  if (dayCount >= limits.perDay) {
    return {
      allowed: false,
      limitType: "perDay",
      current: dayCount,
      limit: limits.perDay,
      retryAfterSeconds: 3600,
    };
  }

  return { allowed: true };
}
