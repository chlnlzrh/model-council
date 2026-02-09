"use client";

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_COUNCIL_CONFIG } from "@/lib/council/types";

const STORAGE_KEY = "model-council-config";

interface ModelConfig {
  councilModels: string[];
  chairmanModel: string;
}

const DEFAULT: ModelConfig = {
  councilModels: DEFAULT_COUNCIL_CONFIG.councilModels,
  chairmanModel: DEFAULT_COUNCIL_CONFIG.chairmanModel,
};

export function useModelConfig() {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ModelConfig;
        if (parsed.councilModels?.length >= 2 && parsed.chairmanModel) {
          setConfig(parsed);
        }
      }
    } catch {
      // Use defaults
    }
  }, []);

  const updateConfig = useCallback((update: Partial<ModelConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...update };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full or unavailable
      }
      return next;
    });
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  return { config, updateConfig, resetConfig };
}
