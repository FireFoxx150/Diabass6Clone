import { DEFAULT_SETTINGS, Protocol, Store } from "./types";
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
async function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
export interface PortInfo { name: string; kind: string; id: string; }
export interface ExtraRec { ts: string; value: number; k2: number; k3: number; }
export interface DlResult { text: string; hex: string; bytes: number; error?: string; extras?: ExtraRec[]; stoppedEarly?: boolean; clockJumps?: string[]; }
export interface UsbIf { class: string; driver: string; nodes: string[]; }
export interface UsbDev { id: string; name: string; interfaces: UsbIf[]; }
export interface BackupInfo { name: string; size: number; modified: number; }

/** Fills in anything missing so older saves and imports always load. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeStore(s: any): Store {
  return {
    readings: (s.readings ?? []).map((r: any) => { const m = typeof r.note === "string" && /^Haematocrit (\d+)%$/.exec(r.note); if (!m) return r; const { note: _n, ...rest } = r; return { ...rest, hct: +m[1] }; }),
    insulin: s.insulin ?? [], hypos: s.hypos ?? [], labs: s.labs ?? [], supplies: s.supplies ?? [], notes: s.notes ?? [], ketones: s.ketones ?? [],
    settings: { ...DEFAULT_SETTINGS, ...s.settings, protocol: { ...DEFAULT_SETTINGS.protocol, ...(s.settings?.protocol ?? {}) } },
  };
}

let profile = "default";   // which person's data file is open
const lsKey = () => (profile === "default" ? "diabass6" : `diabass6:${profile}`);

export const api = {
  isTauri,
  setProfile(id: string) { profile = id || "default"; },
  /* ---- storage (the app may hand this encrypted text; it never needs to know) ---- */
  async loadRaw(): Promise<string> { return isTauri() ? inv<string>("load_store", { profile }) : localStorage.getItem(lsKey()) ?? ""; },
  async loadBak(): Promise<string> { return isTauri() ? inv<string>("load_store_bak", { profile }) : ""; },
  async saveRaw(raw: string) { if (isTauri()) await inv("save_store", { profile, data: raw }); else localStorage.setItem(lsKey(), raw); },
  async quarantine(forProfile?: string): Promise<string> { const p = forProfile ?? profile; if (isTauri()) return inv<string>("quarantine_store", { profile: p }); localStorage.removeItem(p === "default" ? "diabass6" : `diabass6:${p}`); return ""; },
  /* ---- backups ---- */
  async defaultBackupDir(): Promise<string> { return isTauri() ? inv<string>("default_backup_dir") : ""; },
  async writeBackup(folder: string, name: string, content: string, keep: number): Promise<string> { return inv<string>("write_backup", { folder, name, content, keep }); },
  async listBackups(folder: string): Promise<BackupInfo[]> { return isTauri() ? inv<BackupInfo[]>("list_backups", { folder }) : []; },
  async readTextFile(path: string): Promise<string> { return inv<string>("read_text_file", { path }); },
  async pickFolder(defaultPath?: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, multiple: false, defaultPath: defaultPath || undefined });
    return typeof r === "string" ? r : null;
  },
  async pickBackupFile(defaultPath?: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, defaultPath: defaultPath || undefined, filters: [{ name: "DIABASS 6 backup", extensions: ["json"] }] });
    return typeof r === "string" ? r : null;
  },
  /** Saves a PDF: native "Save as" dialog in the desktop app, a normal download in a browser. Returns the path, or null if cancelled. */
  async savePdf(defaultName: string, bytes: Uint8Array): Promise<string | null> {
    if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: defaultName, filters: [{ name: "PDF document", extensions: ["pdf"] }] });
      if (!path) return null;
      return inv<string>("save_bytes", { path: path.toLowerCase().endsWith(".pdf") ? path : path + ".pdf", data: Array.from(bytes) });
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })); a.download = defaultName; a.click();
    return defaultName;
  },
  /* ---- meter ---- */
  async ports(): Promise<PortInfo[]> { return isTauri() ? inv<PortInfo[]>("list_ports") : []; },
  async testPort(port: string, baud: number): Promise<string> { return inv<string>("test_port", { port, baud }); },
  async usbDevices(): Promise<UsbDev[]> { return isTauri() ? inv<UsbDev[]>("usb_devices") : []; },
  async download(port: string, p: Protocol, known?: string[], fast?: boolean): Promise<DlResult> {
    return inv<DlResult>("download", { port, baud: p.baud, commandHex: p.commandHex, idleMs: p.idleMs, maxMs: p.maxMs, known: known ?? null, fast: fast ?? false });
  },
  async installCableAccess(): Promise<string> { return inv<string>("install_cable_access"); },
  async setCloseToTray(on: boolean) { if (isTauri()) await inv("set_close_to_tray", { on }); },
  async onTrayDownload(cb: () => void): Promise<() => void> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen("tray-download", () => cb());
  },
  async notify(title: string, body: string): Promise<void> {
    try {
      if (isTauri()) {
        const n = await import("@tauri-apps/plugin-notification");
        let ok = await n.isPermissionGranted(); if (!ok) ok = (await n.requestPermission()) === "granted";
        if (ok) n.sendNotification({ title, body });
      } else if (typeof Notification !== "undefined") {
        if (Notification.permission === "default") await Notification.requestPermission();
        if (Notification.permission === "granted") new Notification(title, { body });
      }
    } catch { /* notifications are best effort */ }
  },
  async onPorts(cb: (p: PortInfo[]) => void): Promise<() => void> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<PortInfo[]>("ports-changed", (e) => cb(e.payload));
  },
  async onProgress(cb: (bytes: number) => void): Promise<() => void> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<number>("dl-progress", (e) => cb(e.payload));
  },
  async exportFile(name: string, content: string): Promise<string> {
    if (isTauri()) return inv<string>("export_file", { name, content });
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content])); a.download = name; a.click(); return name;
  },
};
