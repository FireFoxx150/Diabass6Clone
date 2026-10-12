// Password protection: AES-256-GCM with a key derived from the password by PBKDF2-SHA256 (Web Crypto).
// The password is never stored. Forget it and the data cannot be recovered.
const enc = new TextEncoder(), dec = new TextDecoder();
export const ITER = 600_000;

function b64(u8: Uint8Array): string { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s: string): Uint8Array { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

export interface Envelope { diabass6: "encrypted"; v: 1; kdf: "PBKDF2-SHA256"; iter: number; salt: string; iv: string; data: string; }
export interface Vault { key: CryptoKey; salt: Uint8Array; iter: number; }

export const isEnvelope = (x: unknown): x is Envelope => !!x && typeof x === "object" && (x as Envelope).diabass6 === "encrypted" && typeof (x as Envelope).data === "string";
export const cryptoAvailable = () => typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.getRandomValues === "function";

async function deriveKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function createVault(password: string): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(password, salt, ITER), salt, iter: ITER };
}
export async function seal(v: Vault, plaintext: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, v.key, enc.encode(plaintext)));
  return { diabass6: "encrypted", v: 1, kdf: "PBKDF2-SHA256", iter: v.iter, salt: b64(v.salt), iv: b64(iv), data: b64(ct) };
}
export async function openEnvelope(env: Envelope, password: string): Promise<{ plaintext: string; vault: Vault }> {
  if (env.v !== 1 || !(env.iter >= 100_000 && env.iter <= 5_000_000)) throw new Error("This file uses an unsupported format.");
  const salt = unb64(env.salt), key = await deriveKey(password, salt, env.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) as BufferSource }, key, unb64(env.data) as BufferSource);
    return { plaintext: dec.decode(pt), vault: { key, salt, iter: env.iter } };
  } catch { throw new Error("Wrong password, or the file is damaged."); }
}
