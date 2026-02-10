"use client";

import { ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MODE_REGISTRY } from "@/lib/council/modes/index";
import type { DeliberationMode, ModeFamily } from "@/lib/council/types";
import { useState } from "react";

interface ModePickerProps {
  selected: DeliberationMode;
  onSelect: (mode: DeliberationMode) => void;
  disabled?: boolean;
}

const FAMILY_ORDER: ModeFamily[] = [
  "evaluation",
  "role_based",
  "sequential",
  "algorithmic",
  "adversarial",
  "creative",
  "verification",
];

const FAMILY_LABELS: Record<ModeFamily, string> = {
  evaluation: "Evaluation",
  role_based: "Role-Based",
  sequential: "Sequential",
  algorithmic: "Algorithmic",
  adversarial: "Adversarial",
  creative: "Creative",
  verification: "Verification",
};

const FAMILY_COLORS: Record<ModeFamily, string> = {
  evaluation: "bg-blue-500",
  role_based: "bg-purple-500",
  sequential: "bg-amber-500",
  algorithmic: "bg-emerald-500",
  adversarial: "bg-red-500",
  creative: "bg-pink-500",
  verification: "bg-teal-500",
};

export function ModePicker({ selected, onSelect, disabled }: ModePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDef = MODE_REGISTRY[selected];

  const modesByFamily = FAMILY_ORDER.map((family) => ({
    family,
    label: FAMILY_LABELS[family],
    modes: Object.values(MODE_REGISTRY).filter((m) => m.family === family),
  })).filter((g) => g.modes.length > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              FAMILY_COLORS[selectedDef.family]
            )}
          />
          <span className="font-medium">{selectedDef.name}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="space-y-2">
          {modesByFamily.map((group) => (
            <div key={group.family}>
              <div className="flex items-center gap-1.5 px-2 py-1">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    FAMILY_COLORS[group.family]
                  )}
                />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </span>
              </div>
              {group.modes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => {
                    onSelect(mode.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    selected === mode.id
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-foreground hover:bg-accent/50"
                  )}
                  title={mode.description}
                >
                  <span>{mode.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {mode.minModels}-{mode.maxModels}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
