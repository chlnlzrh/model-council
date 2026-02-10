/**
 * Tests for feedback validation schema and display metadata.
 */

import { describe, it, expect } from "vitest";
import {
  FeedbackSchema,
  FEEDBACK_TYPES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackInput,
  type FeedbackType,
} from "@/lib/feedback/validation";

describe("FeedbackSchema", () => {
  it("accepts valid bug report", () => {
    const input: FeedbackInput = {
      type: "bug",
      title: "Something is broken",
      description: "When I click the button, nothing happens. Expected it to submit.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts valid feature request", () => {
    const input: FeedbackInput = {
      type: "feature",
      title: "Add dark mode toggle",
      description: "It would be great to have a dark mode toggle on the settings page.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts valid other feedback", () => {
    const input: FeedbackInput = {
      type: "other",
      title: "Just a thought",
      description: "I really enjoy using this product, keep up the good work!",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts optional context", () => {
    const input = {
      type: "bug",
      title: "Error on page",
      description: "There is an error on the council page when I start a deliberation.",
      context: "/council/abc123",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context).toBe("/council/abc123");
    }
  });

  it("rejects invalid type", () => {
    const input = {
      type: "invalid",
      title: "Some title",
      description: "Some description that is long enough.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects title shorter than 3 chars", () => {
    const input = {
      type: "bug",
      title: "AB",
      description: "Some description that is long enough.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      expect(errors.title).toBeDefined();
      expect(errors.title![0]).toContain("3");
    }
  });

  it("rejects title longer than 200 chars", () => {
    const input = {
      type: "bug",
      title: "A".repeat(201),
      description: "Some description that is long enough.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects description shorter than 10 chars", () => {
    const input = {
      type: "bug",
      title: "Valid title",
      description: "Too short",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      expect(errors.description).toBeDefined();
      expect(errors.description![0]).toContain("10");
    }
  });

  it("rejects description longer than 5000 chars", () => {
    const input = {
      type: "bug",
      title: "Valid title",
      description: "A".repeat(5001),
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing type", () => {
    const input = {
      title: "Valid title",
      description: "Some description that is long enough.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const input = {
      type: "bug",
      description: "Some description that is long enough.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const input = {
      type: "bug",
      title: "Valid title",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects context longer than 500 chars", () => {
    const input = {
      type: "bug",
      title: "Valid title",
      description: "Some description that is long enough.",
      context: "A".repeat(501),
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts description at exactly 10 chars", () => {
    const input = {
      type: "bug",
      title: "Valid title",
      description: "1234567890",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts title at exactly 3 chars", () => {
    const input = {
      type: "bug",
      title: "ABC",
      description: "Some description that is long enough.",
    };
    const result = FeedbackSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("FEEDBACK_TYPES", () => {
  it("has 3 types", () => {
    expect(FEEDBACK_TYPES).toHaveLength(3);
  });

  it("includes bug, feature, other", () => {
    const values = FEEDBACK_TYPES.map((t) => t.value);
    expect(values).toContain("bug");
    expect(values).toContain("feature");
    expect(values).toContain("other");
  });

  it("each type has label and variant", () => {
    for (const t of FEEDBACK_TYPES) {
      expect(t.label).toBeTruthy();
      expect(t.variant).toBeTruthy();
    }
  });

  it("bug type has destructive variant", () => {
    const bug = FEEDBACK_TYPES.find((t) => t.value === "bug");
    expect(bug?.variant).toBe("destructive");
  });
});

describe("FEEDBACK_STATUS_LABELS", () => {
  it("has entries for all 5 statuses", () => {
    const statuses = ["open", "acknowledged", "in_progress", "resolved", "closed"];
    for (const s of statuses) {
      expect(FEEDBACK_STATUS_LABELS[s]).toBeDefined();
      expect(FEEDBACK_STATUS_LABELS[s].label).toBeTruthy();
      expect(FEEDBACK_STATUS_LABELS[s].variant).toBeTruthy();
    }
  });

  it("open has outline variant", () => {
    expect(FEEDBACK_STATUS_LABELS.open.variant).toBe("outline");
  });
});
