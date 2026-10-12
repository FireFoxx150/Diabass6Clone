import { useState } from "react";
import { api } from "../lib/api";
import { Settings } from "../lib/types";

const sel: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", color: "var(--text)" };

export default function Onboarding({ s, set, finish, goMeter, enableBackups }: { s: Settings; set: (p: Partial<Settings>) => void; finish: () => void; goMeter: () => void; enableBackups: () => Promise<void> }) {
  const [step, setStep] = useState(0), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [busy, setBusy] = useState(false);
  const steps = ["Connect your meter", "Units and targets", "Keep your data safe", "Download your readings"];
  const run = async (f: () => Promise<string | void>) => { setBusy(true); setMsg(null); try { const t = await f(); setMsg({ ok: true, t: t || "Done." }); } catch (e) { setMsg({ ok: false, t: String(e) }); } finally { setBusy(false); } };
  return (
    <div className="overlay"><div className="box" role="dialog" aria-label="Welcome">
      <div className="note">Step {step + 1} of {steps.length}</div>
      <h1 style={{ marginBottom: 12 }}>{steps[step]}</h1>
      {step === 0 && <>
        <p>Plug your meter's cable into the computer. Switch the meter <b>off</b> first, then connect: it should show "PC" or "USB".</p>
        <p className="note">Linux needs permission to talk to the cable. This button asks for your password once and sets that up.</p>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => run(() => api.installCableAccess())}>{busy ? "Working…" : "Set up cable access"}</button></div>
      </>}
      {step === 1 && <div className="grid">
        <label className="field">Units<select style={sel} value={s.unit} onChange={(e) => set({ unit: e.target.value as Settings["unit"] })}><option value="mgdl">mg/dL</option><option value="mmol">mmol/L</option></select></label>
        <label className="field">Target low (mg/dL)<input type="number" value={s.low} onChange={(e) => set({ low: +e.target.value })} /></label>
        <label className="field">Target high (mg/dL)<input type="number" value={s.high} onChange={(e) => set({ high: +e.target.value })} /></label>
        <label className="field">Meter date order<select style={sel} value={s.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as Settings["dateOrder"] })}><option value="dmy">Day / Month / Year</option><option value="mdy">Month / Day / Year</option></select></label>
      </div>}
      {step === 2 && <>
        <p>Your readings live only on this computer. Two things worth doing now:</p>
        <ul style={{ lineHeight: 1.7 }}>
          <li><b>Automatic backups</b>: a dated copy in your Documents folder after changes.</li>
          <li><b>Password protection</b>: encrypts your data and backups. Turn it on later under Data and settings.</li>
        </ul>
        <div className="row"><button className="btn primary" disabled={busy || !!s.backup?.enabled} onClick={() => run(async () => { await enableBackups(); return "Automatic backups are on."; })}>{s.backup?.enabled ? "Backups are on" : "Turn on automatic backups"}</button></div>
      </>}
      {step === 3 && <>
        <p>Switch the meter off, plug the cable in so it shows "PC", then open the Meter tab, pick the cable and press <b>Download new readings</b>. The first download reads everything the meter holds and can take a few minutes. After that, downloads take seconds.</p>
        <div className="row"><button className="btn primary" onClick={() => { finish(); goMeter(); }}>Go to the Meter tab</button></div>
      </>}
      {msg && <p style={{ color: msg.ok ? "var(--ok)" : "var(--high)", marginBottom: 0 }}>{msg.t}</p>}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 20 }}>
        <button className="btn sm" onClick={finish}>Skip the guide</button>
        <span className="row"><button className="btn" disabled={step === 0} onClick={() => { setStep(step - 1); setMsg(null); }}>Back</button>
          {step < steps.length - 1 && <button className="btn primary" onClick={() => { setStep(step + 1); setMsg(null); }}>Next</button>}</span>
      </div>
    </div></div>
  );
}
