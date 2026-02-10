"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DATE_PRESET_LABELS } from "@/lib/analytics/types";
import type { DatePreset } from "@/lib/analytics/types";

interface DateRangeSelectProps {
  value: DatePreset;
  onChange: (value: DatePreset) => void;
}

const PRESETS = Object.entries(DATE_PRESET_LABELS) as [DatePreset, string][];

export function DateRangeSelect({ value, onChange }: DateRangeSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DatePreset)}>
      <SelectTrigger size="sm" className="text-xs w-[140px]" aria-label="Date range">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRESETS.map(([preset, label]) => (
          <SelectItem key={preset} value={preset} className="text-xs">
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
