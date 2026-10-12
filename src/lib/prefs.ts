// Display preferences live outside the (possibly encrypted) data store so they apply on the lock screen too.
export interface ProfileInfo { id: string; name: string; }
export interface Prefs {
  theme: "dark" | "light" | "system"; text: "normal" | "large" | "xlarge"; autoLockMin: number; lastBackup?: string;
  profile: string; profiles: ProfileInfo[]; onboarded: boolean; closeToTray: boolean; fired?: { date: string; ids: string[] };
}
export const DEFAULT_PREFS: Prefs = { theme: "dark", text: "normal", autoLockMin: 15, profile: "default", profiles: [{ id: "default", name: "Me" }], onboarded: false, closeToTray: false };
const KEY = "diabass6.prefs";
export function loadPrefs(): Prefs { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULT_PREFS; } }
export function savePrefs(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }
export function applyPrefs(p: Prefs) {
  const dark = p.theme === "dark" || (p.theme === "system" && !window.matchMedia("(prefers-color-scheme: light)").matches);
  const r = document.documentElement;
  r.dataset.theme = dark ? "dark" : "light";
  r.style.setProperty("--ts", p.text === "xlarge" ? "1.4" : p.text === "large" ? "1.2" : "1");
}
