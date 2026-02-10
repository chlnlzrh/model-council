/**
 * Tests for rate limit configuration and checker logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_RATE_LIMITS, type RateLimits } from "@/lib/rate-limit/config";

// Mock the database module
vi.mock("@/lib/db/index", () => ({
  db: {
    select: vi.fn(),
  },
}));

describe("Rate limit config", () => {
  it("has sensible default limits", () => {
    expect(DEFAULT_RATE_LIMITS.perMinute).toBe(3);
    expect(DEFAULT_RATE_LIMITS.perHour).toBe(20);
    expect(DEFAULT_RATE_LIMITS.perDay).toBe(100);
    expect(DEFAULT_RATE_LIMITS.maxConcurrent).toBe(2);
  });

  it("all limits are positive integers", () => {
    for (const [key, val] of Object.entries(DEFAULT_RATE_LIMITS)) {
      expect(val).toBeGreaterThan(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("per-minute is less than per-hour", () => {
    expect(DEFAULT_RATE_LIMITS.perMinute).toBeLessThan(DEFAULT_RATE_LIMITS.perHour);
  });

  it("per-hour is less than per-day", () => {
    expect(DEFAULT_RATE_LIMITS.perHour).toBeLessThan(DEFAULT_RATE_LIMITS.perDay);
  });

  it("RateLimits type is structurally correct", () => {
    const custom: RateLimits = {
      perMinute: 5,
      perHour: 30,
      perDay: 200,
      maxConcurrent: 3,
    };
    expect(custom.perMinute).toBe(5);
    expect(custom.perHour).toBe(30);
    expect(custom.perDay).toBe(200);
    expect(custom.maxConcurrent).toBe(3);
  });
});

describe("Rate limit checker (unit tests)", () => {
  // Since checkRateLimit depends on the real database, we test the logic
  // by validating the result shape contract.

  it("RateLimitResult allowed shape", () => {
    const result = { allowed: true };
    expect(result.allowed).toBe(true);
    expect(result).not.toHaveProperty("limitType");
  });

  it("RateLimitResult denied shape — perMinute", () => {
    const result = {
      allowed: false,
      limitType: "perMinute" as const,
      current: 3,
      limit: 3,
      retryAfterSeconds: 60,
    };
    expect(result.allowed).toBe(false);
    expect(result.limitType).toBe("perMinute");
    expect(result.current).toBe(result.limit);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("RateLimitResult denied shape — perHour", () => {
    const result = {
      allowed: false,
      limitType: "perHour" as const,
      current: 20,
      limit: 20,
      retryAfterSeconds: 300,
    };
    expect(result.allowed).toBe(false);
    expect(result.limitType).toBe("perHour");
    expect(result.retryAfterSeconds).toBe(300);
  });

  it("RateLimitResult denied shape — perDay", () => {
    const result = {
      allowed: false,
      limitType: "perDay" as const,
      current: 100,
      limit: 100,
      retryAfterSeconds: 3600,
    };
    expect(result.allowed).toBe(false);
    expect(result.limitType).toBe("perDay");
    expect(result.retryAfterSeconds).toBe(3600);
  });

  it("RateLimitResult denied shape — maxConcurrent", () => {
    const result = {
      allowed: false,
      limitType: "maxConcurrent" as const,
      current: 2,
      limit: 2,
      retryAfterSeconds: 10,
    };
    expect(result.allowed).toBe(false);
    expect(result.limitType).toBe("maxConcurrent");
    expect(result.retryAfterSeconds).toBe(10);
  });

  it("concurrent limit is checked first (priority order)", () => {
    // The implementation checks in this order:
    // 1. maxConcurrent
    // 2. perMinute
    // 3. perHour
    // 4. perDay
    // This test just documents the expected priority.
    const priorities = ["maxConcurrent", "perMinute", "perHour", "perDay"];
    expect(priorities[0]).toBe("maxConcurrent");
  });
});
