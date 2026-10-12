import { useState } from "react";
import { api, PortInfo, UsbDev } from "../lib/api";
import { Protocol } from "../lib/types";

/** Plain-language reading of what the kernel reports for each USB device. */
export function interpretUsb(devs: UsbDev[]): { tone: "ok" | "warn" | "bad"; text: string }[] {
  const out: { tone: "ok" | "warn" | "bad"; text: string }[] = [];
  if (!devs.length) return [{ tone: "bad", text: "The computer reports no USB devices at all (apart from the built-in hubs). Try another USB port or cable, and make sure the meter is switched on and in its PC/connect mode." }];
  for (const d of devs) {
    const label = `${d.name || "Unnamed device"} (${d.id})`;
    const nodes = d.interfaces.flatMap((i) => i.nodes);
    const serial = nodes.filter((n) => /^tty(USB|ACM)/.test(n)), hid = nodes.filter((n) => n.startsWith("hidraw"));
    if (d.id === "10c4:ea80") out.push({ tone: "ok", text: `${label} is the Silicon Labs CP2110 bridge used inside GlucoRx / TaiDoc meter cables${hid.length ? ` (${hid.map((n) => "/dev/" + n).join(", ")})` : ""}. It appears in the port list above as "hid:/dev/hidrawN". Pick it, press Test port, then Download.` });
    else if (serial.length) out.push({ tone: "ok", text: `${label} is a serial device: ${serial.map((n) => "/dev/" + n).join(", ")}. Pick that port above.` });
    else if (hid.length) out.push({ tone: "bad", text: `${label} presents itself as an HID device (${hid.map((n) => "/dev/" + n).join(", ")}), not a serial port. The app's serial download cannot talk to it yet. Copy this report and send it to me so HID support can be added.` });
    else if (d.interfaces.some((i) => i.class === "08")) out.push({ tone: "warn", text: `${label} looks like a USB drive. If this is the meter, check whether it has a separate PC or data mode.` });
    else if (d.interfaces.length && d.interfaces.every((i) => !i.driver)) out.push({ tone: "bad", text: `${label} is detected but no driver is attached, so no port was created. Run "dmesg | tail" right after plugging it in and send me what it says.` });
    else out.push({ tone: "warn", text: `${label} is detected (${d.interfaces.map((i) => i.driver || "no driver").join(", ")}) but exposes no serial port. Probably not the meter.` });
  }
  return out;
}
export function usbReport(devs: UsbDev[]): string {
  if (!devs.length) return "No USB devices reported.";
  return devs.map((d) => `${d.id} ${d.name}\n` + d.interfaces.map((i, n) => `  interface ${n}: class ${i.class || "?"}, driver ${i.driver || "none"}, nodes ${i.nodes.join(" ") || "none"}`).join("\n")).join("\n");
}

export function PortPicker({ ports, value, onChange, rescan, baud }: { ports: PortInfo[]; value: string; onChange: (p: string) => void; rescan: () => Promise<PortInfo[]>; baud: number }) {
  const [scanning, setScanning] = useState(false), [note, setNote] = useState(""), [showAll, setShowAll] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null), [testing, setTesting] = useState(false);
  const usb = ports.filter((p) => p.id), other = ports.filter((p) => !p.id);
  const visible = showAll ? [...usb, ...other] : usb;
  const doScan = async () => {
    setScanning(true); setTest(null);
    try { const l = await rescan(); const u = l.filter((p) => p.id).length; setNote(`Checked at ${new Date().toLocaleTimeString()}: found ${u} USB serial port${u === 1 ? "" : "s"}${l.length - u ? ` and ${l.length - u} other` : ""}.`); }
    catch (e) { setNote("Scan failed: " + e); } finally { setScanning(false); }
  };
  const doTest = async () => { setTesting(true); setTest(null); try { setTest({ ok: true, text: await api.testPort(value, baud) }); } catch (e) { setTest({ ok: false, text: String(e) }); } finally { setTesting(false); } };
  return (<>
    <label className="field">Serial port
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 260 }}>
        {!visible.length && <option value="">{usb.length ? "—" : "No USB serial port found"}</option>}
        {value && !visible.find((p) => p.name === value) && <option value={value}>{value}</option>}
        {visible.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.kind}</option>)}
      </select>
    </label>
    <button className="btn" disabled={scanning} onClick={doScan} style={{ alignSelf: "end" }}>{scanning ? "Scanning…" : "Rescan"}</button>
    <button className="btn" disabled={!value || testing} onClick={doTest} style={{ alignSelf: "end" }}>{testing ? "Testing…" : "Test port"}</button>
    {other.length > 0 && <label className="row note" style={{ alignSelf: "end" }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Also show {other.length} non-USB port{other.length === 1 ? "" : "s"}</label>}
    <div style={{ flexBasis: "100%" }}>
      {note && <div className="note">{note}</div>}
      <div className="note">Switch the meter off, then plug the cable in. The meter should show "PC" or "USB".</div>
      {!usb.length && <div className="note" style={{ color: "var(--low)" }}>No USB serial port is present. Plug in the meter's cable, wait a few seconds and press Rescan. If it still doesn't appear, use "What does the computer see?" below.</div>}
      {test && <div style={{ color: test.ok ? "var(--ok)" : "var(--high)", marginTop: 4 }}>{test.text}</div>}
    </div>
  </>);
}

export function UsbDiagnostics({ say }: { say: (m: string) => void }) {
  const [devs, setDevs] = useState<UsbDev[] | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const run = async () => { setBusy(true); setErr(""); try { setDevs(await api.usbDevices()); } catch (e) { setErr(String(e)); } finally { setBusy(false); } };
  const tone = { ok: "var(--ok)", warn: "var(--low)", bad: "var(--high)" } as const;
  return (
    <section className="panel">
      <h2>What does the computer see?</h2>
      <p className="note" style={{ marginTop: 0 }}>Lists the USB devices the system reports and how each one is exposed. Plug the meter in first. Useful when no port appears or every port gives an error.</p>
      <button className="btn" disabled={busy} onClick={run}>{busy ? "Looking…" : "Check USB devices"}</button>
      {err && <p style={{ color: "var(--high)" }}>{err}</p>}
      {devs && <div style={{ marginTop: 12 }}>
        {interpretUsb(devs).map((l, i) => <p key={i} style={{ margin: "0 0 6px", color: tone[l.tone] }}>{l.text}</p>)}
        <div className="log" style={{ marginTop: 8 }}>{usbReport(devs)}</div>
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(usbReport(devs)).then(() => say("Copied"))}>Copy report</button>
      </div>}
    </section>
  );
}

/** One click to collect everything needed to diagnose a meter that connects but doesn't give readings. */
export function SupportReport({ ports, selected, protocol, log, err, say }: { ports: PortInfo[]; selected: string; protocol: Protocol; log: { text: string; hex: string; bytes: number; error?: string } | null; err: string; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const build = async () => {
    let usb = "(not available)"; try { usb = usbReport(await api.usbDevices()); } catch (e) { usb = "error: " + e; }
    return [`DIABASS 6 support report  ${new Date().toISOString()}`, `Selected port: ${selected || "(none)"}`, `Protocol settings: ${JSON.stringify(protocol)}`,
      `Ports:\n${ports.map((p) => `  ${p.name}  ${p.kind}  ${p.id}`).join("\n") || "  (none)"}`, `USB devices:\n${usb}`,
      `Last error: ${err || (log?.error ?? "") || "(none)"}`, `Last download (${log ? log.bytes + " bytes" : "none"}):`, log ? `--- trace ---\n${log.hex}\n--- readings text ---\n${log.text}` : "(no download attempted yet)"].join("\n\n");
  };
  return (
    <section className="panel">
      <h2>Support report</h2>
      <p className="note" style={{ marginTop: 0 }}>Collects the port list, USB devices, settings and the last download's trace in one go. It contains no readings other than the dates and values the meter returned.</p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await navigator.clipboard.writeText(await build()); say("Support report copied"); } finally { setBusy(false); } }}>Copy support report</button>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { say("Saved to " + (await api.exportFile(`diabass6-support-${Date.now()}.txt`, await build()))); } finally { setBusy(false); } }}>Save as file</button>
      </div>
    </section>
  );
}
