import { useState } from "react";
import type { ProfileInfo } from "../lib/prefs";

export default function LockScreen({ kind, onUnlock, onStartFresh, error, profiles, profileId, onSwitch }: { kind: "locked" | "corrupt"; onUnlock: (pw: string) => Promise<void>; onStartFresh: () => Promise<void>; error?: string; profiles?: ProfileInfo[]; profileId?: string; onSwitch?: (id: string) => void }) {
  const who = profiles?.find((p) => p.id === profileId)?.name;
  const [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [forgot, setForgot] = useState(false);
  const go = async () => { if (!pw) return; setBusy(true); setErr(""); try { await onUnlock(pw); } catch (e) { setErr(String((e as Error).message ?? e)); setPw(""); } finally { setBusy(false); } };
  if (kind === "corrupt") return (
    <div className="lock"><div className="box">
      <h1>Your data file couldn't be read</h1>
      <p className="note">{error || "The saved data is damaged and there is no usable recovery copy."} Nothing has been changed or overwritten. You can restore from one of your backups after starting fresh.</p>
      <button className="btn danger" onClick={onStartFresh}>Move the damaged file aside and start fresh</button>
    </div></div>
  );
  return (
    <div className="lock"><div className="box">
      <h1>DIABASS 6</h1><div className="note">Enter your password to open {profiles && profiles.length > 1 && who ? `${who}'s data` : "your data"}.</div>
      {profiles && profiles.length > 1 && onSwitch && <select className="profile-pick" aria-label="Profile" style={{ marginTop: 14, marginBottom: 0 }} value={profileId} onChange={(e) => onSwitch(e.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <input type="password" autoFocus aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      {(err || error) && <p style={{ color: "var(--high)", margin: "0 0 10px" }}>{err || error}</p>}
      <div className="row"><button className="btn primary" disabled={busy || !pw} onClick={go}>{busy ? "Unlocking…" : "Unlock"}</button><button className="btn sm" onClick={() => setForgot(!forgot)}>Forgot password?</button></div>
      {forgot && <div style={{ marginTop: 14 }}>
        <p className="note">Your data is encrypted and the password can't be recovered or reset. If you have an unencrypted backup you can start fresh and restore it. The encrypted file is kept (renamed) in case you remember the password later.</p>
        <button className="btn danger" onClick={() => window.confirm("Start with an empty app? The encrypted data file is kept but renamed.") && onStartFresh()}>Start fresh</button></div>}
    </div></div>
  );
}
