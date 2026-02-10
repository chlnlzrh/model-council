/**
 * Client-side hook for fetching analytics data.
 *
 * Manages loading, error, and data state. Refetches when preset changes.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { AnalyticsData, DatePreset } from "@/lib/analytics/types";

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
