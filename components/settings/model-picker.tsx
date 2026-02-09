"use client";

import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { ModelInfo } from "@/app/api/models/route";

interface ModelPickerProps {
  models: ModelInfo[];
  selected: string[];
  onChange: (selected: string[]) => void;
  loading?: boolean;
}

export function ModelPicker({
  models,
  selected,
  onChange,
  loading,
}: ModelPickerProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [models, search]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const formatPrice = (price: number) => {
    if (price === 0) return "Free";
    if (price < 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(1)}`;
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded bg-muted animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Selected models */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const model = models.find((m) => m.id === id);
            return (
              <Badge
                key={id}
                variant="secondary"
                className="gap-1 text-[11px] pr-1"
              >
                {model?.name ?? id}
                <button
                  onClick={() => toggle(id)}
                  className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 text-xs h-8"
        />
      </div>

      {/* Model list */}
      <ScrollArea className="h-[280px] rounded border border-border">
        <div className="p-1">
          {filtered.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No models found
            </p>
          )}
          {filtered.map((model) => (
            <button
              key={model.id}
              onClick={() => toggle(model.id)}
              className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 hover:bg-muted text-left"
            >
              <Checkbox
                checked={selected.includes(model.id)}
                className="h-3.5 w-3.5"
                tabIndex={-1}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{model.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {model.id}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-muted-foreground">
                  {(model.contextLength / 1000).toFixed(0)}k ctx
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatPrice(model.pricing.promptPer1M)}/M
                </p>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>

      <p className="text-[10px] text-muted-foreground">
        {selected.length} model{selected.length !== 1 ? "s" : ""} selected
        {selected.length < 2 && " (min 2)"}
      </p>
    </div>
  );
}
