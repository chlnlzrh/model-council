/**
 * Rate limit configuration.
 *
 * Database-backed rate limiting using the existing usage_logs table.
 * Limits are per-user, enforced in the SSE streaming endpoint.
 */

export interface RateLimits {
  /** Max deliberations per minute */
  perMinute: number;
  /** Max deliberations per hour */
  perHour: number;
  /** Max deliberations per day */
  perDay: number;
  /** Max concurrent (in-flight) deliberations */
  maxConcurrent: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limitType?: "perMinute" | "perHour" | "perDay" | "maxConcurrent";
  current?: number;
  limit?: number;
  retryAfterSeconds?: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  perMinute: 3,
  perHour: 20,
  perDay: 100,
  maxConcurrent: 2,
};
