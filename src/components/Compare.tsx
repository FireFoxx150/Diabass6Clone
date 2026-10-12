import { Settings } from "../lib/types";
import { Stats } from "../lib/stats";
import { compareRows } from "../lib/compare";

export function CompareTable({ cur, prev, s, curLabel, prevLabel }: { cur: Stats | null; prev: Stats | null; s: Settings; curLabel: string; prevLabel: string }) {
  if (!cur) return <div className="empty">No readings in this period.</div>;
  if (!prev) return <div className="empty">No readings in the previous period to compare with.</div>;
  const color = { ok: "var(--ok)", bad: "var(--high)", flat: "var(--muted)" } as const;
  return (
    <table><thead><tr><th>Measure</th><th className="r">{curLabel}</th><th className="r">{prevLabel}</th><th className="r">Change</th></tr></thead><tbody>
      {compareRows(cur, prev, s).map((r) => <tr key={r.k}><td>{r.k}</td><td className="r val">{r.cur}</td><td className="r">{r.prev}</td><td className="r" style={{ color: color[r.tone], fontWeight: 600 }}>{r.change}</td></tr>)}
    </tbody></table>
  );
}
