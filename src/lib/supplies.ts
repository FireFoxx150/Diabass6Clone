import { Reading, Supply } from "./types";

const noon = (d: string) => new Date(d + "T12:00:00").getTime();
export const addDays = (d: string, n: number) => {
  const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export interface SupplyStatus { level: "ok" | "soon" | "bad"; lines: string[]; alerts: string[]; remaining?: number; daysLeft?: number; expires?: string; }

/** Strips are estimated from a count taken at a point in time minus every test (including control tests) since. */
export function supplyStatus(sp: Supply, readings: Reading[], today: string): SupplyStatus {
  const lines: string[] = [], alerts: string[] = []; let level: SupplyStatus["level"] = "ok";
  const flag = (l: "soon" | "bad", msg: string) => { alerts.push(msg); lines.push(msg); if (l === "bad" || level === "ok") level = l; };
  let remaining: number | undefined, daysLeft: number | undefined;
  if (sp.kind === "strips" && sp.count != null && sp.countedAt) {
    const used = readings.filter((r) => r.ts > sp.countedAt!).length;
    remaining = Math.max(0, sp.count - used);
    const perDay = readings.filter((r) => r.ts.slice(0, 10) >= addDays(today, -14)).length / 14;
    if (perDay > 0) daysLeft = Math.floor(remaining / perDay);
    const txt = `About ${remaining} strips left${daysLeft != null ? ` (roughly ${daysLeft} days at your recent pace)` : ""}`;
    if (remaining === 0) flag("bad", "No strips left by this count");
    else if (remaining <= (sp.lowAt ?? 25) || (daysLeft != null && daysLeft <= 7)) flag("soon", txt);
    else lines.push(txt);
  }
  let exp = sp.expiry;
  if (sp.openedOn && sp.discardDays) { const d = addDays(sp.openedOn, sp.discardDays); if (!exp || d < exp) exp = d; }
  if (exp) {
    const days = Math.round((noon(exp) - noon(today)) / 864e5);
    if (days < 0) flag("bad", `Expired ${-days} day${-days === 1 ? "" : "s"} ago (${exp})`);
    else if (days <= (sp.kind === "control" ? 14 : 30)) flag("soon", `Expires in ${days} day${days === 1 ? "" : "s"} (${exp})`);
    else lines.push(`Expires ${exp}${sp.openedOn && sp.discardDays ? " (counting from when it was opened)" : ""}`);
  }
  if (!lines.length) lines.push("No details recorded");
  return { level, lines, alerts, remaining, daysLeft, expires: exp };
}
