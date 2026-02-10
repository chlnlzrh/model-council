/**
 * Feedback validation schema and display metadata.
 */

import { z } from "zod";

export const FEEDBACK_TYPES = [
  { value: "bug" as const, label: "Bug Report", variant: "destructive" as const },
  { value: "feature" as const, label: "Feature Request", variant: "default" as const },
  { value: "other" as const, label: "Other", variant: "secondary" as const },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number]["value"];

export const FEEDBACK_STATUS_LABELS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  open: { label: "Open", variant: "outline" },
  acknowledged: { label: "Acknowledged", variant: "secondary" },
  in_progress: { label: "In Progress", variant: "default" },
  resolved: { label: "Resolved", variant: "default" },
  closed: { label: "Closed", variant: "secondary" },
};

export const FeedbackSchema = z.object({
  type: z.enum(["bug", "feature", "other"]),
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(200, "Title must be at most 200 characters"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(5000, "Description must be at most 5,000 characters"),
  context: z.string().max(500).optional(),
});

export type FeedbackInput = z.infer<typeof FeedbackSchema>;
