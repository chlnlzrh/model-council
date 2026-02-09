"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ModelPicker } from "@/components/settings/model-picker";
import { ChairmanSelect } from "@/components/settings/chairman-select";
import { PresetManager } from "@/components/settings/preset-manager";
import { useDashboard } from "../layout";
import { DEFAULT_COUNCIL_CONFIG } from "@/lib/council/types";
import type { ModelInfo } from "@/app/api/models/route";

interface Preset {
  id: string;
  name: string;
  councilModels: string[];
  chairmanModel: string;
  isDefault: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const { modelConfig, updateModelConfig } = useDashboard();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [presets, setPresets] = useState<Preset[]>([]);

  // Local state synced from dashboard context
  const [councilModels, setCouncilModels] = useState<string[]>(
    modelConfig.councilModels
  );
  const [chairmanModel, setChairmanModel] = useState<string>(
    modelConfig.chairmanModel
  );

  // Sync local state back to dashboard context
  useEffect(() => {
    updateModelConfig({ councilModels, chairmanModel });
  }, [councilModels, chairmanModel, updateModelConfig]);

  // Fetch models from OpenRouter
  useEffect(() => {
    fetch("/api/models")
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((data) => setModels(data.models ?? []))
      .catch(() => toast.error("Failed to load models"))
      .finally(() => setModelsLoading(false));
  }, []);

  // Fetch user presets
  useEffect(() => {
    fetch("/api/presets")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPresets(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Auto-update chairman if removed from council
  useEffect(() => {
    if (
      councilModels.length > 0 &&
      !councilModels.includes(chairmanModel)
    ) {
      setChairmanModel(councilModels[0]);
    }
  }, [councilModels, chairmanModel]);

  const handleLoadPreset = useCallback((preset: Preset) => {
    setCouncilModels(preset.councilModels);
    setChairmanModel(preset.chairmanModel);
    toast.success(`Loaded "${preset.name}"`);
  }, []);

  const handleSavePreset = useCallback(
    async (name: string, isDefault: boolean) => {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          councilModels,
          chairmanModel,
          isDefault,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to save preset");
        return;
      }

      const preset = await res.json();
      setPresets((prev) => [preset, ...prev]);
      toast.success(`Saved "${name}"`);
    },
    [councilModels, chairmanModel]
  );

  const handleDeletePreset = useCallback(async (id: string) => {
    const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });

    if (!res.ok) {
      toast.error("Failed to delete preset");
      return;
    }

    setPresets((prev) => prev.filter((p) => p.id !== id));
    toast.success("Preset deleted");
  }, []);

  const handleResetDefaults = () => {
    setCouncilModels(DEFAULT_COUNCIL_CONFIG.councilModels);
    setChairmanModel(DEFAULT_COUNCIL_CONFIG.chairmanModel);
    toast.success("Reset to defaults");
  };

  const canSave = councilModels.length >= 2 && chairmanModel.length > 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/council">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-sm font-bold">Settings</h1>
            <p className="text-xs text-muted-foreground">
              Configure your council models and presets
            </p>
          </div>
        </div>

        {/* Council Models */}
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-xs font-semibold">Council Models</h2>
            <p className="text-[10px] text-muted-foreground">
              Select the models that will respond to your questions and rank each
              other. Minimum 2 models.
            </p>
          </CardHeader>
          <CardContent>
            <ModelPicker
              models={models}
              selected={councilModels}
              onChange={setCouncilModels}
              loading={modelsLoading}
            />
          </CardContent>
        </Card>

        {/* Chairman Model */}
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-xs font-semibold">Chairman Model</h2>
            <p className="text-[10px] text-muted-foreground">
              The chairman synthesizes the final answer from all responses and
              rankings. Typically one of the council members.
            </p>
          </CardHeader>
          <CardContent>
            <ChairmanSelect
              models={models}
              councilModels={councilModels}
              value={chairmanModel}
              onChange={setChairmanModel}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={handleResetDefaults}
          >
            Reset to Defaults
          </Button>
        </div>

        <Separator />

        {/* Presets */}
        <PresetManager
          presets={presets}
          onLoad={handleLoadPreset}
          onSave={handleSavePreset}
          onDelete={handleDeletePreset}
          canSave={canSave}
        />
      </div>
    </div>
  );
}
