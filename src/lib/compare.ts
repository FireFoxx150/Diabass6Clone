import { MMOL, Settings, fmt } from "./types";
import { Stats } from "./stats";

export interface CmpRow { k: string; cur: string; prev: string; change: string; tone: "ok" | "bad" | "flat"; }

/** Rows comparing this period with the previous one. Colour only where a direction is clearly better or worse. */
export function compareRows(cur: Stats, prev: Stats, s: Settings): CmpRow[] {
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "\u2212" : "\u00b1");
  const unitDelta = (mg: number) => (s.unit === "mgdl" ? String(Math.round(Math.abs(mg))) : (Math.abs(mg) / MMOL).toFixed(1));
  const pts = (n: number) => `${sign(n)}${Math.abs(n).toFixed(0)} pts`;
  const defs: { k: string; cur: string; prev: string; d: number; txt: string; better: 1 | -1 | 0; eps: number }[] = [
    { k: "Average", cur: fmt(cur.mean, s.unit), prev: fmt(prev.mean, s.unit), d: cur.mean - prev.mean, txt: `${sign(cur.mean - prev.mean)}${unitDelta(cur.mean - prev.mean)}`, better: 0, eps: 2 },
    { k: "Time in range", cur: cur.inr.toFixed(0) + "%", prev: prev.inr.toFixed(0) + "%", d: cur.inr - prev.inr, txt: pts(cur.inr - prev.inr), better: 1, eps: 1 },
    { k: "Below range", cur: cur.low.toFixed(0) + "%", prev: prev.low.toFixed(0) + "%", d: cur.low - prev.low, txt: pts(cur.low - prev.low), better: -1, eps: 1 },
    { k: "Above range", cur: cur.high.toFixed(0) + "%", prev: prev.high.toFixed(0) + "%", d: cur.high - prev.high, txt: pts(cur.high - prev.high), better: -1, eps: 1 },
    { k: "Variability (CV)", cur: cur.cv.toFixed(0) + "%", prev: prev.cv.toFixed(0) + "%", d: cur.cv - prev.cv, txt: pts(cur.cv - prev.cv), better: -1, eps: 1 },
    { k: "Estimated A1c", cur: cur.a1c.toFixed(1) + "%", prev: prev.a1c.toFixed(1) + "%", d: cur.a1c - prev.a1c, txt: `${sign(cur.a1c - prev.a1c)}${Math.abs(cur.a1c - prev.a1c).toFixed(1)}`, better: 0, eps: 0.1 },
    { k: "Tests per day", cur: cur.perDay.toFixed(1), prev: prev.perDay.toFixed(1), d: cur.perDay - prev.perDay, txt: `${sign(cur.perDay - prev.perDay)}${Math.abs(cur.perDay - prev.perDay).toFixed(1)}`, better: 0, eps: 0.2 },
  ];
  return defs.map((r) => {
    const flat = Math.abs(r.d) < r.eps;
    return { k: r.k, cur: r.cur, prev: r.prev, change: flat ? "no change" : r.txt, tone: flat || !r.better ? "flat" : r.d * r.better > 0 ? "ok" : "bad" };
  });
}
