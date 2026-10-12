import { useRef, useState } from "react";
import { InsulinDose, Extra, Reading, Settings, fmt, unitLabel } from "../lib/types";
import { mergeInsulin, mergeReadings } from "../lib/parse";
import { ImportPlan, SOURCE_NAMES, planImport } from "../lib/importers";

export default function ImportOther({ s, readings, insulin, commit, say }: { s: Settings; readings: Reading[]; insulin: InsulinDose[]; commit: (r: Reading[], m?: string, x?: Extra) => void; say: (m: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<{ name: string; text: string } | null>(null);
  const [order, setOrder] = useState<Settings["dateOrder"]>(s.dateOrder);
  const [useBlood, setUseBlood] = useState(true), [useIns, setUseIns] = useState(true);
  const plan: ImportPlan | null = src ? planImport(src.text, src.name, order) : null;
  const u = unitLabel(s.unit);
  const span = (xs: { ts: string }[]) => (xs.length ? `${xs[0].ts.slice(0, 10)} to ${xs[xs.length - 1].ts.slice(0, 10)}` : "none");

  const choose = async (f: File) => {
    const text = await f.text(); setSrc({ name: f.name, text });
    const p = planImport(text, f.name, s.dateOrder); setOrder(p.order); setUseBlood(true); setUseIns(true);
  };
  const run = () => {
    if (!plan) return;
    const mr = useBlood ? mergeReadings(readings, plan.blood) : { all: readings, added: 0, dupes: 0 };
    const mi = useIns ? mergeInsulin(insulin, plan.doses) : { all: insulin, added: 0, dupes: 0 };
    commit(mr.all, `Imported ${mr.added} glucose readings and ${mi.added} insulin doses (${mr.dupes + mi.dupes} duplicates skipped)`, { insulin: mi.all });
    setSrc(null);
  };

  return (
    <section className="panel">
      <h2>Import from another system</h2>
      <p className="note" style={{ marginTop: 0 }}>Reads CSV exports from FreeStyle Libre (LibreView), Dexcom Clarity and Glooko, or any CSV with a date/time column and glucose or insulin columns. Fingerstick readings and insulin doses are imported. Continuous-sensor values are skipped, because thousands of them would swamp your meter data and distort tests per day and strip counts.</p>
      <div className="row"><button className="btn" onClick={() => file.current?.click()}>Choose a CSV file…</button>
        <input ref={file} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); e.target.value = ""; }} /></div>

      {plan && src && (plan.error ? <p style={{ color: "var(--high)", marginBottom: 0 }}>{src.name}: {plan.error}</p> : (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: "0 0 8px" }}><b>{src.name}</b> looks like <b>{SOURCE_NAMES[plan.source]}</b> ({plan.rows} rows).</p>
          <div className="grid" style={{ marginBottom: 12 }}>
            <label className="row"><input type="checkbox" checked={useBlood} onChange={(e) => setUseBlood(e.target.checked)} /><span><b>{plan.blood.length}</b> fingerstick readings<br /><span className="note">{span(plan.blood)}</span></span></label>
            <label className="row"><input type="checkbox" checked={useIns} onChange={(e) => setUseIns(e.target.checked)} /><span><b>{plan.doses.length}</b> insulin doses<br /><span className="note">{span(plan.doses)}</span></span></label>
          </div>
          {plan.sensorSkipped > 0 && <p className="note">{plan.sensorSkipped} continuous-sensor values were skipped.</p>}
          {plan.ambiguous && <div className="banner" style={{ marginBottom: 12 }}><span>Every date in this file could be read two ways. Check the date range above, and choose the right order if it looks wrong.</span>
            <select value={order} onChange={(e) => setOrder(e.target.value as Settings["dateOrder"])} aria-label="Date order" style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}><option value="dmy">Day / Month / Year</option><option value="mdy">Month / Day / Year</option></select></div>}
          {plan.blood.length > 0 && <table style={{ marginBottom: 10 }}><thead><tr><th>Preview: date & time</th><th>Result ({u})</th><th>Meal</th></tr></thead><tbody>
            {plan.blood.slice(0, 5).map((r) => <tr key={r.id}><td>{r.ts.slice(0, 16).replace("T", "  ")}</td><td className="val">{fmt(r.mgdl, s.unit)}</td><td>{r.meal ?? ""}</td></tr>)}</tbody></table>}
          {plan.skipped.length > 0 && <div className="log" style={{ marginBottom: 10 }}>{plan.skipped.slice(0, 6).join("\n")}{plan.skipped.length > 6 ? `\n…and ${plan.skipped.length - 6} more` : ""}</div>}
          <div className="row"><button className="btn primary" disabled={(!useBlood || !plan.blood.length) && (!useIns || !plan.doses.length)} onClick={run}>Import selected</button><button className="btn" onClick={() => { setSrc(null); say("Import cancelled"); }}>Cancel</button></div>
        </div>
      ))}
    </section>
  );
}
