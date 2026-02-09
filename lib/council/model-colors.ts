/**
 * Consistent model identity colors used across all UI stages.
 *
 * Each model gets an assigned color based on its index in the council.
 * Colors persist across Stage 1, Stage 2, and the aggregate rankings.
 */

const MODEL_COLORS = [
  { bg: "bg-blue-100 dark:bg-blue-950", text: "text-blue-700 dark:text-blue-300", border: "border-blue-300 dark:border-blue-700", dot: "bg-blue-500", bar: "bg-blue-500" },
  { bg: "bg-emerald-100 dark:bg-emerald-950", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-700", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  { bg: "bg-orange-100 dark:bg-orange-950", text: "text-orange-700 dark:text-orange-300", border: "border-orange-300 dark:border-orange-700", dot: "bg-orange-500", bar: "bg-orange-500" },
  { bg: "bg-purple-100 dark:bg-purple-950", text: "text-purple-700 dark:text-purple-300", border: "border-purple-300 dark:border-purple-700", dot: "bg-purple-500", bar: "bg-purple-500" },
  { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300", border: "border-gray-300 dark:border-gray-600", dot: "bg-gray-500", bar: "bg-gray-500" },
] as const;

export type ModelColorSet = (typeof MODEL_COLORS)[number];

export function getModelColor(index: number): ModelColorSet {
  return MODEL_COLORS[index % MODEL_COLORS.length];
}

/**
 * Get a short display name from a full model identifier.
 * e.g. "anthropic/claude-opus-4-6" → "Claude Opus 4.6"
 */
export function getModelDisplayName(modelId: string): string {
  const name = modelId.split("/").pop() ?? modelId;
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\d) (\d)/g, "$1.$2"); // "4 6" → "4.6"
}

/**
 * Rank position colors (1st=green, 2nd=blue, 3rd=orange, 4th+=gray).
 */
const RANK_COLORS = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-orange-500",
  "bg-gray-400",
] as const;

export function getRankColor(position: number): string {
  return RANK_COLORS[Math.min(position - 1, RANK_COLORS.length - 1)];
}
