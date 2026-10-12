import { Reading } from "./types";
export interface Stats { n: number; mean: number; sd: number; cv: number; a1c: number; gmi: number; low: number; inr: number; high: number; perDay: number; min: number; max: number; }
export function calcStats(rs: Reading[], lo: number, hi: number): Stats | null {
  const v = rs.filter((r) => r.flag !== "control");
  if (!v.length) return null;
  const n = v.length, mean = v.reduce((a, r) => a + r.mgdl, 0) / n;
  const sd = Math.sqrt(v.reduce((a, r) => a + (r.mgdl - mean) ** 2, 0) / n);
  const lowN = v.filter((r) => r.mgdl < lo).length, highN = v.filter((r) => r.mgdl > hi).length;
  const days = new Set(v.map((r) => r.ts.slice(0, 10))).size || 1;
  return {
    n, mean, sd, cv: (sd / mean) * 100, a1c: (mean + 46.7) / 28.7, gmi: 3.31 + 0.02392 * mean,
    low: (lowN / n) * 100, high: (highN / n) * 100, inr: ((n - lowN - highN) / n) * 100,
    perDay: n / days, min: Math.min(...v.map((r) => r.mgdl)), max: Math.max(...v.map((r) => r.mgdl)),
  };
}
export const localIso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 19);
export const hourOf = (r: { ts: string }) => +r.ts.slice(11, 13) + +r.ts.slice(14, 16) / 60;
export function quantile(a: number[], q: number) {
  if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const p = (s.length - 1) * q; const i = Math.floor(p);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i);
}

/** Ambulatory Glucose Profile points: percentiles of all readings by time of day, over a sliding 2.5-hour window. */
export interface AgpPoint { h: number; p5: number; p25: number; p50: number; p75: number; p95: number; }
export function agpPoints(rs: Reading[]): AgpPoint[] {
  const v = rs.filter((r) => r.flag !== "control");
  const out: AgpPoint[] = [];
  if (v.length < 30) return out;
  for (let h = 0; h <= 24; h += 0.5) {
    const win = v.filter((r) => { const d = Math.abs(hourOf(r) - h); return Math.min(d, 24 - d) <= 1.25; }).map((r) => r.mgdl);
    if (win.length >= 6) out.push({ h, p5: quantile(win, 0.05), p25: quantile(win, 0.25), p50: quantile(win, 0.5), p75: quantile(win, 0.75), p95: quantile(win, 0.95) });
  }
  return out;
}
