"use client";

import { Card, CardContent } from "@/components/ui/card";

export function GenericMetrics() {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-1">Mode Metrics</h3>
        <p className="text-[10px] text-muted-foreground">
          Detailed metrics for this mode are shown in the response times and session count above.
        </p>
      </CardContent>
    </Card>
  );
}
