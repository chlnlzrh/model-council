"use client";

import { useState } from "react";
import { Save, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getModelDisplayName } from "@/lib/council/model-colors";

interface Preset {
  id: string;
  name: string;
  councilModels: string[];
  chairmanModel: string;
  isDefault: boolean;
  createdAt: string;
}

interface PresetManagerProps {
  presets: Preset[];
  onLoad: (preset: Preset) => void;
  onSave: (name: string, isDefault: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canSave: boolean;
}

export function PresetManager({
  presets,
  onLoad,
  onSave,
  onDelete,
  canSave,
}: PresetManagerProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSave = async () => {
    if (!presetName.trim()) return;
    setSaving(true);
    await onSave(presetName.trim(), false);
    setSaving(false);
    setPresetName("");
    setSaveOpen(false);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">Saved Presets</h3>
        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              disabled={!canSave}
            >
              <Save className="h-3 w-3" />
              Save Current
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Save Preset</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <Input
                placeholder="Preset name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="text-xs h-8"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                autoFocus
              />
              <Button
                onClick={handleSave}
                disabled={!presetName.trim() || saving}
                className="w-full text-xs h-8"
              >
                {saving ? "Saving..." : "Save Preset"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {presets.length === 0 && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No saved presets yet
        </p>
      )}

      <div className="space-y-2">
        {presets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-start gap-2 rounded-lg border border-border p-2.5 hover:bg-muted/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium truncate">{preset.name}</p>
                {preset.isDefault && (
                  <Badge
                    variant="secondary"
                    className="text-[9px] px-1 py-0 h-4"
                  >
                    Default
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {preset.councilModels.length} models · Chairman:{" "}
                {getModelDisplayName(preset.chairmanModel)}
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {preset.councilModels.slice(0, 4).map((m) => (
                  <Badge
                    key={m}
                    variant="outline"
                    className="text-[9px] px-1 py-0 h-4"
                  >
                    {getModelDisplayName(m)}
                  </Badge>
                ))}
                {preset.councilModels.length > 4 && (
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1 py-0 h-4"
                  >
                    +{preset.councilModels.length - 4}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => onLoad(preset)}
                title="Load preset"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={() => handleDelete(preset.id)}
                disabled={deletingId === preset.id}
                title="Delete preset"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
