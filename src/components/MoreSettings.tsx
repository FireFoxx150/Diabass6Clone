import { useState } from "react";
import { api } from "../lib/api";
import { Prefs } from "../lib/prefs";
import { Reading, Reminders, Settings } from "../lib/types";
import { toCsvAlt, toTidepoolJson } from "../lib/exporters";

const sel: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", color: "var(--text)" };

export function ProfilesPanel({ prefs, setPrefs, onSwitch, onAdd, onDelete }: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; onSwitch: (id: string) => void; onAdd: (name: string) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState("");
  return (
    <section className="panel"><h2>Profiles</h2>
      <p className="note" style={{ marginTop: 0 }}>Each profile has its own readings, settings, backups and password. Handy for looking after someone else's meter. Switching locks the current profile.</p>
      {prefs.profiles.map((p) => (
        <div key={p.id} className="row" style={{ marginBottom: 8 }}>
          <input aria-label="Profile name" value={p.name} onChange={(e) => setPrefs({ profiles: prefs.profiles.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)) })} style={sel} />
          {p.id === prefs.profile ? <span className="chip ctl">open now</span> : <button className="btn sm" onClick={() => onSwitch(p.id)}>Open</button>}
          {p.id !== "default" && p.id !== prefs.profile && <button className="btn sm danger" onClick={() => window.confirm(`Remove the profile "${p.name}"? Its data file is kept on disk, renamed, not deleted.`) && onDelete(p.id)}>Remove</button>}
        </div>
      ))}
      <div className="row"><input placeholder="New profile name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onAdd(name.trim()); setName(""); } }} style={sel} /><button className="btn" disabled={!name.trim()} onClick={() => { onAdd(name.trim()); setName(""); }}>Add profile</button></div>
    </section>
  );
}

export function RemindersPanel({ s, set, prefs, setPrefs, say }: { s: Settings; set: (p: Partial<Settings>) => void; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; say: (m: string) => void }) {
  const r: Reminders = s.reminders ?? { enabled: false, times: [], stale: true, strips: true };
  const up = (p: Partial<Reminders>) => set({ reminders: { ...r, ...p } });
  const [t, setT] = useState("08:00");
  return (
    <section className="panel"><h2>Reminders and tray</h2>
      <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={r.enabled} onChange={(e) => up({ enabled: e.target.checked })} />Show desktop notifications</label>
      {r.enabled && <>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="note">Test reminders at:</span>
          {r.times.map((x) => <span key={x} className="chip">{x} <button aria-label={`Remove ${x}`} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer" }} onClick={() => up({ times: r.times.filter((y) => y !== x) })}>×</button></span>)}
          <input type="time" value={t} onChange={(e) => setT(e.target.value)} style={sel} /><button className="btn sm" onClick={() => t && !r.times.includes(t) && up({ times: [...r.times, t].sort() })}>Add</button>
        </div>
        <label className="row"><input type="checkbox" checked={r.stale} onChange={(e) => up({ stale: e.target.checked })} />Remind me if I haven't downloaded the meter for a week</label>
        <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={r.strips} onChange={(e) => up({ strips: e.target.checked })} />Tell me when strips or control solution run low or expire</label>
        <button className="btn sm" onClick={() => api.notify("DIABASS 6", "Notifications are working.").then(() => say("Test notification sent"))}>Send a test notification</button>
      </>}
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "16px 0" }} />
      <label className="row"><input type="checkbox" checked={prefs.closeToTray} onChange={(e) => setPrefs({ closeToTray: e.target.checked })} />Keep running in the system tray when the window is closed</label>
      <p className="note" style={{ marginBottom: 0 }}>Reminders only fire while the app is running, so turn the tray option on to receive them with the window closed. The tray icon has Show, Download readings and Quit. Reminders belong to the open profile.</p>
    </section>
  );
}

export function ExportsPanel({ readings, say }: { readings: Reading[]; say: (m: string) => void }) {
  const stamp = new Date().toISOString().slice(0, 10), save = async (name: string, c: string) => say("Saved to " + (await api.exportFile(name, c)));
  return (
    <section className="panel"><h2>Export for other tools</h2>
      <div className="row">
        <button className="btn" onClick={() => save(`diabass6-tidepool-${stamp}.json`, toTidepoolJson(readings))}>Tidepool data model (JSON)</button>
        <button className="btn" onClick={() => save(`diabass6-glucose-mmol-${stamp}.csv`, toCsvAlt(readings, { unit: "mmol", delimiter: ";" }))}>CSV, mmol/L, semicolon</button>
        <button className="btn" onClick={() => save(`diabass6-glucose-mgdl-${stamp}.csv`, toCsvAlt(readings, { unit: "mgdl", delimiter: "," }))}>CSV, mg/dL, comma</button>
      </div>
      <p className="note">These contain blood glucose readings only (control-solution tests are left out). The Tidepool file follows their data model (type smbg, mmol/L, UTC time plus the meter's local time); it is meant for tools that read that model, and importing it into Tidepool itself may need their uploader or API. The semicolon CSV opens correctly in spreadsheets that use a decimal comma. The full backup remains the way to move everything between computers.</p>
    </section>
  );
}
