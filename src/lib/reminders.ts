import { Reminders } from "./types";

export interface Due { id: string; title: string; body: string; }
export interface FiredState { date: string; ids: string[]; }
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** What should be notified right now. Pure: the caller records the ids as fired. */
export function dueReminders(now: Date, r: Reminders | undefined, fired: FiredState | undefined, ctx: { staleDays: number; supplyAlerts: string[] }): Due[] {
  if (!r?.enabled) return [];
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10), done = new Set(fired?.date === today ? fired.ids : []);
  const nowMin = now.getHours() * 60 + now.getMinutes(), out: Due[] = [];
  for (const t of r.times) { const id = "test-" + t; if (!done.has(id) && nowMin >= mins(t) && nowMin - mins(t) <= 30) out.push({ id, title: "Time for a glucose test", body: `Your ${t} reminder.` }); }
  if (r.stale && ctx.staleDays >= 7 && nowMin >= 600 && !done.has("stale")) out.push({ id: "stale", title: "Download your meter", body: `You haven't downloaded readings for ${ctx.staleDays} days.` });
  if (r.strips && ctx.supplyAlerts.length && nowMin >= 540 && !done.has("supplies")) out.push({ id: "supplies", title: "Supplies need attention", body: ctx.supplyAlerts.slice(0, 3).join(". ") });
  return out;
}
export function markFired(now: Date, fired: FiredState | undefined, ids: string[]): FiredState {
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { date: today, ids: [...new Set([...(fired?.date === today ? fired.ids : []), ...ids])] };
}
