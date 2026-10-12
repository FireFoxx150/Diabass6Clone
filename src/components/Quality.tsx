import { useMemo, useState } from "react";
import { Reading, Settings, fmt, unitLabel } from "../lib/types";
import { checkQuality } from "../lib/quality";

const BULK = new Set(["future", "old", "implausible", "near"]);   // safe to delete as a group; conflicts are not (deleting both would lose data)

export default function QualityView({ readings, s, commit }: { readings: Reading[]; s: Settings; commit: (r: Reading[], m?: string) => void }) {
  const issues = useMemo(() => checkQuality(readings, Date.now(), s.clockWarnings), [readings, s.clockWarnings]);
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(readings.map((r) => [r.id, r])), [readings]);
  const warn = issues.filter((i) => i.level === "warn").length;
  return (<>
    <section className="panel">
      <h2>{issues.length === 0 ? "No problems found" : `${issues.length} thing${issues.length === 1 ? "" : "s"} to look at`}</h2>
      <p className="note" style={{ margin: 0 }}>{issues.length === 0 ? "Dates, values and test frequency all look sensible." : `${warn} need attention and ${issues.length - warn} are just worth knowing. Nothing is changed unless you delete it here.`} {readings.length} readings checked.</p>
    </section>
    {issues.map((i) => {
      const items = i.readingIds.map((id) => byId.get(id)).filter(Boolean) as Reading[];
      return (
        <div key={i.id} className={"card " + (i.level === "warn" ? "soon" : "")}>
          <div style={{ flex: 1 }}>
            <div><span className={"pill " + (i.level === "warn" ? "watch" : "info")}>{i.level === "warn" ? "Needs attention" : "Note"}</span> <b>{i.title}</b></div>
            {i.detail && <div className="note" style={{ marginTop: 4 }}>{i.detail}</div>}
            {open === i.id && items.length > 0 && <table style={{ marginTop: 10 }}><tbody>
              {items.slice(0, 25).map((r) => <tr key={r.id}><td>{r.ts.slice(0, 16).replace("T", "  ")}</td><td className="val">{fmt(r.mgdl, s.unit)} {unitLabel(s.unit)}</td><td className="r"><button className="btn sm danger" onClick={() => commit(readings.filter((x) => x.id !== r.id), "Reading deleted")}>Delete</button></td></tr>)}
              {items.length > 25 && <tr><td colSpan={3} className="note">…and {items.length - 25} more</td></tr>}
            </tbody></table>}
          </div>
          {items.length > 0 && <div className="row">
            <button className="btn sm" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "Hide" : `Show ${items.length}`}</button>
            {BULK.has(i.id) && <button className="btn sm danger" onClick={() => window.confirm(`Delete these ${items.length} readings? You can undo until you close the app.`) && commit(readings.filter((x) => !i.readingIds.includes(x.id)), `${items.length} readings deleted`)}>Delete all {items.length}</button>}
          </div>}
        </div>
      );
    })}
  </>);
}
