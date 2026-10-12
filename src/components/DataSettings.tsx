import { useEffect, useRef, useState } from "react";
import { api, BackupInfo } from "../lib/api";
import { DayNote, Extra, HypoEvent, InsulinDose, KetoneReading, LabA1c, Reading, Settings, Supply } from "../lib/types";
import { mergeHypos, mergeInsulin, mergeKetones, mergeLabs, mergeNotes, mergeReadings, mergeSupplies, newId, toCsv } from "../lib/parse";
import { Prefs } from "../lib/prefs";
import { Envelope, isEnvelope, openEnvelope } from "../lib/vault";
import { demoReadings } from "../lib/demo";
import ImportOther from "./ImportOther";
import { ExportsPanel, ProfilesPanel, RemindersPanel } from "./MoreSettings";

export interface Security {
  cryptoOk: boolean; isProtected: boolean;
  enable: (pw: string) => Promise<void>; change: (oldPw: string, newPw: string) => Promise<void>; disable: (pw: string) => Promise<void>;
  lock: () => void; sealText: (plain: string) => Promise<string>;
}
export interface BackupApi { now: () => Promise<void>; last?: string; error: string; }
interface Props {
  s: Settings; set: (p: Partial<Settings>) => void; readings: Reading[]; insulin: InsulinDose[]; hypos: HypoEvent[]; labs: LabA1c[]; supplies: Supply[]; notes: DayNote[]; ketones: KetoneReading[];
  profileId: string; profiles: { onSwitch: (id: string) => void; onAdd: (name: string) => void; onDelete: (id: string) => void };
  commit: (r: Reading[], m?: string, x?: Extra) => void; say: (m: string) => void; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; sec: Security; backup: BackupApi;
}
const sel: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", color: "var(--text)" };
const ago = (iso?: string) => { if (!iso) return "never"; const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); if (m < 2) return "just now"; if (m < 60) return `${m} minutes ago`; const h = Math.round(m / 60); if (m < 1440) return `${h} hour${h === 1 ? "" : "s"} ago`; const d = Math.round(m / 1440); return d === 1 ? "yesterday" : `${d} days ago`; };

export default function DataSettings(p: Props) {
  const { s, set, readings, insulin, hypos, labs, supplies, notes, ketones, commit, say, prefs, setPrefs, sec, backup, profileId, profiles } = p;
  const file = useRef<HTMLInputElement>(null);
  const stamp = new Date().toISOString().slice(0, 10);
  const [pending, setPending] = useState<Envelope | null>(null); const [pw, setPw] = useState(""); const [pwErr, setPwErr] = useState("");
  const [encExport, setEncExport] = useState(true);
  const [list, setList] = useState<BackupInfo[]>([]);
  const folder = s.backup?.folder ?? "";

  useEffect(() => { if (folder) api.listBackups(folder).then((l) => setList(l.filter((b) => (profileId === "default" ? /^diabass6-backup-\d{4}-/.test(b.name) : b.name.startsWith(`diabass6-backup-${profileId}-`))))).catch(() => setList([])); else setList([]); }, [folder, backup.last, profileId]);

  /* ---- restore / import a DIABASS backup (plain or password-protected) ---- */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyBackup = (j: any) => {
    try {
      const incoming: Reading[] = (j.readings ?? j).map((r: Reading) => ({ ...r, id: r.id || newId(), flag: r.flag === "control" ? "control" : "none" }));
      const m = mergeReadings(readings, incoming);
      const mi = mergeInsulin(insulin, Array.isArray(j.insulin) ? j.insulin.map((d: InsulinDose) => ({ ...d, id: d.id || newId() })) : []);
      const mh = mergeHypos(hypos, Array.isArray(j.hypos) ? j.hypos.map((h: HypoEvent) => ({ ...h, id: h.id || newId(), symptoms: h.symptoms ?? [] })) : []);
      const ml = mergeLabs(labs, Array.isArray(j.labs) ? j.labs.map((l: LabA1c) => ({ ...l, id: l.id || newId() })) : []);
      const ms = mergeSupplies(supplies, Array.isArray(j.supplies) ? j.supplies.map((x: Supply) => ({ ...x, id: x.id || newId() })) : []);
      const mn = mergeNotes(notes, Array.isArray(j.notes) ? j.notes.map((n: DayNote) => ({ ...n, id: n.id || newId(), tags: n.tags ?? [] })) : []);
      const mk = mergeKetones(ketones, Array.isArray(j.ketones) ? j.ketones.map((k: KetoneReading) => ({ ...k, id: k.id || newId() })) : []);
      commit(m.all, `Restored ${m.added} readings, ${mi.added} doses, ${mh.added} low-glucose events, ${ml.added} lab results, ${mn.added} notes, ${mk.added} ketone readings (duplicates skipped)`, { insulin: mi.all, hypos: mh.all, labs: ml.all, supplies: ms.all, notes: mn.all, ketones: mk.all });
      if (j.settings) set({ ...j.settings, port: s.port, meterId: s.meterId, lastDownload: s.lastDownload, clockOffsetMin: s.clockOffsetMin, backup: s.backup });
    } catch { say("That file isn't a valid DIABASS backup."); }
  };
  const restoreText = (text: string) => {
    let j; try { j = JSON.parse(text); } catch { say("That file isn't a valid DIABASS backup."); return; }
    if (isEnvelope(j)) { setPending(j); setPw(""); setPwErr(""); } else applyBackup(j);
  };
  const unlockBackup = async () => {
    if (!pending) return;
    try { const { plaintext } = await openEnvelope(pending, pw); setPending(null); applyBackup(JSON.parse(plaintext)); } catch (e) { setPwErr(String((e as Error).message ?? e)); }
  };
  const restoreFromList = async (b: BackupInfo) => { try { restoreText(await api.readTextFile(folder + (folder.includes("\\") ? "\\" : "/") + b.name)); } catch (e) { say(String(e)); } };
  const browse = async () => { const f = await api.pickBackupFile(folder || undefined); if (f) { try { restoreText(await api.readTextFile(f)); } catch (e) { say(String(e)); } } };

  const manualBackup = async () => {
    const plain = JSON.stringify({ app: "DIABASS 6", version: 5, settings: s, readings, insulin, hypos, labs, supplies, notes, ketones }, null, 2);
    const out = sec.isProtected && encExport ? await sec.sealText(plain) : plain;
    say("Saved to " + await api.exportFile(`diabass6-backup-${stamp}${sec.isProtected && encExport ? "-encrypted" : ""}.json`, out));
  };

  return (<>
    <section className="panel"><h2>Display</h2>
      <div className="grid">
        <label className="field">Units<select value={s.unit} onChange={(e) => set({ unit: e.target.value as Settings["unit"] })}><option value="mgdl">mg/dL</option><option value="mmol">mmol/L</option></select></label>
        <label className="field">Target low (mg/dL)<input type="number" value={s.low} onChange={(e) => set({ low: +e.target.value })} /></label>
        <label className="field">Target high (mg/dL)<input type="number" value={s.high} onChange={(e) => set({ high: +e.target.value })} /></label>
        <label className="field">Meter date order<select value={s.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as Settings["dateOrder"] })}><option value="dmy">Day / Month / Year</option><option value="mdy">Month / Day / Year</option></select></label>
        <label className="field">Theme<select value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as Prefs["theme"] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Match my system</option></select></label>
        <label className="field">Text size<select value={prefs.text} onChange={(e) => setPrefs({ text: e.target.value as Prefs["text"] })}><option value="normal">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></label>
      </div>
    </section>

    <ProfilesPanel prefs={prefs} setPrefs={setPrefs} onSwitch={profiles.onSwitch} onAdd={profiles.onAdd} onDelete={profiles.onDelete} />
    <RemindersPanel s={s} set={set} prefs={prefs} setPrefs={setPrefs} say={say} />

    <SecurityPanel sec={sec} prefs={prefs} setPrefs={setPrefs} say={say} />

    <section className="panel"><h2>Automatic backups</h2>
      <label className="row" style={{ marginBottom: 12 }}><input type="checkbox" checked={!!s.backup?.enabled} onChange={async (e) => {
        const enabled = e.target.checked; const f = s.backup?.folder || (await api.defaultBackupDir());
        set({ backup: { enabled, folder: f, keep: s.backup?.keep ?? 30 } });
      }} />Save a dated backup file after changes (one file per day, the newest state of that day)</label>
      {s.backup?.enabled && <>
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field" style={{ flex: 1, minWidth: 280 }}>Backup folder<input value={folder} onChange={(e) => set({ backup: { ...s.backup!, folder: e.target.value } })} /></label>
          <button className="btn" style={{ alignSelf: "end" }} onClick={async () => { const f = await api.pickFolder(folder); if (f) set({ backup: { ...s.backup!, folder: f } }); }}>Browse…</button>
          <label className="field">Keep the last<select value={s.backup.keep} onChange={(e) => set({ backup: { ...s.backup!, keep: +e.target.value } })}>{[7, 14, 30, 60, 90, 365].map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
          <button className="btn primary" style={{ alignSelf: "end" }} onClick={() => backup.now()}>Back up now</button>
        </div>
        <p className="note">Last backup: {ago(backup.last)}. {backup.error && <span style={{ color: "var(--high)" }}>{backup.error}</span>}</p>
        <p className="note">{sec.isProtected ? "Backups are encrypted with your password, so a synced folder (Nextcloud, Syncthing, a USB drive) is safe to use. Backups made before you turned protection on are not encrypted." : "Backups are plain text: anyone who can open the folder can read them. Turn on password protection above to encrypt them."}</p>
      </>}
      {pending && <div className="banner" style={{ marginTop: 12 }}><span>This backup is password-protected.<br /><input type="password" autoFocus placeholder="Backup password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlockBackup()} style={{ ...sel, marginTop: 8 }} /> {pwErr && <span style={{ color: "var(--high)" }}>{pwErr}</span>}</span>
        <span className="row"><button className="btn primary" onClick={unlockBackup}>Open backup</button><button className="btn" onClick={() => setPending(null)}>Cancel</button></span></div>}
      <h2 style={{ marginTop: 16 }}>Restore</h2>
      {list.length > 0 && <table style={{ marginBottom: 10 }}><tbody>{list.slice(0, 8).map((b) => <tr key={b.name}><td>{b.name}</td><td className="note">{(b.size / 1024).toFixed(0)} KB</td><td className="r"><button className="btn sm" onClick={() => restoreFromList(b)}>Restore</button></td></tr>)}</tbody></table>}
      <div className="row"><button className="btn" onClick={browse}>Restore from a file…</button><button className="btn" onClick={() => file.current?.click()}>Choose file (browser dialog)</button>
        <input ref={file} type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) restoreText(await f.text()); e.target.value = ""; }} /></div>
      <p className="note">Restoring merges the backup into what you have now and never creates duplicates.</p>
    </section>

    <section className="panel"><h2>Export</h2>
      <div className="row">
        <button className="btn primary" onClick={manualBackup}>Full backup (JSON)</button>
        {sec.isProtected && <label className="row"><input type="checkbox" checked={encExport} onChange={(e) => setEncExport(e.target.checked)} />Encrypt it</label>}
        <button className="btn" onClick={async () => say("Saved to " + await api.exportFile(`diabass6-readings-${stamp}.csv`, toCsv(readings)))}>Export readings as CSV</button>
      </div>
      <p className="note">Files are saved to Documents/DIABASS6. CSV files are never encrypted.</p>
    </section>

    <ExportsPanel readings={readings} say={say} />

    <ImportOther s={s} readings={readings} insulin={insulin} commit={commit} say={say} />

    <section className="panel"><h2>Sample data</h2>
      <div className="row"><button className="btn" onClick={() => commit(mergeReadings(readings, demoReadings()).all, "Added 60 days of sample readings")}>Load sample readings</button>
        <button className="btn danger" onClick={() => window.confirm("Delete all stored readings? Insulin doses are kept. You can undo this until you close the app.") && commit([], "All readings deleted")}>Delete all readings</button></div>
    </section>
  </>);
}

function SecurityPanel({ sec, prefs, setPrefs, say }: { sec: Security; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; say: (m: string) => void }) {
  const [mode, setMode] = useState<"" | "enable" | "change" | "disable">("");
  const [cur, setCur] = useState(""), [a, setA] = useState(""), [b, setB] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const reset = () => { setMode(""); setCur(""); setA(""); setB(""); setErr(""); };
  const go = async () => {
    setErr("");
    if (mode !== "disable" && (a.length < 8 || a !== b)) { setErr(a.length < 8 ? "Use at least 8 characters." : "The two passwords don't match."); return; }
    setBusy(true);
    try {
      if (mode === "enable") await sec.enable(a); else if (mode === "change") await sec.change(cur, a); else await sec.disable(cur);
      say(mode === "enable" ? "Password protection is on." : mode === "change" ? "Password changed." : "Password protection is off."); reset();
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  const field = (label: string, v: string, f: (x: string) => void) => <label className="field">{label}<input type="password" value={v} onChange={(e) => f(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} /></label>;
  return (
    <section className="panel"><h2>Password protection</h2>
      {!sec.cryptoOk ? <p className="note" style={{ margin: 0 }}>Encryption isn't available in this window (it needs a secure context), so password protection is unavailable.</p> : !sec.isProtected ? (<>
        <p className="note" style={{ marginTop: 0 }}>Encrypts your readings, insulin, events, notes and backups on disk (AES-256, key derived from your password), and asks for the password when the app starts. <b>There is no way to recover a forgotten password.</b> Keep a copy of it somewhere safe.</p>
        {mode === "enable" ? <div className="row">{field("New password", a, setA)}{field("Repeat it", b, setB)}<button className="btn primary" style={{ alignSelf: "end" }} disabled={busy} onClick={go}>{busy ? "Working…" : "Turn on"}</button><button className="btn" style={{ alignSelf: "end" }} onClick={reset}>Cancel</button></div>
          : <button className="btn" onClick={() => setMode("enable")}>Turn on password protection…</button>}
      </>) : (<>
        <p style={{ marginTop: 0, color: "var(--ok)" }}>Protection is on. Your data is encrypted on disk.</p>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn primary" onClick={sec.lock}>Lock now</button>
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Lock automatically after
            <select value={prefs.autoLockMin} onChange={(e) => setPrefs({ autoLockMin: +e.target.value })} style={sel}>{[[0, "never"], [5, "5 min"], [15, "15 min"], [30, "30 min"], [60, "1 hour"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> of inactivity</label>
        </div>
        {mode === "change" && <div className="row" style={{ marginBottom: 8 }}>{field("Current password", cur, setCur)}{field("New password", a, setA)}{field("Repeat new", b, setB)}<button className="btn primary" style={{ alignSelf: "end" }} disabled={busy} onClick={go}>{busy ? "Working…" : "Change"}</button><button className="btn" style={{ alignSelf: "end" }} onClick={reset}>Cancel</button></div>}
        {mode === "disable" && <div className="row" style={{ marginBottom: 8 }}>{field("Current password", cur, setCur)}<button className="btn danger" style={{ alignSelf: "end" }} disabled={busy} onClick={go}>{busy ? "Working…" : "Turn off protection"}</button><button className="btn" style={{ alignSelf: "end" }} onClick={reset}>Cancel</button></div>}
        {!mode && <div className="row"><button className="btn" onClick={() => setMode("change")}>Change password…</button><button className="btn" onClick={() => setMode("disable")}>Turn off…</button></div>}
      </>)}
      {err && <p style={{ color: "var(--high)", marginBottom: 0 }}>{err}</p>}
    </section>
  );
}
