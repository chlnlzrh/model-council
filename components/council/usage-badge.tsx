"use client";

import { Zap } from "lucide-react";
import { useUsage } from "@/hooks/use-usage";
import { cn } from "@/lib/utils";

export function UsageBadge() {
  const { usage, loading } = useUsage();

  if (loading || !usage) return null;

  const remaining = usage.limits.perDay - usage.usedToday;
  const ratio = usage.usedToday / usage.limits.perDay;

  const color =
    ratio >= 0.9
      ? "text-destructive"
      : ratio >= 0.7
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-emerald-600 dark:text-emerald-400";

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[10px] font-medium", color)}
      title={`${remaining} of ${usage.limits.perDay} deliberations remaining today`}
    >
      <Zap className="h-3 w-3" />
      {remaining}/{usage.limits.perDay}
    </span>
  );
}
