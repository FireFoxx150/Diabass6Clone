import { Goals, Reading } from "./types";
import { localIso } from "./stats";

export interface GoalRow { key: "tests" | "tir" | "lows"; label: string; actual: string; target: string; ok: boolean; pct: number; }

/** Progress over the last `days` days (default 14). Only goals the user has set are shown. */
export function goalRows(readings: Reading[], goals: Goals | undefined, lo: number, hi: number, nowMs: number, days = 14): GoalRow[] {
  if (!goals) return [];
  const cut = localIso(nowMs - days * 864e5), rs = readings.filter((r) => r.flag !== "control" && r.ts >= cut), out: GoalRow[] = [];
  if (goals.testsPerDay) { const a = rs.length / days; out.push({ key: "tests", label: "Tests per day", actual: a.toFixed(1), target: `at least ${goals.testsPerDay}`, ok: a >= goals.testsPerDay, pct: Math.min(100, (a / goals.testsPerDay) * 100) }); }
  if (goals.tir && rs.length) { const t = (rs.filter((r) => r.mgdl >= lo && r.mgdl <= hi).length / rs.length) * 100; out.push({ key: "tir", label: "Time in range", actual: `${t.toFixed(0)}%`, target: `at least ${goals.tir}%`, ok: t >= goals.tir, pct: Math.min(100, (t / goals.tir) * 100) }); }
  if (goals.maxLows !== undefined) { const n = rs.filter((r) => r.mgdl < lo).length; out.push({ key: "lows", label: "Readings below range", actual: String(n), target: `${goals.maxLows} or fewer`, ok: n <= goals.maxLows, pct: n <= goals.maxLows ? 100 : Math.max(0, (goals.maxLows / n) * 100) }); }
  return out;
}
