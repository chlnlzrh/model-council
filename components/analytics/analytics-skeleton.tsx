"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Tab bar skeleton */}
      <div className="flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-md" />
        ))}
      </div>

      {/* Summary cards — 6 cards in 3 cols */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-4 w-12" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart placeholders */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-48" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2 w-52" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
