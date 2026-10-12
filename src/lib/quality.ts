import { Reading } from "./types";
import { localIso } from "./stats";

export interface QualityIssue { id: string; level: "warn" | "info"; title: string; detail: string; readingIds: string[]; }
const ms = (ts: string) => new Date(ts).getTime();

/** Things that make the data less trustworthy. Nothing here changes data; the screen offers deletes one at a time. */
export function checkQuality(all: Reading[], nowMs: number, clockWarnings: string[] = []): QualityIssue[] {
  const out: QualityIssue[] = [], rs = all.filter((r) => r.flag !== "control");
  const ids = (xs: Reading[]) => xs.map((r) => r.id);
  const future = rs.filter((r) => ms(r.ts) > nowMs + 10 * 60e3);
  if (future.length) out.push({ id: "future", level: "warn", title: `${future.length} reading${future.length === 1 ? " is" : "s are"} dated in the future`, detail: "The meter clock was probably ahead when these were taken. Check the clock on the Meter tab.", readingIds: ids(future) });
  const old = rs.filter((r) => r.ts < "2015-01-01");
  if (old.length) out.push({ id: "old", level: "warn", title: `${old.length} reading${old.length === 1 ? " is" : "s are"} dated before 2015`, detail: "Usually a meter clock that was reset to its factory date.", readingIds: ids(old) });
  const odd = rs.filter((r) => r.mgdl < 20 || r.mgdl > 600);
  if (odd.length) out.push({ id: "implausible", level: "warn", title: `${odd.length} implausible value${odd.length === 1 ? "" : "s"} (below 20 or above 600 mg/dL)`, detail: "Check these against the meter; they may be error readings or typing slips.", readingIds: ids(odd) });

  const byMinute = new Map<string, Reading[]>();
  for (const r of rs) { const k = r.ts.slice(0, 16); (byMinute.get(k) ?? byMinute.set(k, []).get(k)!).push(r); }
  const conflicts = [...byMinute.values()].filter((g) => g.length > 1 && new Set(g.map((r) => Math.round(r.mgdl))).size > 1).flat();
  if (conflicts.length) out.push({ id: "conflict", level: "info", title: `${conflicts.length} readings share a minute but disagree`, detail: "Possibly a quick re-test or a double entry.", readingIds: ids(conflicts) });
  const near: Reading[] = [];
  for (let i = 1; i < rs.length; i++) if (rs[i].ts.slice(0, 16) !== rs[i - 1].ts.slice(0, 16) && Math.round(rs[i].mgdl) === Math.round(rs[i - 1].mgdl) && ms(rs[i].ts) - ms(rs[i - 1].ts) <= 3 * 60e3) near.push(rs[i]);
  if (near.length) out.push({ id: "near", level: "info", title: `${near.length} possible duplicate${near.length === 1 ? "" : "s"} (same value within 3 minutes)`, detail: "Often the same test stored twice, for example after a clock change.", readingIds: ids(near) });

  const recent = rs.filter((r) => r.ts >= localIso(nowMs - 30 * 864e5)), have = new Set(recent.map((r) => r.ts.slice(0, 10)));
  if (rs.length) {
    const missing: string[] = [];
    for (let i = 0; i < 30; i++) { const k = localIso(nowMs - i * 864e5).slice(0, 10); if (!have.has(k)) missing.push(k); }
    if (missing.length >= 8) out.push({ id: "gaps", level: "info", title: `No readings on ${missing.length} of the last 30 days`, detail: "Gaps make averages less reliable. If the meter holds readings you haven't downloaded, download them.", readingIds: [] });
    const perDay = rs.filter((r) => r.ts >= localIso(nowMs - 14 * 864e5)).length / 14;
    if (perDay > 0 && perDay < 2) out.push({ id: "lowfreq", level: "info", title: `About ${perDay.toFixed(1)} tests a day over the last 14 days`, detail: "Fewer than two tests a day gives a thin picture of the day.", readingIds: [] });
    const days = [...new Set(rs.filter((r) => r.ts >= localIso(nowMs - 90 * 864e5)).map((r) => r.ts.slice(0, 10)))].sort();
    let longest = 0; for (let i = 1; i < days.length; i++) longest = Math.max(longest, Math.round((new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()) / 864e5) - 1);
    if (longest >= 7) out.push({ id: "longgap", level: "info", title: `Longest stretch with no readings (last 90 days): ${longest} days`, detail: "", readingIds: [] });
  }
  if (clockWarnings.length) out.push({ id: "clock", level: "warn", title: "The meter's records are out of date order", detail: `The last download found timestamps that jump around, which usually means the clock was changed or reset. ${clockWarnings.slice(0, 3).join("; ")}`, readingIds: [] });
  return out;
}
