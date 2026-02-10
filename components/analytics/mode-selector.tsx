"use client";

import { MODE_REGISTRY } from "@/lib/council/modes/index";
import type { DeliberationMode, ModeFamily } from "@/lib/council/types";
import { cn } from "@/lib/utils";

interface ModeSelectorProps {
  selected: string | null;
  onSelect: (mode: string) => void;
}

const FAMILY_LABELS: Record<ModeFamily, string> = {
  evaluation: "Evaluation",
  adversarial: "Adversarial",
  sequential: "Sequential",
  role_based: "Role-Based",
  algorithmic: "Algorithmic",
  creative: "Creative",
  verification: "Verification",
};

const FAMILY_ORDER: ModeFamily[] = [
  "evaluation",
  "algorithmic",
  "role_based",
  "sequential",
  "adversarial",
  "creative",
  "verification",
];

export function ModeSelector({ selected, onSelect }: ModeSelectorProps) {
  // Group modes by family
  const grouped = new Map<ModeFamily, Array<{ id: DeliberationMode; name: string }>>();
  for (const [id, def] of Object.entries(MODE_REGISTRY)) {
    const family = def.family;
    if (!grouped.has(family)) grouped.set(family, []);
    grouped.get(family)!.push({ id: id as DeliberationMode, name: def.name });
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
      {FAMILY_ORDER.map((family) => {
        const modes = grouped.get(family);
        if (!modes) return null;
        return (
          <div key={family} className="flex items-center gap-1">
            {family !== FAMILY_ORDER[0] && (
              <div className="h-4 w-px bg-border shrink-0 mx-0.5" />
            )}
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => onSelect(m.id)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors",
                  selected === m.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
