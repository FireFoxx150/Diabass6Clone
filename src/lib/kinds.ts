// The meter stores more than glucose. Records of a kind this app doesn't recognise (ketones, for example) are kept as raw
// "extras" so the user can say what they are, instead of the app guessing.
import type { ExtraRec } from "./api";
import { KetoneReading, KindRule } from "./types";
import { newId } from "./parse";

const h2 = (n: number) => n.toString(16).padStart(2, "0");
export const kindKey = (k2: number, k3: number) => `${h2(k2)} ${h2(k3)}`;
export interface UnknownKind { key: string; count: number; samples: ExtraRec[]; }

export function applyKinds(extras: ExtraRec[], map: Record<string, KindRule> | undefined): { ketones: KetoneReading[]; unknown: UnknownKind[] } {
  const ketones: KetoneReading[] = [], groups = new Map<string, ExtraRec[]>();
  for (const e of extras) {
    const k = kindKey(e.k2, e.k3), rule = map?.[k];
    if (!rule) { (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); continue; }
    if (rule.as === "ketone" && rule.divisor > 0) {
      const mmol = Math.round((e.value / rule.divisor) * 10) / 10;
      if (mmol >= 0 && mmol <= 20) ketones.push({ id: newId(), ts: e.ts, mmol });
    }
  }
  return { ketones, unknown: [...groups.entries()].map(([key, v]) => ({ key, count: v.length, samples: v.slice(0, 6) })).sort((a, b) => b.count - a.count) };
}
