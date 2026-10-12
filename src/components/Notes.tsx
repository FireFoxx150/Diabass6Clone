import { useMemo, useState } from "react";
import { DayNote } from "../lib/types";
import { newId } from "../lib/parse";
import { localIso } from "../lib/stats";

export const DEFAULT_TAGS = ["Exercise", "Illness", "Stress", "Alcohol", "Large meal", "Missed meal", "Travel", "Poor sleep"];

export function NoteForm({ initial, defaultTs, tagsInUse, onSave, onCancel }: { initial?: DayNote; defaultTs: string; tagsInUse: string[]; onSave: (n: DayNote) => void; onCancel?: () => void }) {
  const [ts, setTs] = useState((initial?.ts ?? defaultTs).slice(0, 16));
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [text, setText] = useState(initial?.text ?? "");
  const [custom, setCustom] = useState("");
  const all = [...new Set([...DEFAULT_TAGS, ...tagsInUse, ...tags])];
  const toggle = (t: string) => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
  const addCustom = () => { const t = custom.trim(); if (t && !tags.includes(t)) setTags([...tags, t]); setCustom(""); };
  const save = () => {
    if (!text.trim() && !tags.length) return;
    onSave({ id: initial?.id ?? newId(), ts: ts + ":00", tags, text: text.trim() });
    if (!initial) { setText(""); setTags([]); }
  };
  return (<>
    <div className="row" style={{ marginBottom: 12 }}>
      <label className="field">Date & time<input type="datetime-local" value={ts} onChange={(e) => setTs(e.target.value)} /></label>
      <label className="field">Add your own tag<span className="row"><input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()} style={{ minWidth: 140 }} /><button className="btn sm" onClick={addCustom}>Add</button></span></label>
    </div>
    <div className="chips" style={{ marginBottom: 12 }}>{all.map((t) => <button key={t} className={tags.includes(t) ? "on" : ""} onClick={() => toggle(t)}>{t}</button>)}</div>
    <label className="field" style={{ marginBottom: 12 }}>Note<input value={text} placeholder="e.g. 10 km run, stomach bug, late dinner" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} /></label>
    <div className="row"><button className="btn primary" onClick={save}>{initial ? "Save changes" : "Add note"}</button>{onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}</div>
  </>);
}

export default function NotesView({ notes, commitN }: { notes: DayNote[]; commitN: (n: DayNote[], m?: string) => void }) {
  const [tag, setTag] = useState(""); const [q, setQ] = useState(""); const [edit, setEdit] = useState<string | null>(null);
  const inUse = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);
  const shown = useMemo(() => [...notes].reverse().filter((n) => (!tag || n.tags.includes(tag)) && (!q || n.text.toLowerCase().includes(q.toLowerCase()) || n.ts.includes(q))), [notes, tag, q]);
  return (<>
    <section className="panel">
      <h2>Add a note</h2>
      <NoteForm defaultTs={localIso(Date.now())} tagsInUse={inUse} onSave={(n) => commitN([...notes, n].sort((a, b) => a.ts.localeCompare(b.ts)), "Note added")} />
      <p className="note">Tags let you filter the Readings tab by day and appear in your doctor report.</p>
    </section>
    <section className="panel">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Notes ({notes.length})</h2>
        <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}><option value="">All tags</option>{inUse.map((t) => <option key={t}>{t}</option>)}</select>
        <input placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }} />
      </div>
      {!shown.length ? <div className="empty">No notes to show.</div> : shown.map((n) => edit === n.id ? (
        <div key={n.id} className="card" style={{ display: "block" }}>
          <NoteForm initial={n} defaultTs={n.ts} tagsInUse={inUse} onCancel={() => setEdit(null)} onSave={(x) => { commitN(notes.map((y) => (y.id === x.id ? x : y)).sort((a, b) => a.ts.localeCompare(b.ts)), "Note updated"); setEdit(null); }} />
        </div>
      ) : (
        <div key={n.id} className="card">
          <div><div className="note">{n.ts.slice(0, 16).replace("T", "  ")}</div><div>{n.text || <span className="note">(tags only)</span>}</div>
            <div className="chips" style={{ marginTop: 6 }}>{n.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div></div>
          <div className="row"><button className="btn sm" onClick={() => setEdit(n.id)}>Edit</button><button className="btn sm danger" onClick={() => commitN(notes.filter((x) => x.id !== n.id), "Note deleted")}>Delete</button></div>
        </div>
      ))}
    </section>
  </>);
}
