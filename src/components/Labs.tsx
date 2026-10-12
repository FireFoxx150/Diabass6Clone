import { useState } from "react";
import { LabA1c, Reading, Settings, ifccOf, ngspOf } from "../lib/types";
import { newId } from "../lib/parse";
import { localIso } from "../lib/stats";
import { meterEstimate } from "../lib/labs";
import { LabChart } from "./Charts";

export default function LabsView({ labs, readings, commitL, say }: { labs: LabA1c[]; readings: Reading[]; s: Settings; commitL: (l: LabA1c[], m?: string) => void; say: (m: string) => void }) {
  const [date, setDate] = useState(localIso(Date.now()).slice(0, 10)); const [val, setVal] = useState(""); const [unit, setUnit] = useState<"pct" | "mmol">("pct"); const [note, setNote] = useState("");
  const add = () => {
    const v = parseFloat(val.replace(",", ".")); if (!isFinite(v) || !date) { say("Enter the date and the result."); return; }
    const ngsp = unit === "pct" ? v : ngspOf(v);
    if (ngsp < 3 || ngsp > 20) { say(unit === "pct" ? "HbA1c should be between about 3 and 20 %." : "HbA1c should be between about 10 and 190 mmol/mol."); return; }
    commitL([...labs, { id: newId(), date, ngsp: Math.round(ngsp * 100) / 100, note: note.trim() || undefined }].sort((a, b) => a.date.localeCompare(b.date)), "Lab result added"); setVal(""); setNote("");
  };
  const rows = [...labs].reverse();
  return (<>
    <section className="panel">
      <h2>Lab HbA1c vs your meter</h2>
      <LabChart labs={labs} readings={readings} />
      <p className="note">The estimate uses the average of your meter readings in the 90 days before each lab date (needs at least 30 readings over 20 days). The two don't measure exactly the same thing, so a difference of up to about 0.5 percentage points is common.</p>
    </section>
    <section className="panel">
      <h2>Add a lab result</h2>
      <div className="row">
        <label className="field">Date of test<input type="date" value={date} max={localIso(Date.now()).slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">Result<input size={6} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
        <label className="field">Unit<select value={unit} onChange={(e) => setUnit(e.target.value as "pct" | "mmol")}><option value="pct">% (DCCT/NGSP)</option><option value="mmol">mmol/mol (IFCC)</option></select></label>
        <label className="field">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn primary" style={{ alignSelf: "end" }} onClick={add}>Add</button>
      </div>
    </section>
    <section className="panel">
      <h2>Results ({labs.length})</h2>
      {!rows.length ? <div className="empty">No lab results yet.</div> : (
        <table><thead><tr><th>Date</th><th className="r">Lab result</th><th className="r">Meter estimate</th><th className="r">Difference</th><th>Note</th><th /></tr></thead><tbody>
          {rows.map((l) => { const e = meterEstimate(readings, l.date); const diff = e ? l.ngsp - e.a1c : null; return (
            <tr key={l.id}><td>{l.date}</td><td className="r val">{l.ngsp.toFixed(1)}% <span className="note">({Math.round(ifccOf(l.ngsp))} mmol/mol)</span></td>
              <td className="r">{e ? <>{e.a1c.toFixed(1)}% <span className="note">({e.n} readings)</span></> : <span className="note">not enough readings</span>}</td>
              <td className="r">{diff == null ? "–" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff).toFixed(1)}`}</td><td className="note">{l.note ?? ""}</td>
              <td className="row" style={{ justifyContent: "flex-end" }}><button className="btn sm danger" onClick={() => commitL(labs.filter((x) => x.id !== l.id), "Lab result deleted")}>Delete</button></td></tr>); })}
        </tbody></table>)}
    </section>
  </>);
}
