/**
 * Hex color palette for Recharts bar charts.
 *
 * Selected for color-blindness accessibility — distinguishable
 * under deuteranopia and protanopia simulations.
 */

const CHART_COLORS = [
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ef4444", // red-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
  "#84cc16", // lime-500
] as const;

export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

export { CHART_COLORS };
