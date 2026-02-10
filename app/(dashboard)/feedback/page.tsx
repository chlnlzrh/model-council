"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import {
  FEEDBACK_TYPES,
  FEEDBACK_STATUS_LABELS,
} from "@/lib/feedback/validation";

interface FeedbackItem {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFeedback = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback");
      if (res.ok) {
        const data = await res.json();
        setItems(data.feedback ?? []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/feedback/${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        toast.success("Feedback deleted");
      } else {
        toast.error("Failed to delete feedback");
      }
    } catch {
      toast.error("Failed to delete feedback");
    }
  };

  const getTypeMeta = (type: string) =>
    FEEDBACK_TYPES.find((t) => t.value === type) ?? FEEDBACK_TYPES[2];

  const getStatusMeta = (status: string) =>
    FEEDBACK_STATUS_LABELS[status] ?? FEEDBACK_STATUS_LABELS.open;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/council">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-sm font-bold">Feedback</h1>
              <p className="text-xs text-muted-foreground">
                Report bugs, request features, or share ideas
              </p>
            </div>
          </div>
          <FeedbackDialog onSuccess={loadFeedback} />
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <MessageCircleQuestion className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-xs font-semibold">No feedback yet</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Found a bug or have an idea? Click &quot;Submit Feedback&quot; to let us know.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Feedback list */}
        {!loading && items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => {
              const typeMeta = getTypeMeta(item.type);
              const statusMeta = getStatusMeta(item.status);
              return (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={typeMeta.variant} className="text-[10px] py-0">
                            {typeMeta.label}
                          </Badge>
                          <Badge variant={statusMeta.variant} className="text-[10px] py-0">
                            {statusMeta.label}
                          </Badge>
                        </div>
                        <p className="text-xs font-medium">{item.title}</p>
                        <p className="text-[10px] text-muted-foreground line-clamp-2">
                          {item.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(item.id)}
                        aria-label={`Delete feedback: ${item.title}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
