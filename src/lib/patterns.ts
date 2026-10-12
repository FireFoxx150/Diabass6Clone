import { InsulinDose, Reading, Settings, fmt, unitLabel } from "./types";
import { hourOf } from "./stats";

export interface Pattern { level: "watch" | "info"; title: string; detail: string; }
const BLOCKS: [number, number][] = [[0, 3], [3, 6], [6, 9], [9, 12], [12, 15], [15, 18], [18, 21], [21, 24]];
const hh = (h: number) => String(h % 24).padStart(2, "0") + ":00";
const ms = (ts: string) => new Date(ts).getTime();

/** Descriptive observations only: what happened and when. Never suggests treatment changes. */
export function findPatterns(all: Reading[], doses: InsulinDose[], s: Settings): Pattern[] {
  const bg = all.filter((r) => r.flag !== "control");
  if (bg.length < 14) return [];
  const u = unitLabel(s.unit), out: Pattern[] = [];

  // Low and high clusters by 3-hour block
  const lows: { a: number; b: number; d: number; of: number }[] = [], highs: { a: number; b: number; n: number; of: number }[] = [];
  for (const [a, b] of BLOCKS) {
    const inB = bg.filter((r) => { const h = hourOf(r); return h >= a && h < b; });
    const dayWith = new Set(inB.map((r) => r.ts.slice(0, 10)));
    const dayLow = new Set(inB.filter((r) => r.mgdl < s.low).map((r) => r.ts.slice(0, 10)));
    if (dayLow.size >= 3 && dayLow.size / dayWith.size >= 0.25) lows.push({ a, b, d: dayLow.size, of: dayWith.size });
    const hi = inB.filter((r) => r.mgdl > s.high).length;
    if (inB.length >= 8 && hi / inB.length >= 0.5) highs.push({ a, b, n: hi, of: inB.length });
  }
  lows.sort((x, y) => y.d / y.of - x.d / x.of).slice(0, 2).forEach((l) => out.push({ level: "watch", title: `Low readings cluster between ${hh(l.a)} and ${hh(l.b)}`, detail: `Below ${fmt(s.low, s.unit)} ${u} on ${l.d} of ${l.of} days that had a reading in that period.` }));
  highs.sort((x, y) => y.n / y.of - x.n / x.of).slice(0, 2).forEach((h) => out.push({ level: "info", title: `Often above range between ${hh(h.a)} and ${hh(h.b)}`, detail: `${h.n} of ${h.of} readings (${Math.round((h.n / h.of) * 100)}%) were above ${fmt(s.high, s.unit)} ${u}.` }));

  // Severe lows
  const severe = bg.filter((r) => r.mgdl < 54);
  if (severe.length) { const last = severe[severe.length - 1]; out.unshift({ level: "watch", title: `${severe.length} reading${severe.length === 1 ? "" : "s"} below ${fmt(54, s.unit)} ${u}`, detail: `Most recent: ${last.ts.slice(0, 16).replace("T", " ")} at ${fmt(last.mgdl, s.unit)} ${u}.` }); }

  // Lows shortly after an insulin dose
  const lowR = bg.filter((r) => r.mgdl < s.low);
  if (lowR.length >= 3 && doses.length) {
    const after = lowR.filter((r) => doses.some((d) => ms(d.ts) <= ms(r.ts) && ms(r.ts) - ms(d.ts) <= 4 * 3600e3)).length;
    if (after / lowR.length >= 0.5) out.push({ level: "watch", title: `${after} of ${lowR.length} low readings came within 4 hours of an insulin dose`, detail: "Worth discussing the timing with your clinician." });
  }

  // Weekday vs weekend
  const wd = bg.filter((r) => { const g = new Date(r.ts).getDay(); return g >= 1 && g <= 5; }), we = bg.filter((r) => { const g = new Date(r.ts).getDay(); return g === 0 || g === 6; });
  if (wd.length >= 10 && we.length >= 10) {
    const m = (a: Reading[]) => a.reduce((x, r) => x + r.mgdl, 0) / a.length, dm = m(we) - m(wd);
    if (Math.abs(dm) >= 20) out.push({ level: "info", title: `Weekends average ${fmt(m(we), s.unit)} vs ${fmt(m(wd), s.unit)} ${u} on weekdays`, detail: `${dm > 0 ? "Higher" : "Lower"} at weekends, based on ${we.length} weekend and ${wd.length} weekday readings.` });
  }

  // Variability
  const mean = bg.reduce((a, r) => a + r.mgdl, 0) / bg.length, sd = Math.sqrt(bg.reduce((a, r) => a + (r.mgdl - mean) ** 2, 0) / bg.length), cv = (sd / mean) * 100;
  if (cv > 36) out.push({ level: "info", title: `Glucose varies a lot (CV ${cv.toFixed(0)}%)`, detail: "A CV above about 36% is commonly used as the point where variability is considered high." });

  // Testing gaps in the last 14 days
  const have = new Set(bg.map((r) => r.ts.slice(0, 10))); let miss = 0;
  for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() - i); const k = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); if (!have.has(k)) miss++; }
  if (miss >= 5) out.push({ level: "info", title: `No readings on ${miss} of the last 14 days`, detail: "Gaps make the averages less reliable. If the meter holds readings you haven't downloaded, download them." });

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "watch" ? -1 : 1)).slice(0, 6);
}
