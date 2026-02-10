/**
 * Client-side hooks for fetching analytics data.
 *
 * - useAnalytics()           — legacy (backward compat)
 * - useOverviewAnalytics()   — extended overview with mode distribution
 * - useModeAnalytics()       — per-mode deep dive
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  AnalyticsData,
  ExtendedAnalyticsData,
  ModeAnalyticsData,
  DatePreset,
} from "@/lib/analytics/types";

// ---------------------------------------------------------------------------
// Legacy hook (backward compat)
// ---------------------------------------------------------------------------

interface UseAnalyticsReturn {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  preset: DatePreset;
  setPreset: (preset: DatePreset) => void;
  retry: () => void;
}

export function useAnalytics(): UseAnalyticsReturn {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<DatePreset>("30d");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/analytics?preset=${preset}`);
      if (!res.ok) {
        throw new Error(res.status === 401 ? "Unauthorized" : "Failed to load analytics");
      }
      const json: AnalyticsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, preset, setPreset, retry: fetchData };
}

// ---------------------------------------------------------------------------
// Overview hook (extended data)
// ---------------------------------------------------------------------------

interface UseOverviewAnalyticsReturn {
  data: ExtendedAnalyticsData | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useOverviewAnalytics(preset: DatePreset): UseOverviewAnalyticsReturn {
  const [data, setData] = useState<ExtendedAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/analytics?preset=${preset}&view=overview`);
      if (!res.ok) {
        throw new Error(res.status === 401 ? "Unauthorized" : "Failed to load analytics");
      }
      const json: ExtendedAnalyticsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, retry: fetchData };
}

// ---------------------------------------------------------------------------
// Mode-specific hook
// ---------------------------------------------------------------------------

interface UseModeAnalyticsReturn {
  data: ModeAnalyticsData | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useModeAnalytics(
  preset: DatePreset,
  mode: string | null
): UseModeAnalyticsReturn {
  const [data, setData] = useState<ModeAnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!mode) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/analytics?preset=${preset}&view=mode&mode=${mode}`
      );
      if (!res.ok) {
        throw new Error(res.status === 401 ? "Unauthorized" : "Failed to load mode analytics");
      }
      const json: ModeAnalyticsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mode analytics");
    } finally {
      setLoading(false);
    }
  }, [preset, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, retry: fetchData };
}
