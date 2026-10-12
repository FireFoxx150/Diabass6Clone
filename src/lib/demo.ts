import { Reading } from "./types";
import { newId } from "./parse";
export function demoReadings(): Reading[] {
  const out: Reading[] = []; const now = new Date(); let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let d = 59; d >= 0; d--) {
    for (const [h, base] of [[7, 118], [10, 160], [13, 126], [15, 170], [18, 122], [21, 150]] as const) {
      if (rnd() < 0.18) continue;
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, h, Math.floor(rnd() * 50));
      const p = (n: number) => String(n).padStart(2, "0");
      out.push({ id: newId(), ts: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}:00`,
        mgdl: Math.max(48, Math.round(base + (rnd() - 0.45) * 70)), flag: "none" });
    }
  }
  return out;
}
