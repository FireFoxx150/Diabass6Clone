import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, normalizeStore, PortInfo } from "./lib/api";
import type { ExtraRec } from "./lib/api";
import { DEFAULT_SETTINGS, DayNote, Extra, HypoEvent, InsulinDose, KetoneReading, KindRule, LabA1c, MMOL, Protocol, Reading, Settings, Store, Supply, fmt, unitLabel } from "./lib/types";
import { Envelope, Vault, cryptoAvailable, createVault, isEnvelope, openEnvelope, seal } from "./lib/vault";
import { Prefs, applyPrefs, loadPrefs, savePrefs } from "./lib/prefs";
import type { InsulinParse } from "./lib/parse";
import { insulinToCsv, mergeHypos, mergeInsulin, mergeLabs, mergeNotes, mergeReadings, mergeSupplies, newId, parseInsulinCsv, parseMeterText, shiftTs, toCsv } from "./lib/parse";
import { supplyStatus } from "./lib/supplies";
import { calcStats, hourOf, localIso } from "./lib/stats";
import { mergeKetones } from "./lib/parse";
import { UnknownKind, applyKinds, kindKey } from "./lib/kinds";
import { dueReminders, markFired } from "./lib/reminders";
import { findPatterns } from "./lib/patterns";
import { demoReadings } from "./lib/demo";
import { AgpChart, DoseChart, ProfileChart, TrendChart } from "./components/Charts";
import { CompareTable } from "./components/Compare";
import HypoView from "./components/Hypo";
import ReportView from "./components/Report";
import CalendarView from "./components/Calendar";
import LabsView from "./components/Labs";
import SuppliesView from "./components/Supplies";
import NotesView from "./components/Notes";
import { PortPicker, SupportReport, UsbDiagnostics } from "./components/PortTools";
import DataSettings from "./components/DataSettings";
import LockScreen from "./components/LockScreen";
import MonthlyView from "./components/Monthly";
import KetoneView from "./components/KetoneView";
import QualityView from "./components/Quality";
import PrepareView from "./components/Prepare";
import GoalsPanel from "./components/GoalsPanel";
import Onboarding from "./components/Onboarding";

type View = "dash" | "profile" | "monthly" | "calendar" | "readings" | "insulin" | "hypo" | "ketone" | "notes" | "labs" | "supplies" | "quality" | "prepare" | "report" | "meter" | "data";
const NAV: [View, string, string][] = [["dash", "Overview", "◧"], ["profile", "Daily profile", "◔"], ["monthly", "Monthly", "▥"], ["calendar", "Calendar", "▦"], ["readings", "Readings", "☰"], ["insulin", "Insulin", "◍"], ["hypo", "Low-glucose log", "▽"], ["ketone", "Ketone & HCT", "◉"], ["notes", "Notes & tags", "✎"], ["labs", "Lab HbA1c", "◈"], ["supplies", "Supplies", "▣"], ["quality", "Data quality", "✓"], ["prepare", "Appointment", "❖"], ["report", "Doctor report", "▤"], ["meter", "Meter", "⌁"], ["data", "Data & settings", "⚙"]];
const PERIODS: [string, number][] = [["7 d", 7], ["14 d", 14], ["30 d", 30], ["90 d", 90], ["All", 0]];
const TITLES: Record<View, string> = { dash: "Overview", profile: "Daily profile", monthly: "Monthly summary", calendar: "Calendar", readings: "Readings", insulin: "Insulin", hypo: "Low-glucose log", ketone: "Ketones & haematocrit", notes: "Notes & tags", labs: "Lab HbA1c", supplies: "Supplies", quality: "Data quality", prepare: "Prepare for an appointment", report: "Doctor report", meter: "Meter", data: "Data & settings" };

const ago = (iso?: string) => {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return "just now"; if (m < 60) return `${m} minutes ago`; if (m < 1440) { const h = Math.round(m / 60); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  const d = Math.round(m / 1440); return d === 1 ? "yesterday" : `${d} days ago`;
};
/** Keep the chosen port if it still exists, otherwise prefer a USB serial device over built-in ports. */
const preferredPort = (cur: string, l: PortInfo[]) => (l.find((x) => x.name === cur) ? cur : (l.find((x) => x.id) ?? l[0])?.name ?? cur);
interface Snap { r: Reading[]; i: InsulinDose[]; h: HypoEvent[]; l: LabA1c[]; sp: Supply[]; n: DayNote[]; k: KetoneReading[]; }
export interface ClockResult { error?: string; newest?: string; offsetMin?: number; }
export interface DlLog { text: string; hex: string; bytes: number; error?: string; }

export default function App() {
  const [view, setView] = useState<View>("dash");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [insulin, setInsulin] = useState<InsulinDose[]>([]);
  const [hypos, setHypos] = useState<HypoEvent[]>([]);
  const [labs, setLabs] = useState<LabA1c[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [notes, setNotes] = useState<DayNote[]>([]);
  const [ketones, setKetones] = useState<KetoneReading[]>([]);
  const [lastExtras, setLastExtras] = useState<ExtraRec[]>([]);
  const [unknown, setUnknown] = useState<UnknownKind[]>([]);
  const [showNotes, setShowNotes] = useState(true);
  const [profStyle, setProfStyle] = useState<"simple" | "agp">("simple");
  const [lock, setLock] = useState<"loading" | "locked" | "corrupt" | "open">("loading");
  const [lockErr, setLockErr] = useState("");
  const [isProtected, setIsProtected] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const [backupErr, setBackupErr] = useState("");
  const vaultRef = useRef<Vault | null>(null); const envRef = useRef<Envelope | null>(null);
  const latestRef = useRef<Store>(normalizeStore({})); const loadedRef = useRef(false);
  const lastActivity = useRef(Date.now()); const backupTimer = useRef<number>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState(30);
  const [showIns, setShowIns] = useState(true);
  const [history, setHistory] = useState<Snap[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ port: PortInfo; known: boolean } | null>(null);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [busy, setBusy] = useState(false); const [bytes, setBytes] = useState(0); const [err, setErr] = useState(""); const [log, setLog] = useState<DlLog | null>(null);
  const [lastDl, setLastDl] = useState<{ ok: boolean; text: string } | null>(null);
  const toastTimer = useRef<number>(); const prevPorts = useRef<string[] | null>(null); const busyRef = useRef(false);

  const say = useCallback((m: string) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 6000); }, []);
  const setPrefs = useCallback((p: Partial<Prefs>) => setPrefsState((prev) => { const n = { ...prev, ...p }; savePrefs(n); return n; }), []);
  useEffect(() => {
    applyPrefs(prefs);
    if (prefs.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)"), on = () => applyPrefs(prefs);
    mq.addEventListener("change", on); return () => mq.removeEventListener("change", on);
  }, [prefs]);

  const applyStore = useCallback((st: Store) => {
    setReadings(st.readings); setInsulin(st.insulin); setHypos(st.hypos); setLabs(st.labs); setSupplies(st.supplies); setNotes(st.notes); setKetones(st.ketones ?? []); setUnknown([]); setLastExtras([]); setSettings(st.settings); setHistory([]);
  }, []);
  const serialize = useCallback(async (st: Store) => {
    const plain = JSON.stringify(st);
    return vaultRef.current ? JSON.stringify(await seal(vaultRef.current, plain)) : plain;
  }, []);
  const runBackup = useCallback(async (raw: string) => {
    const b = latestRef.current.settings.backup; if (!b?.enabled || !b.folder) return;
    const who = prefsRef.current.profile === "default" ? "" : prefsRef.current.profile + "-";
    try { await api.writeBackup(b.folder, `diabass6-backup-${who}${localIso(Date.now()).slice(0, 10)}.json`, raw, b.keep); setPrefs({ lastBackup: localIso(Date.now()) }); setBackupErr(""); }
    catch (e) { setBackupErr(String(e)); }
  }, [setPrefs]);
  const persist = useCallback(async (st: Store) => {
    const raw = await serialize(st); await api.saveRaw(raw);
    window.clearTimeout(backupTimer.current);
    if (st.settings.backup?.enabled) backupTimer.current = window.setTimeout(() => runBackup(raw), 20000);
  }, [serialize, runBackup]);

  /* ---- start-up (and profile switching): load, recover from a damaged file, or ask for the password ---- */
  const bootProfile = useCallback(async () => {
    const raw = await api.loadRaw();
    if (!raw.trim()) { applyStore(normalizeStore({})); loadedRef.current = true; setLoaded(true); setLock("open"); return; }
    let parsed: unknown, recovered = false;
    try { parsed = JSON.parse(raw); } catch {
      try { parsed = JSON.parse(await api.loadBak()); recovered = true; } catch { setLockErr("The saved data is damaged and there is no usable recovery copy."); setLock("corrupt"); return; }
    }
    if (isEnvelope(parsed)) { envRef.current = parsed; setLock("locked"); return; }
    applyStore(normalizeStore(parsed)); loadedRef.current = true; setLoaded(true); setLock("open");
    if (recovered) say("Your data file was damaged, so the app recovered from its previous save. Recent changes may be missing. Check your backups if so.");
  }, [applyStore, say]);
  useEffect(() => { api.setProfile(prefsRef.current.profile); bootProfile(); }, [bootProfile]);

  latestRef.current = { readings, insulin, hypos, labs, supplies, notes, ketones, settings };
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => { persist(latestRef.current).catch((e) => say("Couldn't save your data: " + e)); }, 400);
    return () => clearTimeout(t);
  }, [readings, insulin, hypos, labs, supplies, notes, ketones, settings, loaded, persist, say]);
  useEffect(() => { const f = () => { if (loadedRef.current) persist(latestRef.current).catch(() => {}); }; window.addEventListener("beforeunload", f); return () => window.removeEventListener("beforeunload", f); }, [persist]);

  /* ---- password protection ---- */
  const unlock = useCallback(async (pw: string) => {
    const env = envRef.current; if (!env) throw new Error("Nothing to unlock.");
    const { plaintext, vault } = await openEnvelope(env, pw);
    vaultRef.current = vault; setIsProtected(true);
    applyStore(normalizeStore(JSON.parse(plaintext))); loadedRef.current = true; setLoaded(true); setLock("open"); setLockErr(""); lastActivity.current = Date.now();
  }, [applyStore]);
  const lockNow = useCallback(async () => {
    if (!vaultRef.current) return;
    setLoaded(false); loadedRef.current = false;           // stop saving first so the emptied state is never written
    try { const raw = await serialize(latestRef.current); await api.saveRaw(raw); envRef.current = JSON.parse(raw); }
    catch (e) { setLoaded(true); loadedRef.current = true; say("Couldn't lock the app: " + e); return; }
    window.clearTimeout(backupTimer.current);
    vaultRef.current = null; applyStore(normalizeStore({})); setView("dash"); setLock("locked");
  }, [serialize, applyStore, say]);
  const lockRef = useRef(lockNow); lockRef.current = lockNow;
  const verifyPassword = async (pw: string) => {
    const env = JSON.parse(await api.loadRaw()); if (!isEnvelope(env)) throw new Error("Protection isn't on.");
    await openEnvelope(env, pw);
  };
  const enableProtection = useCallback(async (pw: string) => { vaultRef.current = await createVault(pw); setIsProtected(true); await persist(latestRef.current); }, [persist]);
  const changePassword = async (oldPw: string, newPw: string) => { await verifyPassword(oldPw); vaultRef.current = await createVault(newPw); await persist(latestRef.current); };
  const disableProtection = async (pw: string) => { await verifyPassword(pw); vaultRef.current = null; setIsProtected(false); await persist(latestRef.current); };
  const startFresh = useCallback(async () => {
    await api.quarantine(); envRef.current = null; vaultRef.current = null; setIsProtected(false);
    applyStore(normalizeStore({})); loadedRef.current = true; setLoaded(true); setLock("open"); setLockErr("");
  }, [applyStore]);
  const switchProfile = useCallback(async (id: string) => {
    if (id === prefsRef.current.profile) return;
    if (loadedRef.current) {
      setLoaded(false); loadedRef.current = false;           // nothing may be saved while the state is being swapped
      try { await persist(latestRef.current); } catch (e) { setLoaded(true); loadedRef.current = true; say("Couldn't save before switching: " + e); return; }
    }
    window.clearTimeout(backupTimer.current);
    vaultRef.current = null; envRef.current = null; setIsProtected(false); applyStore(normalizeStore({})); setLockErr("");
    setLock("loading"); setView("dash"); api.setProfile(id); setPrefs({ profile: id }); await bootProfile();
  }, [persist, applyStore, bootProfile, setPrefs, say]);
  const addProfile = useCallback(async (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "profile";
    const ids = new Set(prefsRef.current.profiles.map((p) => p.id)); let id = base, n = 2; while (ids.has(id) || id === "default") id = `${base}-${n++}`;
    setPrefs({ profiles: [...prefsRef.current.profiles, { id, name }] }); await switchProfile(id);
  }, [setPrefs, switchProfile]);
  const deleteProfile = useCallback(async (id: string) => {
    if (id === "default" || id === prefsRef.current.profile) return;
    await api.quarantine(id); setPrefs({ profiles: prefsRef.current.profiles.filter((p) => p.id !== id) }); say("Profile removed. Its data file was kept, renamed.");
  }, [setPrefs, say]);
  const enableBackups = useCallback(async () => { const f = await api.defaultBackupDir(); setSettings((x) => ({ ...x, backup: { enabled: true, folder: f, keep: 30 } })); }, []);
  const backupNow = useCallback(async () => { await runBackup(await serialize(latestRef.current)); }, [runBackup, serialize]);
  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); }, evs = ["mousemove", "keydown", "mousedown", "touchstart", "wheel"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => { if (vaultRef.current && prefs.autoLockMin > 0 && !busyRef.current && Date.now() - lastActivity.current > prefs.autoLockMin * 60000) lockRef.current(); }, 15000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [prefs.autoLockMin]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const set = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  const push = useCallback(() => setHistory((h) => [...h.slice(-19), { r: readings, i: insulin, h: hypos, l: labs, sp: supplies, n: notes, k: ketones }]), [readings, insulin, hypos, labs, supplies, notes, ketones]);
  const commit = useCallback((next: Reading[], msg?: string, extra?: Extra) => {
    push(); setReadings(next);
    if (extra?.insulin) setInsulin(extra.insulin); if (extra?.hypos) setHypos(extra.hypos); if (extra?.labs) setLabs(extra.labs); if (extra?.supplies) setSupplies(extra.supplies); if (extra?.notes) setNotes(extra.notes); if (extra?.ketones) setKetones(extra.ketones);
    if (msg) say(msg);
  }, [push, say]);
  const commitI = useCallback((next: InsulinDose[], msg?: string) => { push(); setInsulin(next); if (msg) say(msg); }, [push, say]);
  const commitH = useCallback((next: HypoEvent[], msg?: string) => { push(); setHypos(next); if (msg) say(msg); }, [push, say]);
  const commitL = useCallback((next: LabA1c[], msg?: string) => { push(); setLabs(next); if (msg) say(msg); }, [push, say]);
  const commitS = useCallback((next: Supply[], msg?: string) => { push(); setSupplies(next); if (msg) say(msg); }, [push, say]);
  const commitK = useCallback((next: KetoneReading[], msg?: string) => { push(); setKetones(next); if (msg) say(msg); }, [push, say]);
  const commitN = useCallback((next: DayNote[], msg?: string) => { push(); setNotes(next); if (msg) say(msg); }, [push, say]);
  const undo = useCallback(() => {
    setHistory((h) => { if (!h.length) return h; const p = h[h.length - 1]; setReadings(p.r); setInsulin(p.i); setHypos(p.h); setLabs(p.l); setSupplies(p.sp); setNotes(p.n); setKetones(p.k); say("Undone"); return h.slice(0, -1); });
  }, [say]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "z" && !(e.target as HTMLElement).matches("input,select,textarea")) { e.preventDefault(); undo(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [undo]);

  /* ---- meter download (shared by the Meter tab, the plug-in prompt and auto-download) ---- */
  useEffect(() => { let off = () => {}; api.onProgress(setBytes).then((f) => (off = f)); return () => off(); }, []);
  const runRaw = useCallback(async (port: string, protocol: Protocol, known?: string[], fast?: boolean) => {
    setBusy(true); busyRef.current = true; setErr(""); setBytes(0);
    try { const r = await api.download(port, protocol, known, fast); setLog(r); return r; }
    catch (e) { setErr(String(e)); return null; } finally { setBusy(false); busyRef.current = false; }
  }, []);
  /** Normally a fast download: records arrive newest first, so reading stops once it reaches readings already stored.
   *  A full read happens the first time, after 30 days, or on request. */
  const startDownload = useCallback(async (portName: string, usbId?: string, opts?: { full?: boolean }) => {
    const off = settings.clockOffsetMin ?? 0;
    const lastFull = settings.lastFullDownload ? new Date(settings.lastFullDownload).getTime() : 0;
    const fast = !opts?.full && lastFull > 0 && Date.now() - lastFull < 30 * 864e5 && readings.length > 0;
    const known = fast ? readings.filter((x) => x.flag !== "control").map((x) => `${shiftTs(x.ts, -off).slice(0, 16)}|${Math.round(x.mgdl)}`) : undefined;
    const r = await runRaw(portName, settings.protocol, known, fast); if (!r) return;
    if (r.error && !r.bytes) { setErr(r.error); setLastDl({ ok: false, text: r.error }); say(r.error); return; }
    const parsed = parseMeterText(r.text, settings.dateOrder).map((x) => (off ? { ...x, ts: shiftTs(x.ts, off) } : x));
    const extras = r.extras ?? [], kinds = extras.length ? applyKinds(extras, settings.kindMap) : { ketones: [] as KetoneReading[], unknown: [] as UnknownKind[] };
    if (extras.length) setLastExtras(extras); if (extras.length || !fast) setUnknown(kinds.unknown);
    const unknownNote = kinds.unknown.length ? ` The meter also stored ${kinds.unknown.reduce((a, k) => a + k.count, 0)} records of a kind I don't recognise: see Ketone & HCT.` : "";
    if (!parsed.length) {
      const head = (r.hex || "").split("\n")[0];
      const text = (r.bytes ? `Received ${r.bytes} bytes but couldn't recognise any readings. ${head}` : head.startsWith("TaiDoc") ? `The meter answered but no readings could be imported. ${head}` : "The meter sent nothing. Check the cable, that the meter is on, and the baud rate.") + unknownNote;
      setLastDl({ ok: false, text }); say("No readings imported. See the summary on the Meter tab."); return;
    }
    const m = mergeReadings(readings, parsed), mk = mergeKetones(ketones, kinds.ketones), nowIso = localIso(Date.now());
    setSettings((x) => ({ ...x, lastDownload: nowIso, ...(usbId ? { meterId: usbId } : {}), ...(!r.stoppedEarly && !r.error ? { lastFullDownload: nowIso } : {}), ...(r.clockJumps?.length ? { clockWarnings: r.clockJumps } : !fast ? { clockWarnings: [] } : {}) }));
    const how = r.stoppedEarly ? "Fast download: only the newest records were read." : "Full download.";
    setLastDl({ ok: true, text: `${how} ${m.added} new reading${m.added === 1 ? "" : "s"}. ${(r.hex || "").split("\n")[0]}${unknownNote}` });
    const future = parsed.some((x) => x.ts > localIso(Date.now() + 10 * 60e3));
    commit(m.all, `${how} ${m.added} new, ${m.dupes} already stored.${mk.added ? ` ${mk.added} ketone readings.` : ""}${future ? " Some readings are dated in the future, so the meter clock may be wrong. See Meter > Check clock." : ""}${r.clockJumps?.length ? " The meter's records are out of date order. See Data quality." : ""}${r.error ? " Warning: " + r.error : ""}`, mk.added ? { ketones: mk.all } : undefined);
  }, [runRaw, settings.protocol, settings.dateOrder, settings.clockOffsetMin, settings.lastFullDownload, settings.kindMap, readings, ketones, commit, say]);
  const assignKind = useCallback((key: string, rule: KindRule) => {
    set({ kindMap: { ...(settings.kindMap ?? {}), [key]: rule } });
    if (rule.as === "ketone") {
      const mk = mergeKetones(ketones, applyKinds(lastExtras.filter((e) => kindKey(e.k2, e.k3) === key), { [key]: rule }).ketones);
      commitK(mk.all, `Saved. ${mk.added} ketone readings added from the last download. A full re-download picks up older ones too.`);
    } else say("Saved. Those records will be ignored from now on.");
    setUnknown((u) => u.filter((x) => x.key !== key));
  }, [settings.kindMap, lastExtras, ketones, set, commitK, say]);
  const startRef = useRef(startDownload); startRef.current = startDownload;

  /** Compares the newest reading on the meter with this computer's clock. The user should have just taken a test. */
  const checkClock = useCallback(async (): Promise<ClockResult> => {
    const r = await runRaw(settings.port, settings.protocol);
    if (!r) return { error: "Couldn't read the meter. Check the port and cable." };
    if (r.error && !r.bytes) return { error: r.error };
    const parsed = parseMeterText(r.text, settings.dateOrder);
    if (!parsed.length) return { error: r.bytes ? "Received data but couldn't recognise any readings." : "The meter sent nothing." };
    const newest = parsed.reduce((a, b) => (a.ts > b.ts ? a : b));
    return { newest: newest.ts, offsetMin: Math.round((Date.now() - new Date(newest.ts).getTime()) / 60000) };
  }, [runRaw, settings.port, settings.protocol, settings.dateOrder]);

  const refreshPorts = useCallback(async (): Promise<PortInfo[]> => {
    try { const p = await api.ports(); setPorts(p); setSettings((s) => { const n = preferredPort(s.port, p); return n === s.port ? s : { ...s, port: n }; }); return p; } catch (e) { setErr(String(e)); return []; }
  }, []);

  const handlePorts = (list: PortInfo[]) => {
    const names = list.map((p) => p.name), prev = prevPorts.current; prevPorts.current = names;
    if (prev === null || settings.autoDownload === "off" || busyRef.current) return;
    const fresh = list.filter((p) => !prev.includes(p.name) && p.id);
    if (!fresh.length) return;
    const p = fresh[0], known = !!settings.meterId && p.id === settings.meterId;
    if (settings.autoDownload === "auto" && known) { say(`Meter detected on ${p.name}. Downloading…`); set({ port: p.name }); setTimeout(() => startRef.current(p.name, p.id), 1500); }
    else setOffer({ port: p, known });
  };
  const handleRef = useRef(handlePorts); handleRef.current = handlePorts;
  useEffect(() => {
    api.ports().then((l) => { setPorts(l); if (prevPorts.current === null) prevPorts.current = l.map((p) => p.name); setSettings((s) => { const n = preferredPort(s.port, l); return n === s.port ? s : { ...s, port: n }; }); }).catch(() => {});
    let off = () => {}; api.onPorts((l) => { setPorts(l); handleRef.current(l); }).then((f) => (off = f)); return () => off();
  }, []);

  /* ---- tray menu, notifications ---- */
  const trayRef = useRef({ port: "", ports: [] as PortInfo[] }); trayRef.current = { port: settings.port, ports };
  useEffect(() => {
    let off = () => {};
    api.onTrayDownload(() => { const { port, ports: ps } = trayRef.current; if (!port) { say("Pick your meter's port on the Meter tab first."); return; } if (busyRef.current) { say("A download is already running."); return; } startRef.current(port, ps.find((p) => p.name === port)?.id); }).then((f) => (off = f));
    return () => off();
  }, [say]);
  useEffect(() => { api.setCloseToTray(prefs.closeToTray); }, [prefs.closeToTray]);
  const remCtx = useRef({ staleDays: 0, supplyAlerts: [] as string[] });
  useEffect(() => {
    const tick = () => {
      if (!loadedRef.current) return;
      const due = dueReminders(new Date(), latestRef.current.settings.reminders, prefsRef.current.fired, remCtx.current);
      if (!due.length) return;
      due.forEach((d) => api.notify(d.title, d.body));
      setPrefs({ fired: markFired(new Date(), prefsRef.current.fired, due.map((d) => d.id)) });
    };
    tick(); const t = setInterval(tick, 30000); return () => clearInterval(t);
  }, [setPrefs]);

  /* ---- derived data ---- */
  const scoped = useMemo(() => (days ? readings.filter((r) => r.ts >= localIso(Date.now() - days * 864e5)) : readings), [readings, days]);
  const insScoped = useMemo(() => (days ? insulin.filter((d) => d.ts >= localIso(Date.now() - days * 864e5)) : insulin), [insulin, days]);
  const prevScoped = useMemo(() => (days ? readings.filter((r) => r.ts >= localIso(Date.now() - 2 * days * 864e5) && r.ts < localIso(Date.now() - days * 864e5)) : []), [readings, days]);
  const stats = useMemo(() => calcStats(scoped, settings.low, settings.high), [scoped, settings.low, settings.high]);
  const prevStats = useMemo(() => calcStats(prevScoped, settings.low, settings.high), [prevScoped, settings.low, settings.high]);
  const patterns = useMemo(() => findPatterns(scoped, insScoped, settings), [scoped, insScoped, settings]);
  const u = unitLabel(settings.unit);
  const todayK = localIso(Date.now()).slice(0, 10);
  const supplyWarn = useMemo(() => supplies.flatMap((sp) => supplyStatus(sp, readings, todayK).alerts.map((a) => `${sp.name}: ${a}`)), [supplies, readings, todayK]);
  const staleDays = settings.lastDownload ? Math.floor((Date.now() - new Date(settings.lastDownload).getTime()) / 864e5) : 0;
  remCtx.current = { staleDays, supplyAlerts: supplyWarn };
  const notesToggle = notes.length > 0 && <label className="row note"><input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />Show notes</label>;
  const showOnboarding = lock === "open" && loaded && !prefs.onboarded && readings.length === 0;
  const insToggle = insulin.length > 0 && <label className="row note"><input type="checkbox" checked={showIns} onChange={(e) => setShowIns(e.target.checked)} />Show insulin</label>;

  if (lock === "loading") return null;
  if (lock === "locked" || lock === "corrupt") return <LockScreen kind={lock} onUnlock={unlock} onStartFresh={startFresh} error={lockErr} profiles={prefs.profiles} profileId={prefs.profile} onSwitch={switchProfile} />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">DIABASS 6<small>Glucose Rx HCT</small></div>
        {prefs.profiles.length > 1 && <select className="profile-pick" aria-label="Profile" value={prefs.profile} onChange={(e) => switchProfile(e.target.value)}>{prefs.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {NAV.map(([id, label, ic]) => <button key={id} className={"nav" + (view === id ? " on" : "")} onClick={() => setView(id)}><span aria-hidden>{ic}</span>{label}</button>)}
        <div className="spacer" />
        <div className="conn"><b>{readings.length} readings · {insulin.length} doses</b>{readings.length ? `${readings[0].ts.slice(0, 10)} → ${readings[readings.length - 1].ts.slice(0, 10)}` : "Connect your meter to begin"}<br />Last download: {ago(settings.lastDownload)}</div>
      </aside>
      <main className="main">
        <div className="head">
          <div><h1>{TITLES[view]}</h1>{view === "dash" && <div className="sub">Control-solution tests are excluded from all statistics.</div>}</div>
          {(view === "dash" || view === "profile" || view === "insulin") && (
            <div className="seg" role="group" aria-label="Period">{PERIODS.map(([l, d]) => <button key={l} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{l}</button>)}</div>
          )}
        </div>

        {view === "dash" && supplyWarn.length > 0 && <div className="banner"><span><b>Supplies:</b> {supplyWarn.join(" · ")}</span><button className="btn" onClick={() => setView("supplies")}>Open Supplies</button></div>}
        {view === "dash" && (!stats ? <Empty go={() => setView("meter")} /> : (<>
          {staleDays >= 7 && <div className="banner"><span>Your last meter download was {staleDays} days ago. Plug in your meter and download to fill the gap.</span><button className="btn primary" onClick={() => setView("meter")}>Go to Meter</button></div>}
          <section className="panel">
            <h2>Time in range ({fmt(settings.low, settings.unit)}–{fmt(settings.high, settings.unit)} {u})</h2>
            <div className="ribbon" aria-hidden>
              <i style={{ flex: stats.low, background: "var(--low)" }} /><i style={{ flex: stats.inr, background: "var(--ok)" }} /><i style={{ flex: stats.high, background: "var(--high)" }} />
            </div>
            <div className="legend">
              <span><span className="dot" style={{ background: "var(--ok)" }} /><b>{stats.inr.toFixed(0)}%</b>in range</span>
              <span><span className="dot" style={{ background: "var(--low)" }} /><b>{stats.low.toFixed(0)}%</b>low</span>
              <span><span className="dot" style={{ background: "var(--high)" }} /><b>{stats.high.toFixed(0)}%</b>high</span>
            </div>
          </section>
          <div className="tiles">
            <Tile k="Average" v={fmt(stats.mean, settings.unit)} u={u} />
            <Tile k="Estimated A1c" v={stats.a1c.toFixed(1)} u="%" />
            <Tile k="Variability (CV)" v={stats.cv.toFixed(0)} u="%" />
            <Tile k="Lowest / highest" v={`${fmt(stats.min, settings.unit)} / ${fmt(stats.max, settings.unit)}`} u="" />
            <Tile k="Tests per day" v={stats.perDay.toFixed(1)} u={`${stats.n} total`} />
          </div>
          <section className="panel"><div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}><h2 style={{ margin: 0 }}>Trend</h2><span className="row">{insToggle}{notesToggle}</span></div><TrendChart readings={scoped} s={settings} doses={showIns ? insScoped : undefined} notes={showNotes ? notes : undefined} /></section>
          <GoalsPanel readings={readings} s={settings} set={set} />
          {days > 0 && <section className="panel"><h2>Compared with the previous {days} days</h2><CompareTable cur={stats} prev={prevStats} s={settings} curLabel={`Last ${days} days`} prevLabel={`Previous ${days} days`} /></section>}
          <section className="panel">
            <h2>Patterns in this period</h2>
            {patterns.length ? patterns.map((p) => <div className="pat" key={p.title}><span className={"pill " + p.level}>{p.level === "watch" ? "Worth a look" : "Note"}</span><div><b>{p.title}</b><div className="note">{p.detail}</div></div></div>)
              : <p className="note" style={{ margin: 0 }}>{scoped.filter((r) => r.flag !== "control").length < 14 ? "Needs at least 14 readings in the period to look for patterns." : "No notable patterns found in this period."}</p>}
            <p className="note" style={{ marginBottom: 0 }}>Automatic observations that describe what happened in your data. They are not medical advice, so bring anything that worries you to your clinician.</p>
          </section>
        </>))}

        {view === "profile" && (<section className="panel">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="seg" role="group" aria-label="Chart style"><button className={profStyle === "simple" ? "on" : ""} onClick={() => setProfStyle("simple")}>Typical day</button><button className={profStyle === "agp" ? "on" : ""} onClick={() => setProfStyle("agp")}>24-hour AGP</button></div>
            {profStyle === "simple" && insToggle}
          </div>
          {profStyle === "simple" ? <>
            <ProfileChart readings={scoped} s={settings} doses={showIns ? insScoped : undefined} />
            <p className="note">Median line with the middle half shaded. Each dot is one reading placed by time of day.</p></> : <>
            <AgpChart readings={scoped} s={settings} />
            <p className="note">The Ambulatory Glucose Profile stacks every day onto one 24-hour curve: the line is the median, the dark band holds the middle 50% of readings and the light band 90%. It is the standard way clinics review meter data.</p></>}
        </section>)}

        {view === "readings" && <ReadingsView readings={readings} notes={notes} s={settings} commit={commit} />}
        {view === "insulin" && <InsulinView insulin={insulin} s={settings} days={days} commitI={commitI} say={say} />}
        {view === "hypo" && <HypoView hypos={hypos} readings={readings} s={settings} set={set} commitH={commitH} say={say} />}
        {view === "calendar" && <CalendarView readings={readings} insulin={insulin} hypos={hypos} notes={notes} s={settings} commitN={commitN} />}
        {view === "notes" && <NotesView notes={notes} commitN={commitN} />}
        {view === "labs" && <LabsView labs={labs} readings={readings} s={settings} commitL={commitL} say={say} />}
        {view === "supplies" && <SuppliesView supplies={supplies} readings={readings} commitS={commitS} say={say} />}
        {view === "monthly" && <MonthlyView readings={readings} insulin={insulin} s={settings} />}
        {view === "ketone" && <KetoneView ketones={ketones} readings={readings} unknown={unknown} assign={assignKind} commitK={commitK} say={say} />}
        {view === "quality" && <QualityView readings={readings} s={settings} commit={commit} />}
        {view === "prepare" && <PrepareView readings={readings} insulin={insulin} hypos={hypos} labs={labs} notes={notes} ketones={ketones} s={settings} set={set} say={say} />}
        {view === "report" && <ReportView readings={readings} insulin={insulin} hypos={hypos} labs={labs} notes={notes} ketones={ketones} s={settings} set={set} say={say} />}
        {view === "meter" && <MeterView s={settings} set={set} ports={ports} refresh={refreshPorts} busy={busy} bytes={bytes} err={err} log={log} runRaw={runRaw} startDownload={startDownload} checkClock={checkClock} lastDl={lastDl} say={say} />}
        {view === "data" && <DataSettings s={settings} set={set} readings={readings} insulin={insulin} hypos={hypos} labs={labs} supplies={supplies} notes={notes} ketones={ketones} commit={commit} say={say} prefs={prefs} setPrefs={setPrefs}
          profileId={prefs.profile} profiles={{ onSwitch: switchProfile, onAdd: addProfile, onDelete: deleteProfile }}
          sec={{ cryptoOk: cryptoAvailable(), isProtected, enable: enableProtection, change: changePassword, disable: disableProtection, lock: () => lockNow(), sealText: async (plain) => JSON.stringify(await seal(vaultRef.current!, plain)) }}
          backup={{ now: backupNow, last: prefs.lastBackup, error: backupErr }} />}
      </main>
      {showOnboarding && <Onboarding s={settings} set={set} finish={() => setPrefs({ onboarded: true })} goMeter={() => setView("meter")} enableBackups={enableBackups} />}
      {(toast || offer) && <div className="stack">
        {offer && <div className="toast" role="alertdialog">
          <div><b>{offer.known ? "Your meter was detected" : "USB serial device detected"}</b><div className="note">{offer.port.name} · {offer.port.kind}</div></div>
          <button className="btn primary sm" onClick={() => { const p = offer.port; setOffer(null); set({ port: p.name }); setTimeout(() => startRef.current(p.name, p.id), 800); }}>Download readings</button>
          <button className="btn sm" onClick={() => setOffer(null)}>Dismiss</button>
        </div>}
        {toast && <div className="toast" role="status">{toast}{history.length > 0 && <button className="btn sm" onClick={undo}>Undo</button>}</div>}
      </div>}
    </div>
  );
}

const Tile = ({ k, v, u }: { k: string; v: string; u: string }) => <div className="tile"><div className="k">{k}</div><div className="v">{v}<span className="u">{u}</span></div></div>;
const Empty = ({ go }: { go: () => void }) => <div className="panel empty"><p>No readings yet.</p><button className="btn primary" onClick={go}>Download from meter</button></div>;

/* ---------------- Readings ---------------- */
function ReadingsView({ readings, notes, s, commit }: { readings: Reading[]; notes: DayNote[]; s: Settings; commit: (r: Reading[], m?: string) => void }) {
  const [tag, setTag] = useState("");
  const tagDays = useMemo(() => new Set(notes.filter((n) => !tag || n.tags.includes(tag)).map((n) => n.ts.slice(0, 10))), [notes, tag]);
  const tagsInUse = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);
  const [q, setQ] = useState(""); const [onlyCtl, setOnlyCtl] = useState(false); const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ ts: string; val: string; meal: string }>({ ts: "", val: "", meal: "" });
  const [band, setBand] = useState(""), [range, setRange] = useState(""), [mealF, setMealF] = useState("");
  const BANDS: Record<string, [number, number]> = { night: [0, 6], morning: [6, 11], midday: [11, 15], afternoon: [15, 19], evening: [19, 24] };
  const shown = useMemo(() => [...readings].reverse().filter((r) => (!onlyCtl || r.flag === "control") && (!tag || tagDays.has(r.ts.slice(0, 10))) && (!q || r.ts.includes(q) || String(Math.round(r.mgdl)) === q)
    && (!band || (hourOf(r) >= BANDS[band][0] && hourOf(r) < BANDS[band][1]))
    && (!range || (range === "low" ? r.mgdl < s.low : range === "ok" ? r.mgdl >= s.low && r.mgdl <= s.high : range === "high" ? r.mgdl > s.high : range === "vlow" ? r.mgdl < 54 : r.mgdl > 250))
    && (!mealF || (mealF === "none" ? !r.meal : r.meal === mealF))).slice(0, 1500), [readings, q, onlyCtl, tag, tagDays, band, range, mealF, s.low, s.high]); // eslint-disable-line
  const begin = (r: Reading) => { setEdit(r.id); setDraft({ ts: r.ts.slice(0, 16), val: fmt(r.mgdl, s.unit), meal: r.meal ?? "" }); };
  const save = (r: Reading) => {
    const v = parseFloat(draft.val); if (!isFinite(v) || !draft.ts) return;
    const mg = s.unit === "mgdl" ? v : v * MMOL;
    commit(readings.map((x) => x.id === r.id ? { ...x, ts: draft.ts + ":00", mgdl: mg, meal: draft.meal as Reading["meal"] } : x).sort((a, b) => a.ts.localeCompare(b.ts)), "Reading updated"); setEdit(null);
  };
  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Filter by date or value" value={q} onChange={(e) => setQ(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px" }} />
        <label className="row"><input type="checkbox" checked={onlyCtl} onChange={(e) => setOnlyCtl(e.target.checked)} />Control tests only</label>
        {tagsInUse.length > 0 && <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Only days tagged" style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}><option value="">Any day</option>{tagsInUse.map((t) => <option key={t} value={t}>Days tagged: {t}</option>)}</select>}
        <select aria-label="Time of day" value={band} onChange={(e) => setBand(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}><option value="">Any time of day</option><option value="night">Overnight 00-06</option><option value="morning">Morning 06-11</option><option value="midday">Midday 11-15</option><option value="afternoon">Afternoon 15-19</option><option value="evening">Evening 19-24</option></select>
        <select aria-label="Value range" value={range} onChange={(e) => setRange(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}><option value="">Any value</option><option value="low">Below range</option><option value="vlow">Below 54 mg/dL</option><option value="ok">In range</option><option value="high">Above range</option><option value="vhigh">Above 250 mg/dL</option></select>
        <select aria-label="Meal tag" value={mealF} onChange={(e) => setMealF(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}><option value="">Any meal tag</option><option value="none">Untagged</option><option value="fasting">Fasting</option><option value="before">Before meal</option><option value="after">After meal</option><option value="bedtime">Bedtime</option></select>
        <span className="note">{shown.length} shown of {readings.length}</span>
      </div>
      {!shown.length ? <div className="empty">Nothing to show.</div> : (
        <table><thead><tr><th>Date & time</th><th>Result ({unitLabel(s.unit)})</th><th>Meal</th><th>Type</th><th /></tr></thead><tbody>
          {shown.map((r) => edit === r.id ? (
            <tr key={r.id}>
              <td><input type="datetime-local" value={draft.ts} onChange={(e) => setDraft({ ...draft, ts: e.target.value })} /></td>
              <td><input size={6} value={draft.val} onChange={(e) => setDraft({ ...draft, val: e.target.value })} /></td>
              <td><select value={draft.meal} onChange={(e) => setDraft({ ...draft, meal: e.target.value })}><option value="">—</option><option value="fasting">Fasting</option><option value="before">Before meal</option><option value="after">After meal</option><option value="bedtime">Bedtime</option></select></td>
              <td /><td className="row"><button className="btn sm primary" onClick={() => save(r)}>Save</button><button className="btn sm" onClick={() => setEdit(null)}>Cancel</button></td>
            </tr>
          ) : (
            <tr key={r.id}>
              <td>{r.ts.slice(0, 16).replace("T", "  ")}</td>
              <td className="val" style={{ color: r.flag === "control" ? "var(--muted)" : r.mgdl < s.low ? "var(--low)" : r.mgdl > s.high ? "var(--high)" : "var(--ok)" }}>{fmt(r.mgdl, s.unit)}</td>
              <td><select aria-label="Meal tag" value={r.meal ?? ""} onChange={(e) => commit(readings.map((x) => (x.id === r.id ? { ...x, meal: e.target.value as Reading["meal"] } : x)), "Meal tag updated")} style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 6px", color: r.meal ? "var(--text)" : "var(--muted)" }}><option value="">—</option><option value="fasting">Fasting</option><option value="before">Before meal</option><option value="after">After meal</option><option value="bedtime">Bedtime</option></select></td>
              <td>{r.flag === "control" ? <span className="chip ctl">Control solution</span> : <span className="chip">Blood</span>}{r.hct ? <span className="note" style={{ marginLeft: 8 }}>HCT {r.hct}%</span> : null}{r.note && <span className="note" style={{ marginLeft: 8 }}>{r.note}</span>}</td>
              <td className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn sm" onClick={() => commit(readings.map((x) => x.id === r.id ? { ...x, flag: x.flag === "control" ? "none" : "control" } : x), r.flag === "control" ? "Unmarked as control test" : "Marked as control test")}>{r.flag === "control" ? "Unflag" : "Flag control"}</button>
                <button className="btn sm" onClick={() => begin(r)}>Edit</button>
                <button className="btn sm danger" onClick={() => commit(readings.filter((x) => x.id !== r.id), "Reading deleted")}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
    </section>
  );
}

/* ---------------- Meter ---------------- */
const fullLog = (l: DlLog) => `${l.error ? "ERROR: " + l.error + "\n\n" : ""}--- trace ---\n${l.hex}\n\n--- readings text ---\n${l.text}`;
const fmtOffset = (min: number) => { const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60; return `${min < 0 ? "−" : "+"}${h ? h + " h " : ""}${m} min`; };
function MeterView({ s, set, ports, refresh, busy, bytes, err, log, runRaw, startDownload, checkClock, lastDl, say }: {
  s: Settings; set: (p: Partial<Settings>) => void; ports: PortInfo[]; refresh: () => Promise<PortInfo[]>; busy: boolean; bytes: number; err: string; log: DlLog | null;
  runRaw: (port: string, p: Protocol) => Promise<DlLog | null>; startDownload: (port: string, usbId?: string, opts?: { full?: boolean }) => void; checkClock: () => Promise<ClockResult>; lastDl: { ok: boolean; text: string } | null; say: (m: string) => void;
}) {
  const [clock, setClock] = useState<ClockResult | null>(null);
  const [cable, setCable] = useState<{ ok: boolean; t: string } | null>(null);
  const [probe, setProbe] = useState<string[]>([]); const [showHex, setShowHex] = useState(false);
  const P = s.protocol; const setP = (p: Partial<typeof P>) => set({ protocol: { ...P, ...p } });
  const probeBauds = async () => {
    setProbe([]);
    for (const baud of [9600, 19200, 38400, 57600, 115200, 4800, 2400]) {
      setProbe((p) => [...p, `${baud}: testing…`]);
      const r = await runRaw(s.port, { ...P, baud, maxMs: 6000, idleMs: 1500 });
      setProbe((p) => [...p.slice(0, -1), `${baud}: ${r ? r.bytes + " bytes" : "error"}`]);
      if (r && r.bytes > 0) { setP({ baud }); break; }
    }
  };
  return (<>
    {lastDl && !busy && <div className="banner" style={lastDl.ok ? { background: "color-mix(in srgb, var(--ok) 12%, var(--surface))", borderColor: "color-mix(in srgb, var(--ok) 40%, var(--line))" } : undefined}>
      <span><b>Last download:</b> {lastDl.text}</span>
      {!lastDl.ok && <span className="note">Press "Copy support report" below and send it over.</span>}
    </div>}
    <section className="panel">
      <h2>Download all readings</h2>
      <div className="row" style={{ marginBottom: 14 }}>
        <PortPicker ports={ports} value={s.port} onChange={(p) => set({ port: p })} rescan={refresh} baud={s.protocol.baud} />
        <button className="btn primary" disabled={busy || !s.port} onClick={() => startDownload(s.port, ports.find((p) => p.name === s.port)?.id)} style={{ alignSelf: "end" }}>{busy ? "Reading meter…" : "Download new readings"}</button>
        <button className="btn" disabled={busy || !s.port} title="Read every record the meter holds, ignoring what is already stored" onClick={() => startDownload(s.port, ports.find((p) => p.name === s.port)?.id, { full: true })} style={{ alignSelf: "end" }}>Full re-download</button>
      </div>
      {busy && <div className="bar"><i style={{ width: `${Math.min(100, 8 + bytes / 40)}%` }} /></div>}
      {busy && <p className="note">{bytes} bytes received. Keep the meter connected until this finishes.</p>}
      {err && <p style={{ color: "var(--high)" }}>{err}</p>}
      {!api.isTauri() && <p className="note">Running in a browser: USB access only works in the installed desktop app.</p>}
      <p className="note">The app reads everything the meter sends, not just the most recent results, then merges it into your history and skips any reading already stored.</p>
    </section>

    <section className="panel">
      <h2>Cable access</h2>
      <p className="note" style={{ marginTop: 0 }}>Linux needs permission to open the meter's USB cable. This asks for your password once and sets it up. Unplug and replug the cable afterwards.</p>
      <div className="row"><button className="btn" onClick={async () => { setCable(null); try { setCable({ ok: true, t: await api.installCableAccess() }); } catch (e) { setCable({ ok: false, t: String(e) }); } }}>Set up cable access</button>{cable && <span style={{ color: cable.ok ? "var(--ok)" : "var(--high)" }}>{cable.t}</span>}</div>
    </section>
    <UsbDiagnostics say={say} />
    <SupportReport ports={ports} selected={s.port} protocol={s.protocol} log={log} err={err} say={say} />

    <section className="panel">
      <h2>When the meter is plugged in</h2>
      <div className="row">
        <label className="field">Action
          <select value={s.autoDownload} onChange={(e) => set({ autoDownload: e.target.value as Settings["autoDownload"] })}>
            <option value="ask">Ask me whether to download</option><option value="auto">Download automatically (my meter only)</option><option value="off">Do nothing</option>
          </select></label>
        <span className="note" style={{ maxWidth: 520 }}>{s.meterId ? `Your meter is remembered as USB device ${s.meterId}, learned from your last successful download.` : "Automatic download starts working after one successful manual download, so the app knows which USB device is your meter."}</span>
      </div>
    </section>

    <section className="panel">
      <h2>Meter clock</h2>
      <p className="note" style={{ marginTop: 0 }}>Every reading's date and time comes from the meter's own clock, and it can drift or reset when the battery is changed. To check it: do a test on the meter right now (a control-solution test is fine), wait for the result, then press Check.</p>
      <div className="row">
        <button className="btn" disabled={busy || !s.port} onClick={async () => setClock(await checkClock())}>Check meter clock</button>
        {!!s.clockOffsetMin && <span className="note">Correction applied to new downloads: {fmtOffset(s.clockOffsetMin)} <button className="btn sm" onClick={() => set({ clockOffsetMin: 0 })}>Remove</button></span>}
      </div>
      {clock && (() => {
        if (clock.error) return <p style={{ color: "var(--high)", marginBottom: 0 }}>{clock.error}</p>;
        const o = clock.offsetMin!, a = Math.abs(o);
        if (a <= 5) return <p style={{ color: "var(--ok)", marginBottom: 0 }}>The meter clock matches this computer (within {Math.max(a, 1)} min).</p>;
        if (a > 36 * 60) return <p style={{ marginBottom: 0 }}>The newest reading on the meter is dated {clock.newest!.slice(0, 16).replace("T", " ")}, which is too far from now to judge the clock. Do a test just before checking.</p>;
        return <div style={{ marginTop: 12 }}>
          <p style={{ color: "var(--low)", margin: "0 0 8px" }}>The meter appears to be <b>{fmtOffset(a).slice(1)} {o > 0 ? "behind" : "ahead of"}</b> this computer (its newest reading is stamped {clock.newest!.slice(0, 16).replace("T", " ")}).</p>
          <div className="row"><button className="btn primary" onClick={() => { set({ clockOffsetMin: o }); setClock(null); say(`New downloads will be shifted by ${fmtOffset(o)}.`); }}>Correct future downloads by {fmtOffset(o)}</button><button className="btn" onClick={() => setClock(null)}>Leave as is</button></div>
          <p className="note">Readings already stored are not changed. Best fix: set the time on the meter itself, then run this check again.</p></div>;
      })()}
    </section>

    <section className="panel">
      <h2>Connection settings</h2>
      <div className="grid">
        <label className="field">Baud rate<select value={P.baud} onChange={(e) => setP({ baud: +e.target.value })}>{[2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => <option key={b}>{b}</option>)}</select></label>
        <label className="field">Request command (hex, optional)<input value={P.commandHex} placeholder="e.g. 52 45 41 44 0D" onChange={(e) => setP({ commandHex: e.target.value })} /></label>
        <label className="field">Stop after silence (ms)<input type="number" value={P.idleMs} onChange={(e) => setP({ idleMs: +e.target.value })} /></label>
        <label className="field">Hard time limit (ms)<input type="number" value={P.maxMs} onChange={(e) => setP({ maxMs: +e.target.value })} /></label>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy || !s.port} onClick={probeBauds}>Auto-detect baud rate</button>
        {probe.length > 0 && <span className="note">{probe.join("  ·  ")}</span>}
      </div>
    </section>

    {log && <section className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Capture log</h2>
        <div className="row">{log.text.trim() && <button className="btn sm" onClick={() => setShowHex(!showHex)}>{showHex ? "Show readings" : "Show trace"}</button>}
          <button className="btn sm" onClick={() => navigator.clipboard.writeText(fullLog(log)).then(() => say("Copied"))}>Copy all</button>
          <button className="btn sm" onClick={async () => say("Saved to " + await api.exportFile(`diabass6-capture-${Date.now()}.txt`, fullLog(log)))}>Save</button></div>
      </div>
      {log.error && <p style={{ color: "var(--high)", marginTop: 0 }}>{log.error}</p>}
      <div className="log">{((showHex || !log.text.trim()) ? log.hex : log.text) || "(nothing was received)"}</div>
    </section>}
  </>);
}

/* ---------------- Insulin ---------------- */
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function InsulinView({ insulin, s, days, commitI, say }: { insulin: InsulinDose[]; s: Settings; days: number; commitI: (d: InsulinDose[], m?: string) => void; say: (m: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<{ name: string; rows: number; added: number; dupes: number; skipped: string[] } | null>(null);
  const [draft, setDraft] = useState({ ts: localNow(), units: "", kind: "" });
  const [edit, setEdit] = useState<string | null>(null); const [eu, setEu] = useState("");
  const scoped = useMemo(() => { if (!days) return insulin; const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 19); return insulin.filter((d) => d.ts >= cut); }, [insulin, days]);
  const stat = useMemo(() => {
    if (!scoped.length) return null;
    const byDay = new Map<string, number>(); scoped.forEach((d) => byDay.set(d.ts.slice(0, 10), (byDay.get(d.ts.slice(0, 10)) ?? 0) + d.units));
    const tot = scoped.reduce((a, d) => a + d.units, 0), n = byDay.size;
    return { avg: tot / n, per: scoped.length / n, tot, last: scoped[scoped.length - 1] };
  }, [scoped]);

  const [pending, setPending] = useState<{ name: string; res: InsulinParse } | null>(null); const [withPrimes, setWithPrimes] = useState(false);
  const finish = (name: string, res: InsulinParse, includePrimes: boolean) => {
    const m = mergeInsulin(insulin, includePrimes ? [...res.doses, ...res.primes] : res.doses);
    setReport({ name, rows: res.rows, added: m.added, dupes: m.dupes, skipped: res.skipped });
    if (m.added) commitI(m.all, `Imported ${m.added} insulin doses${m.dupes ? ` (${m.dupes} already stored)` : ""}`);
    else say(res.doses.length ? "Every dose in that file was already stored." : "No doses could be read from that file.");
    setPending(null);
  };
  const onFile = async (f: File) => {
    const res = parseInsulinCsv(await f.text(), s.dateOrder);
    // When the file needed assumptions (units scale, priming shots), show them and ask first.
    if (res.assumptions.length && res.doses.length) { setWithPrimes(false); setPending({ name: f.name, res }); return; }
    finish(f.name, res, false);
  };
  const preview = useMemo(() => {
    if (!pending) return null;
    const ds = [...pending.res.doses].sort((a, b) => a.ts.localeCompare(b.ts)), per = new Map<string, number>();
    ds.forEach((d) => per.set(d.ts.slice(0, 10), (per.get(d.ts.slice(0, 10)) ?? 0) + d.units));
    const tot = [...per.values()].sort((a, b) => a - b);
    return { from: ds[0].ts.slice(0, 10), to: ds[ds.length - 1].ts.slice(0, 10), days: per.size, median: tot[Math.floor(tot.length / 2)], max: tot[tot.length - 1], recent: ds.slice(-6).reverse() };
  }, [pending]);
  const add = () => {
    const u = parseFloat(draft.units.replace(",", "."));
    if (!isFinite(u) || u <= 0 || u > 500 || !draft.ts) { say("Enter a dose between 0 and 500 units."); return; }
    commitI([...insulin, { id: newId(), ts: draft.ts + ":00", units: Math.round(u * 100) / 100, kind: draft.kind.trim() }].sort((a, b) => a.ts.localeCompare(b.ts)), "Dose added");
    setDraft({ ts: localNow(), units: "", kind: draft.kind });
  };
  const shown = useMemo(() => [...insulin].reverse().slice(0, 1500), [insulin]);

  return (<>
    <section className="panel">
      <h2>Import insulin from CSV</h2>
      <div className="row">
        <button className="btn primary" onClick={() => file.current?.click()}>Choose CSV file…</button>
        <input ref={file} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <button className="btn" disabled={!insulin.length} onClick={async () => say("Saved to " + await api.exportFile(`diabass6-insulin-${new Date().toISOString().slice(0, 10)}.csv`, insulinToCsv(insulin)))}>Export insulin CSV</button>
      </div>
      {pending && preview && <div className="banner" style={{ display: "block", marginBottom: 12 }}>
        <b>Check before importing {pending.name}</b>
        <ul style={{ margin: "8px 0", lineHeight: 1.6 }}>{pending.res.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <p style={{ margin: "0 0 8px" }}>That gives <b>{pending.res.doses.length + (withPrimes ? pending.res.primes.length : 0)} doses</b> on {preview.days} days between {preview.from} and {preview.to}. Typical daily total <b>{preview.median} units</b> (highest {preview.max}). The newest ones:</p>
        <table style={{ marginBottom: 8 }}><tbody>{preview.recent.map((d) => <tr key={d.id}><td>{d.ts.slice(0, 16).replace("T", "  ")}</td><td className="val">{d.units} units</td><td className="note">{d.note ?? ""}</td></tr>)}</tbody></table>
        <p className="note" style={{ margin: "0 0 10px" }}>If the daily total looks wrong (for example ten times too big or small), cancel and tell me what the column means.</p>
        {pending.res.primes.length > 0 && <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={withPrimes} onChange={(e) => setWithPrimes(e.target.checked)} />Also import the {pending.res.primes.length} priming records as doses (not recommended)</label>}
        <div className="row"><button className="btn primary" onClick={() => finish(pending.name, pending.res, withPrimes)}>Import</button><button className="btn" onClick={() => { setPending(null); say("Import cancelled"); }}>Cancel</button></div>
      </div>}
      <p className="note">Needs a date and time (or one combined column) plus a units column. A header row is optional; commas, semicolons and tabs all work. Optional columns: type (basal, bolus or a brand name) and note. Insulin-pen exports with a column called Value (in tenths of a unit) are recognised; you are shown what was assumed before anything is saved, and priming shots are left out. Doses already stored are skipped. Dates use your meter date order setting: {s.dateOrder === "dmy" ? "day/month/year" : "month/day/year"}.</p>
      {report && <div style={{ marginTop: 10 }}>
        <p style={{ margin: "0 0 6px" }}><b>{report.name}</b>: {report.rows} rows, {report.added} new, {report.dupes} already stored, {report.skipped.length} skipped.</p>
        {report.skipped.length > 0 && <div className="log">{report.skipped.slice(0, 8).join("\n")}{report.skipped.length > 8 ? `\n…and ${report.skipped.length - 8} more` : ""}</div>}
      </div>}
    </section>

    {stat && <div className="tiles">
      <Tile k="Average daily total" v={stat.avg.toFixed(1)} u="units" />
      <Tile k="Doses per day" v={stat.per.toFixed(1)} u="" />
      <Tile k="Total in period" v={String(Math.round(stat.tot * 10) / 10)} u="units" />
      <Tile k="Last dose" v={String(stat.last.units)} u={`units · ${stat.last.ts.slice(5, 16).replace("T", " ")}`} />
    </div>}
    <section className="panel"><h2>Daily total (units)</h2><DoseChart doses={scoped} /></section>

    <section className="panel">
      <h2>Add a dose</h2>
      <div className="row">
        <label className="field">Date & time<input type="datetime-local" value={draft.ts} onChange={(e) => setDraft({ ...draft, ts: e.target.value })} /></label>
        <label className="field">Units<input size={6} inputMode="decimal" value={draft.units} onChange={(e) => setDraft({ ...draft, units: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
        <label className="field">Type (optional)<input value={draft.kind} placeholder="basal, bolus…" onChange={(e) => setDraft({ ...draft, kind: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
        <button className="btn primary" style={{ alignSelf: "end" }} onClick={add}>Add</button>
      </div>
    </section>

    <section className="panel">
      <h2>Dose log ({insulin.length})</h2>
      {!shown.length ? <div className="empty">No insulin doses yet. Import a CSV above.</div> : (
        <table><thead><tr><th>Date & time</th><th>Units</th><th>Type</th><th>Note</th><th /></tr></thead><tbody>
          {shown.map((d) => (
            <tr key={d.id}>
              <td>{d.ts.slice(0, 16).replace("T", "  ")}</td>
              <td className="val">{edit === d.id ? <input size={5} value={eu} autoFocus onChange={(e) => setEu(e.target.value)} /> : d.units}</td>
              <td>{d.kind ? <span className="chip">{d.kind}</span> : <span className="note">—</span>}</td>
              <td className="note">{d.note ?? ""}</td>
              <td className="row" style={{ justifyContent: "flex-end" }}>
                {edit === d.id ? (<>
                  <button className="btn sm primary" onClick={() => { const u = parseFloat(eu.replace(",", ".")); if (isFinite(u) && u > 0 && u <= 500) { commitI(insulin.map((x) => x.id === d.id ? { ...x, units: Math.round(u * 100) / 100 } : x), "Dose updated"); setEdit(null); } }}>Save</button>
                  <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
                </>) : (<>
                  <button className="btn sm" onClick={() => { setEdit(d.id); setEu(String(d.units)); }}>Edit</button>
                  <button className="btn sm danger" onClick={() => commitI(insulin.filter((x) => x.id !== d.id), "Dose deleted")}>Delete</button>
                </>)}
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
      {insulin.length > 0 && <div style={{ marginTop: 12 }}><button className="btn danger sm" onClick={() => window.confirm("Delete all insulin doses? You can undo this until you close the app.") && commitI([], "All insulin doses deleted")}>Delete all doses</button></div>}
    </section>
  </>);
}
