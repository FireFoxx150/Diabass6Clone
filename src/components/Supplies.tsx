import { useState } from "react";
import { Reading, Supply, SupplyKind } from "../lib/types";
import { newId } from "../lib/parse";
import { localIso } from "../lib/stats";
import { supplyStatus } from "../lib/supplies";

const KINDS: [SupplyKind, string][] = [["strips", "Test strips"], ["control", "Control solution"], ["lancets", "Lancets"], ["other", "Other"]];
interface Draft { id?: string; kind: SupplyKind; name: string; expiry: string; openedOn: string; discardDays: string; count: string; countedAt: string; lowAt: string; }
const blank = (kind: SupplyKind = "strips"): Draft => ({ kind, name: KINDS.find((k) => k[0] === kind)![1], expiry: "", openedOn: "", discardDays: kind === "control" ? "90" : "", count: "", countedAt: localIso(Date.now()).slice(0, 16), lowAt: "25" });

export default function SuppliesView({ supplies, readings, commitS, say }: { supplies: Supply[]; readings: Reading[]; commitS: (s: Supply[], m?: string) => void; say: (m: string) => void }) {
  const [f, setF] = useState<Draft | null>(null);
  const today = localIso(Date.now()).slice(0, 10);
  const save = () => {
    if (!f) return;
    if (!f.name.trim()) { say("Give the item a name."); return; }
    const num = (x: string) => (x.trim() && isFinite(+x) ? Math.max(0, Math.round(+x)) : undefined);
    const sp: Supply = { id: f.id ?? newId(), kind: f.kind, name: f.name.trim(), expiry: f.expiry || undefined,
      openedOn: f.kind === "control" && f.openedOn ? f.openedOn : undefined, discardDays: f.kind === "control" ? num(f.discardDays) : undefined,
      count: f.kind === "strips" ? num(f.count) : undefined, countedAt: f.kind === "strips" && num(f.count) != null ? f.countedAt + ":00" : undefined, lowAt: f.kind === "strips" ? num(f.lowAt) : undefined };
    commitS([...supplies.filter((x) => x.id !== sp.id), sp], f.id ? "Supply updated" : "Supply added"); setF(null);
  };
  const edit = (sp: Supply) => setF({ id: sp.id, kind: sp.kind, name: sp.name, expiry: sp.expiry ?? "", openedOn: sp.openedOn ?? "", discardDays: sp.discardDays != null ? String(sp.discardDays) : "", count: sp.count != null ? String(sp.count) : "", countedAt: (sp.countedAt ?? localIso(Date.now())).slice(0, 16), lowAt: sp.lowAt != null ? String(sp.lowAt) : "25" });
  const dot = { ok: "var(--ok)", soon: "var(--low)", bad: "var(--high)" } as const;

  return (<>
    {!supplies.length && !f && <section className="panel empty"><p>Track test strip stock and expiry dates, and get a warning on the Overview before you run out.</p></section>}
    {supplies.map((sp) => { const st = supplyStatus(sp, readings, today); return (
      <div key={sp.id} className={"card " + st.level}>
        <div><div><span className="dot" style={{ background: dot[st.level] }} /><b>{sp.name}</b> <span className="chip">{KINDS.find((k) => k[0] === sp.kind)![1]}</span></div>
          {st.lines.map((l) => <div key={l} className="note" style={{ marginTop: 3 }}>{l}</div>)}
          {sp.kind === "strips" && sp.countedAt && <div className="note" style={{ marginTop: 3 }}>Counted {sp.count} on {sp.countedAt.slice(0, 16).replace("T", " ")}. Every test since then, including control tests, is subtracted.</div>}</div>
        <div className="row"><button className="btn sm" onClick={() => edit(sp)}>{sp.kind === "strips" ? "Recount / edit" : "Edit"}</button><button className="btn sm danger" onClick={() => commitS(supplies.filter((x) => x.id !== sp.id), "Supply removed")}>Remove</button></div>
      </div>); })}

    {f ? (
      <section className="panel">
        <h2>{f.id ? "Edit supply" : "Add a supply"}</h2>
        <div className="grid" style={{ marginBottom: 14 }}>
          <label className="field">Type<select value={f.kind} disabled={!!f.id} onChange={(e) => setF({ ...blank(e.target.value as SupplyKind), id: f.id })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Expiry date (on the pack)<input type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></label>
          {f.kind === "strips" && <>
            <label className="field">Strips in the pot now<input inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></label>
            <label className="field">Counted at<input type="datetime-local" value={f.countedAt} onChange={(e) => setF({ ...f, countedAt: e.target.value })} /></label>
            <label className="field">Warn when fewer than<input inputMode="numeric" value={f.lowAt} onChange={(e) => setF({ ...f, lowAt: e.target.value })} /></label></>}
          {f.kind === "control" && <>
            <label className="field">Date opened<input type="date" value={f.openedOn} onChange={(e) => setF({ ...f, openedOn: e.target.value })} /></label>
            <label className="field">Discard after (days)<input inputMode="numeric" value={f.discardDays} onChange={(e) => setF({ ...f, discardDays: e.target.value })} /></label></>}
        </div>
        <p className="note">Check the pack for the real discard period after opening. Many control solutions say 3 months.</p>
        <div className="row"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setF(null)}>Cancel</button></div>
      </section>
    ) : <div style={{ marginTop: 6 }}><button className="btn primary" onClick={() => setF(blank())}>Add a supply</button></div>}
  </>);
}
