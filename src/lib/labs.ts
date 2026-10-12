import { Reading } from "./types";
import { localIso } from "./stats";

/** Estimated A1c from the 90 days of meter readings before a lab date. Needs enough data to mean anything. */
export function meterEstimate(readings: Reading[], date: string): { a1c: number; n: number } | null {
  const startD = new Date(date + "T00:00:00"); startD.setDate(startD.getDate() - 90);
  const start = localIso(startD.getTime()), end = date + "T23:59:59";
  const v = readings.filter((r) => r.flag !== "control" && r.ts >= start && r.ts <= end);
  if (v.length < 30 || new Set(v.map((r) => r.ts.slice(0, 10))).size < 20) return null;
  const mean = v.reduce((a, r) => a + r.mgdl, 0) / v.length;
  return { a1c: (mean + 46.7) / 28.7, n: v.length };
}
