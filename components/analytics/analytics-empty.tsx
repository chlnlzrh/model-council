"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AnalyticsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
        <BarChart3 className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-sm font-bold mb-1">No analytics yet</h2>
      <p className="text-xs text-muted-foreground mb-4 max-w-xs">
        Start a council session to see model performance data, win rates, and
        response time comparisons.
      </p>
      <Link href="/council">
        <Button size="sm" className="text-xs h-8">
          Start a Council Session
        </Button>
      </Link>
    </div>
  );
}
