"use client";

import { useState, useEffect, useCallback } from "react";

export interface UsageData {
  usedThisHour: number;
  usedToday: number;
  usedAllTime: number;
  limits: {
    perHour: number;
    perDay: number;
  };
}

export function useUsage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch {
      // Silently fail — badge just won't update
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { usage, loading, refresh };
}
