import { InsulinDose, Reading } from "./types";
import { calcStats } from "./stats";

export interface MonthRow { month: string; n: number; days: number; mean: number; tir: number; low: number; high: number; lows: number; perDay: number; a1c: number; insulinPerDay?: number; }

export function monthlyStats(readings: Reading[], insulin: InsulinDose[], lo: number, hi: number, today: string): MonthRow[] {
  const bg = readings.filter((r) => r.flag !== "control");
  if (!bg.length) return [];
  const first = bg[0].ts.slice(0, 10), by = new Map<string, Reading[]>();
  for (const r of bg) { const m = r.ts.slice(0, 7); (by.get(m) ?? by.set(m, []).get(m)!).push(r); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, rs]) => {
    const st = calcStats(rs, lo, hi)!;
    const [y, m] = month.split("-").map(Number), monthStart = `${month}-01`, monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const from = first > monthStart ? first : monthStart, to = today < monthEnd ? today : monthEnd;
    const span = Math.max(1, Math.round((new Date(to + "T12:00:00").getTime() - new Date(from + "T12:00:00").getTime()) / 864e5) + 1);
    const doses = insulin.filter((d) => d.ts.startsWith(month)), dd = new Set(doses.map((d) => d.ts.slice(0, 10))).size;
    return { month, n: st.n, days: new Set(rs.map((r) => r.ts.slice(0, 10))).size, mean: st.mean, tir: st.inr, low: st.low, high: st.high, lows: rs.filter((r) => r.mgdl < lo).length, perDay: st.n / span, a1c: st.a1c,
      ...(dd ? { insulinPerDay: doses.reduce((a, d) => a + d.units, 0) / dd } : {}) };
  });
}
