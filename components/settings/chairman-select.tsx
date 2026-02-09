"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelInfo } from "@/app/api/models/route";

interface ChairmanSelectProps {
  models: ModelInfo[];
  councilModels: string[];
  value: string;
  onChange: (value: string) => void;
}

export function ChairmanSelect({
  models,
  councilModels,
  value,
  onChange,
}: ChairmanSelectProps) {
  // Chairman can be any model, but highlight council members
  const councilOptions = models.filter((m) => councilModels.includes(m.id));
  const otherOptions = models.filter((m) => !councilModels.includes(m.id));

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="text-xs h-8">
        <SelectValue placeholder="Select chairman model" />
      </SelectTrigger>
      <SelectContent>
        {councilOptions.length > 0 && (
          <>
            <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
              Council Members
            </p>
            {councilOptions.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </>
        )}
        {otherOptions.length > 0 && (
          <>
            <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground mt-1">
              Other Models
            </p>
            {otherOptions.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}
