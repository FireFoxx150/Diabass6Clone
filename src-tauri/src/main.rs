#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::Serialize;
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

mod taidoc;

#[derive(Serialize, Clone)]
struct PortInfo { name: String, kind: String, id: String }
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct DlResult { text: String, hex: String, bytes: usize, error: String, extras: Vec<ExtraOut>, stopped_early: bool, clock_jumps: Vec<String> }
#[derive(Serialize)]
struct ExtraOut { ts: String, value: u32, k2: u8, k3: u8 }

/// GlucoRx / TaiDoc meter cables contain a Silicon Labs CP2110 "HID to UART" bridge. It is not a serial port
/// to Linux: it appears as /dev/hidrawN, and the UART inside is configured with HID feature reports.
#[cfg(target_os = "linux")]
mod hid {
    use super::taidoc::Link;
    use hidapi::{HidApi, HidDevice};
    use std::ffi::CString;
    pub const VID: u16 = 0x10c4;
    pub const PID: u16 = 0xea80;
    pub const UDEV_RULE: &str = "echo 'SUBSYSTEM==\"hidraw\", ATTRS{idVendor}==\"10c4\", ATTRS{idProduct}==\"ea80\", MODE=\"0666\", TAG+=\"uaccess\"' | sudo tee /etc/udev/rules.d/60-diabass6-hid.rules && sudo udevadm control --reload && sudo udevadm trigger";

    pub fn list() -> Vec<(String, String)> {
        let Ok(api) = HidApi::new() else { return vec![] };
        api.device_list().filter(|d| d.vendor_id() == VID && d.product_id() == PID)
            .map(|d| (d.path().to_string_lossy().into_owned(), d.product_string().unwrap_or("CP2110").to_string())).collect()
    }
    pub struct Cp2110 { dev: HidDevice }
    pub fn open(path: &str, baud: u32) -> Result<Cp2110, String> {
        let api = HidApi::new().map_err(|e| format!("HID access failed: {e}"))?;
        let c = CString::new(path).map_err(|e| e.to_string())?;
        let dev = api.open_path(&c).map_err(|e| format!("Couldn't open {path}: {e}. This is normally a permissions problem. Allow access to the cable with:\n{UDEV_RULE}\nthen unplug and replug it."))?;
        let b = baud.to_be_bytes();
        let step = |what: &str, r: Result<(), hidapi::HidError>| r.map_err(|e| format!("Couldn't {what} on the cable's UART bridge: {e}"));
        step("enable the UART", dev.send_feature_report(&[0x41, 0x01]))?;
        step("set the baud rate", dev.send_feature_report(&[0x50, b[0], b[1], b[2], b[3], 0x00, 0x00, 0x03, 0x00]))?;   // no parity, no flow control, 8 data bits, 1 stop bit
        step("clear the buffers", dev.send_feature_report(&[0x43, 0x03]))?;
        Ok(Cp2110 { dev })
    }
    impl Link for Cp2110 {
        fn send(&mut self, data: &[u8]) -> Result<(), String> {
            for chunk in data.chunks(63) {
                let mut rep = Vec::with_capacity(chunk.len() + 1);
                rep.push(chunk.len() as u8);            // the report ID is the byte count
                rep.extend_from_slice(chunk);
                self.dev.write(&rep).map_err(|e| format!("Writing to the cable failed: {e}"))?;
            }
            Ok(())
        }
        fn recv(&mut self, buf: &mut [u8], timeout_ms: u64) -> Result<usize, String> {
            let mut b = [0u8; 64];
            let n = self.dev.read_timeout(&mut b, timeout_ms as i32).map_err(|e| format!("Reading from the cable failed: {e}"))?;
            if n == 0 { return Ok(0); }
            let len = (b[0] as usize).min(n - 1).min(buf.len()).min(63);
            buf[..len].copy_from_slice(&b[1..1 + len]);
            Ok(len)
        }
    }
}

const HID_BAUDS: [u32; 4] = [19200, 9600, 38400, 115200];
const HID_HELP: &str = "Switch the meter OFF, then plug the cable in: the meter should show \"PC\" or \"USB\". Use the cable that came with, or was sold for, this meter.";

#[cfg(target_os = "linux")]
fn hid_download(app: &AppHandle, path: &str, known: &HashSet<String>, fast: bool) -> Result<DlResult, String> {
    let mut notes: Vec<String> = vec![];
    let mut last = String::from("the meter did not answer");
    for baud in HID_BAUDS {
        notes.push(format!("== trying {baud} baud =="));
        let mut link = hid::open(path, baud)?;
        let mut prog = |i: usize, n: usize| { let _ = app.emit("dl-progress", i * 4000 / n.max(1)); };
        match taidoc::run(&mut link, &mut prog, known, fast) {
            Ok(s) => {
                let mut text = String::new();
                for r in &s.readings { text.push_str(&format!("{} {} {} mg/dL {}{}\n", &r.ts[..10], &r.ts[11..16], r.mgdl, r.meal, r.hct.map(|h| format!(" hct {h}%")).unwrap_or_default())); }
                let mut trace = vec![format!("TaiDoc protocol at {baud} baud. Model reply: {}. Meter clock: {}. The meter reports {} stored results; {} glucose readings read ({} haematocrit values), {} other records skipped.", s.model, s.meter_clock.clone().unwrap_or("unreadable".into()), s.declared, s.readings.len(), s.hct_seen, s.skipped_other)];
                if let Some(n) = s.stopped_early { trace.push(format!("Fast download: stopped after {n} records because six readings in a row were already stored. Use \"Full re-download\" to read everything.")); }
                let extras: Vec<ExtraOut> = s.extras.iter().map(|e| ExtraOut { ts: e.ts.clone(), value: e.value, k2: e.k2, k3: e.k3 }).collect();
                let (stopped_early, clock_jumps) = (s.stopped_early.is_some(), s.clock_jumps.clone());
                trace.extend(notes); trace.extend(s.trace);
                let error = s.error.unwrap_or_default();
                return Ok(DlResult { bytes: text.len(), text, hex: trace.join("\n"), error, extras, stopped_early, clock_jumps });
            }
            Err(f) => { last = f.error.clone(); notes.extend(f.trace); if !f.error.contains("no reply") && !f.error.contains("no valid reply") { break; } }
        }
    }
    Ok(DlResult { hex: notes.join("\n"), error: format!("The cable was opened, but the meter didn't respond as a TaiDoc/GlucoRx meter ({last}). {HID_HELP} The capture log below shows exactly what was tried."), ..Default::default() })
}
#[cfg(not(target_os = "linux"))]
fn hid_download(_app: &AppHandle, _path: &str, _known: &HashSet<String>, _fast: bool) -> Result<DlResult, String> { Err("HID meter cables are only supported on Linux in this build.".into()) }

#[cfg(target_os = "linux")]
fn hid_probe(path: &str) -> Result<String, String> {
    let mut why = String::new();
    for baud in HID_BAUDS {
        let mut link = hid::open(path, baud)?;
        match taidoc::probe(&mut link) { Ok(m) => return Ok(format!("The meter answered at {baud} baud (model reply {m}). Ready to download.")), Err(f) => why = f.error }
    }
    Err(format!("The cable opened but the meter didn't answer ({why}). {HID_HELP}"))
}
#[cfg(not(target_os = "linux"))]
fn hid_probe(_path: &str) -> Result<String, String> { Err("HID meter cables are only supported on Linux in this build.".into()) }

/// Legacy motherboard UARTs (/dev/ttyS0..) are listed even when nothing exists behind them; opening one always fails with an I/O error.
fn is_phantom(name: &str) -> bool {
    let base = name.rsplit('/').next().unwrap_or(name);
    base.starts_with("ttyS") && !Path::new("/sys/class/tty").join(base).join("device").exists()
}

fn explain_port_error(port: &str, msg: &str) -> String {
    let m = msg.to_lowercase();
    let hint = if m.contains("permission") {
        "You don't have permission to use this port. Run: sudo usermod -aG dialout $USER, then log out and back in."
    } else if m.contains("input/output") || m.contains("os error 5") || m.contains("i/o error") {
        if port.contains("ttyS") { "This is a built-in serial port with nothing connected to it. Your meter's cable should appear as /dev/ttyUSB0 or /dev/ttyACM0 once it is plugged in." }
        else { "The port opened but the device didn't respond. Unplug and replug the cable and check 'dmesg | tail'. ModemManager or brltty can also grab USB serial devices: try 'sudo systemctl stop ModemManager'." }
    } else if m.contains("busy") {
        "Another program is using this port. ModemManager is a common one: try 'sudo systemctl stop ModemManager'."
    } else if m.contains("no such") || m.contains("not found") {
        "That port has gone away. Unplug and replug the cable, then press Rescan."
    } else { return msg.to_string(); };
    format!("{msg}. {hint}")
}

fn collect_ports() -> Vec<PortInfo> {
    let mut v: Vec<PortInfo> = serialport::available_ports().unwrap_or_default().into_iter().filter(|p| !is_phantom(&p.port_name)).map(|p| {
        let (kind, id) = match p.port_type {
            serialport::SerialPortType::UsbPort(u) => (
                format!("USB {:04x}:{:04x}{}", u.vid, u.pid, u.product.map(|s| format!(" {s}")).unwrap_or_default()),
                format!("{:04x}:{:04x}", u.vid, u.pid),
            ),
            serialport::SerialPortType::PciPort => ("PCI".to_string(), String::new()),
            serialport::SerialPortType::BluetoothPort => ("Bluetooth".to_string(), String::new()),
            _ => ("Serial".to_string(), String::new()),
        };
        PortInfo { name: p.port_name, kind, id }
    }).collect();
    #[cfg(target_os = "linux")]
    for (path, product) in hid::list() { v.push(PortInfo { name: format!("hid:{path}"), kind: format!("{product} (GlucoRx/TaiDoc HID cable)"), id: "10c4:ea80".into() }); }
    v.sort_by_key(|p| (p.id.is_empty(), p.name.clone()));   // USB devices first
    v
}

#[tauri::command]
fn list_ports() -> Result<Vec<PortInfo>, String> { Ok(collect_ports()) }

/// Opens the port and listens briefly, to tell "can't open it" apart from "nothing to say".
#[tauri::command]
fn test_port(port: String, baud: u32) -> Result<String, String> {
    if let Some(path) = port.strip_prefix("hid:") { return hid_probe(path); }
    let mut p = serialport::new(&port, baud).timeout(Duration::from_millis(400)).open().map_err(|e| explain_port_error(&port, &e.to_string()))?;
    let _ = p.write_data_terminal_ready(true);
    let mut b = [0u8; 64];
    match p.read(&mut b) {
        Ok(n) if n > 0 => Ok(format!("Opened {port} at {baud} baud and received {n} bytes straight away.")),
        Ok(_) => Ok(format!("Opened {port} at {baud} baud. Nothing was sent, which is normal until the meter has data to send.")),
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Ok(format!("Opened {port} at {baud} baud. Nothing was sent, which is normal until the meter has data to send.")),
        Err(e) => Err(explain_port_error(&port, &format!("Reading from the port failed: {e}"))),
    }
}

#[derive(Serialize, Clone)]
struct UsbIf { class: String, driver: String, nodes: Vec<String> }
#[derive(Serialize, Clone)]
struct UsbDev { id: String, name: String, interfaces: Vec<UsbIf> }
fn trimmed(p: &Path) -> String { fs::read_to_string(p).map(|s| s.trim().to_string()).unwrap_or_default() }

/// Lists USB devices as the Linux kernel sees them, with the driver and device nodes (ttyUSB0, ttyACM0, hidraw0...) behind each interface.
fn read_usb_devices(root: &Path) -> Vec<UsbDev> {
    let mut out = vec![];
    let Ok(rd) = fs::read_dir(root) else { return out };
    let mut names: Vec<String> = rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    for n in names.iter().filter(|n| !n.contains(':')) {
        let d = root.join(n);
        let (vid, pid) = (trimmed(&d.join("idVendor")), trimmed(&d.join("idProduct")));
        if vid.is_empty() || vid == "1d6b" { continue; }   // skip root hubs
        let name = [trimmed(&d.join("manufacturer")), trimmed(&d.join("product"))].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
        let prefix = format!("{n}:");
        let mut interfaces = vec![];
        for i in names.iter().filter(|i| i.starts_with(&prefix)) {
            let ip = root.join(i);
            let driver = fs::read_link(ip.join("driver")).ok().and_then(|l| l.file_name().map(|f| f.to_string_lossy().into_owned())).unwrap_or_default();
            let mut nodes: Vec<String> = vec![];
            if let Ok(rd2) = fs::read_dir(&ip) {
                for e in rd2.filter_map(|e| e.ok()) {
                    let f = e.file_name().to_string_lossy().into_owned();
                    if f.starts_with("ttyUSB") || f.starts_with("ttyACM") { nodes.push(f.clone()); }
                    if f.starts_with("0003:") {
                        if let Ok(r3) = fs::read_dir(e.path().join("hidraw")) { nodes.extend(r3.filter_map(|x| x.ok()).map(|x| x.file_name().to_string_lossy().into_owned())); }
                    }
                    if f == "tty" || f == "hidraw" || f == "usbmisc" {
                        if let Ok(r3) = fs::read_dir(e.path()) { nodes.extend(r3.filter_map(|x| x.ok()).map(|x| x.file_name().to_string_lossy().into_owned())); }
                    }
                }
            }
            nodes.sort(); nodes.dedup();
            interfaces.push(UsbIf { class: trimmed(&ip.join("bInterfaceClass")), driver, nodes });
        }
        out.push(UsbDev { id: format!("{vid}:{pid}"), name, interfaces });
    }
    out
}
#[tauri::command]
fn usb_devices() -> Vec<UsbDev> { read_usb_devices(Path::new("/sys/bus/usb/devices")) }

fn parse_hex(s: &str) -> Result<Vec<u8>, String> {
    let clean: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() % 2 != 0 { return Err("Hex command has an odd number of digits".into()); }
    (0..clean.len()).step_by(2).map(|i| u8::from_str_radix(&clean[i..i + 2], 16).map_err(|e| e.to_string())).collect()
}

#[tauri::command]
async fn download(app: AppHandle, port: String, baud: u32, command_hex: String, idle_ms: u64, max_ms: u64, known: Option<Vec<String>>, fast: Option<bool>) -> Result<DlResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = port.strip_prefix("hid:") {
            let known: HashSet<String> = known.unwrap_or_default().into_iter().collect();
            return hid_download(&app, path, &known, fast.unwrap_or(false));
        }
        let mut p = serialport::new(&port, baud).timeout(Duration::from_millis(150)).open().map_err(|e| explain_port_error(&port, &e.to_string()))?;
        let _ = p.write_data_terminal_ready(true);
        let _ = p.write_request_to_send(true);
        let _ = p.clear(serialport::ClearBuffer::Input);
        std::thread::sleep(Duration::from_millis(150));
        for cmd in command_hex.split(';').filter(|c| !c.trim().is_empty()) {
            let bytes = parse_hex(cmd)?;
            p.write_all(&bytes).map_err(|e| explain_port_error(&port, &format!("Writing to the port failed: {e}")))?;
            let _ = p.flush();
            std::thread::sleep(Duration::from_millis(400));
        }
        let (start, mut last) = (Instant::now(), Instant::now());
        let (mut data, mut buf, mut reported) = (Vec::<u8>::new(), [0u8; 1024], 0usize);
        loop {
            match p.read(&mut buf) {
                Ok(n) if n > 0 => { data.extend_from_slice(&buf[..n]); last = Instant::now(); }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => return Err(explain_port_error(&port, &format!("Reading from the port failed: {e}"))),
            }
            if data.len() / 256 != reported / 256 { reported = data.len(); let _ = app.emit("dl-progress", data.len()); }
            if !data.is_empty() && last.elapsed() > Duration::from_millis(idle_ms) { break; }
            if start.elapsed() > Duration::from_millis(max_ms) { break; }
        }
        let _ = app.emit("dl-progress", data.len());
        let hex = data.chunks(16).map(|c| c.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ")).collect::<Vec<_>>().join("\n");
        Ok(DlResult { text: String::from_utf8_lossy(&data).into_owned(), hex, bytes: data.len(), ..Default::default() })
    }).await.map_err(|e| e.to_string())?
}

/// The default profile keeps using store.json, so existing installs carry on unchanged.
fn store_file(profile: &str) -> String {
    let id: String = profile.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    if id.is_empty() || id == "default" { "store.json".into() } else { format!("store-{id}.json") }
}
fn store_path(app: &AppHandle, profile: &str) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.join(store_file(profile)))
}
#[tauri::command]
fn load_store(app: AppHandle, profile: String) -> Result<String, String> { Ok(fs::read_to_string(store_path(&app, &profile)?).unwrap_or_default()) }
#[tauri::command]
fn save_store(app: AppHandle, profile: String, data: String) -> Result<(), String> {
    let p = store_path(&app, &profile)?; let tmp = p.with_extension("tmp");
    // Keep a recovery copy of the previous good file, refreshed at most every 30 minutes.
    let bak = p.with_extension("json.bak");
    let stale = fs::metadata(&bak).and_then(|m| m.modified()).map(|t| t.elapsed().map(|d| d.as_secs() > 1800).unwrap_or(true)).unwrap_or(true);
    if p.exists() && stale { let _ = fs::copy(&p, &bak); }
    fs::write(&tmp, data).map_err(|e| e.to_string())?; fs::rename(tmp, p).map_err(|e| e.to_string())
}
#[tauri::command]
fn load_store_bak(app: AppHandle, profile: String) -> Result<String, String> { Ok(fs::read_to_string(store_path(&app, &profile)?.with_extension("json.bak")).unwrap_or_default()) }
/// Moves an unreadable (or forgotten-password) store aside instead of deleting it.
#[tauri::command]
fn quarantine_store(app: AppHandle, profile: String) -> Result<String, String> {
    let p = store_path(&app, &profile)?;
    if !p.exists() { return Ok(String::new()); }
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let q = p.with_file_name(format!("{}.corrupt-{t}.json", store_file(&profile).trim_end_matches(".json")));
    fs::rename(&p, &q).map_err(|e| e.to_string())?;
    Ok(q.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct BackupInfo { name: String, size: u64, modified: u64 }
fn is_backup_name(n: &str) -> bool { n.starts_with("diabass6-backup-") && n.ends_with(".json") && !n.contains('/') && !n.contains('\\') }

#[tauri::command]
fn default_backup_dir(app: AppHandle) -> Result<String, String> {
    Ok(app.path().document_dir().map_err(|e| e.to_string())?.join("DIABASS6").join("Backups").to_string_lossy().into_owned())
}
/// Writes one dated backup file atomically, then deletes the oldest ones beyond `keep`.
#[tauri::command]
fn write_backup(folder: String, name: String, content: String, keep: usize) -> Result<String, String> {
    if !is_backup_name(&name) { return Err("Bad backup file name".into()); }
    let dir = PathBuf::from(&folder);
    fs::create_dir_all(&dir).map_err(|e| format!("Can't use the backup folder: {e}"))?;
    let path = dir.join(&name); let tmp = path.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| format!("Can't write the backup: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = fs::read_dir(&dir).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| is_backup_name(n)).collect();
    names.sort();
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for n in names { groups.entry(n[..n.len().saturating_sub(15)].to_string()).or_default().push(n); }   // one group per profile
    if keep > 0 { for (_, v) in groups { if v.len() > keep { for old in &v[..v.len() - keep] { let _ = fs::remove_file(dir.join(old)); } } } }
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
fn list_backups(folder: String) -> Result<Vec<BackupInfo>, String> {
    let rd = match fs::read_dir(&folder) { Ok(r) => r, Err(_) => return Ok(vec![]) };
    let mut out: Vec<BackupInfo> = rd.filter_map(|e| e.ok()).filter_map(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        if !is_backup_name(&name) { return None; }
        let m = e.metadata().ok()?;
        let modified = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        Some(BackupInfo { name, size: m.len(), modified })
    }).collect();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if p.extension().and_then(|e| e.to_str()) != Some("json") { return Err("Only .json backup files can be opened".into()); }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}
#[tauri::command]
fn save_bytes(path: String, data: Vec<u8>) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if p.extension().and_then(|e| e.to_str()) != Some("pdf") { return Err("Only .pdf files can be saved this way".into()); }
    fs::write(&p, data).map_err(|e| e.to_string())?;
    Ok(path)
}
#[tauri::command]
fn export_file(app: AppHandle, name: String, content: String) -> Result<String, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("DIABASS6");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "-_.".contains(*c)).collect();
    let path = dir.join(safe); fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// `diabass6 --probe`: talk to the first GlucoRx/TaiDoc cable and print everything, for diagnosing without the interface.
#[cfg(target_os = "linux")]
fn probe_cli() {
    let cables = hid::list();
    if cables.is_empty() { println!("No CP2110 (10c4:ea80) HID cable found. Is it plugged in and the meter switched off?"); return; }
    for (path, product) in cables {
        println!("Cable: {product} at {path}");
        for baud in HID_BAUDS {
            println!("\n== {baud} baud ==");
            let mut link = match hid::open(&path, baud) { Ok(l) => l, Err(e) => { println!("{e}"); break; } };
            let mut shown = 0usize;
            let mut prog = |i: usize, n: usize| { if i == n || i % 100 == 0 { if shown != i { shown = i; println!("  ... {i} of {n} records"); } } };
            match taidoc::run(&mut link, &mut prog, &HashSet::new(), false) {
                Ok(s) => {
                    println!("model reply: {}\nmeter clock: {}\nstored results reported: {}\nglucose readings read: {}\nhaematocrit values: {}\nother records skipped: {}", s.model, s.meter_clock.clone().unwrap_or("unreadable".into()), s.declared, s.readings.len(), s.hct_seen, s.skipped_other);
                    if let Some(e) = &s.error { println!("stopped early: {e}"); }
                    println!("\ntrace:"); for l in &s.trace { println!("  {l}"); }
                    println!("\nfirst readings:"); for r in s.readings.iter().take(5) { println!("  {} {} mg/dL {}", r.ts, r.mgdl, r.meal); }
                    return;
                }
                Err(f) => { println!("failed: {}", f.error); for l in &f.trace { println!("  {l}"); } }
            }
        }
    }
}
#[cfg(not(target_os = "linux"))]
fn probe_cli() { println!("--probe is only available on Linux."); }

struct CloseToTray(AtomicBool);
#[tauri::command]
fn set_close_to_tray(state: tauri::State<CloseToTray>, on: bool) { state.0.store(on, Ordering::Relaxed); }

/// One-click USB permissions: writes the udev rules with a graphical password prompt (pkexec) and adds the user to dialout.
#[tauri::command]
fn install_cable_access() -> Result<String, String> {
    #[cfg(not(target_os = "linux"))]
    { return Err("Cable access setup is only needed on Linux.".into()); }
    #[cfg(target_os = "linux")]
    {
        let rule = include_str!("../../packaging/60-diabass6.rules");
        let user = std::env::var("USER").ok().filter(|u| u != "root" && !u.is_empty() && u.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.'));
        let mut script = format!("cat > /etc/udev/rules.d/60-diabass6.rules <<'EOF'\n{rule}\nEOF\nudevadm control --reload && udevadm trigger");
        if let Some(u) = &user { script.push_str(&format!("\nusermod -aG dialout {u}")); }
        let out = std::process::Command::new("pkexec").args(["sh", "-c", &script]).output()
            .map_err(|e| format!("Couldn't start the password prompt (pkexec): {e}. Run the commands in the README instead."))?;
        match out.status.code() {
            Some(0) => Ok("Done. Unplug and replug the cable. If serial ports were refused before, log out and in once as well.".into()),
            Some(126) | Some(127) => Err("The password prompt was cancelled.".into()),
            _ => Err(format!("Setting up cable access failed: {}", String::from_utf8_lossy(&out.stderr).trim())),
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
}
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};
    let show = MenuItem::with_id(app, "show", "Show DIABASS 6", true, None::<&str>)?;
    let dl = MenuItem::with_id(app, "download", "Download readings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &dl, &quit])?;
    let mut b = TrayIconBuilder::new().menu(&menu).tooltip("DIABASS 6").on_menu_event(|app, event| match event.id().as_ref() {
        "show" => show_main(app),
        "download" => { show_main(app); let _ = app.emit("tray-download", ()); }
        "quit" => app.exit(0),
        _ => {}
    });
    if let Some(icon) = app.default_window_icon() { b = b.icon(icon.clone()); }
    b.build(app)?;
    Ok(())
}

fn main() {
    if std::env::args().any(|a| a == "--probe") { probe_cli(); return; }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(CloseToTray(AtomicBool::new(false)))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<CloseToTray>().0.load(Ordering::Relaxed) { api.prevent_close(); let _ = window.hide(); }
            }
        })
        .setup(|app| {
            // The tray is a convenience; if the desktop has no tray support the app must still start.
            if let Err(e) = build_tray(app.handle()) { eprintln!("system tray unavailable: {e}"); }
            // Watch for USB serial devices being plugged in or removed and tell the UI.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last: Vec<String> = vec!["\u{0}".to_string()];
                loop {
                    let ports = collect_ports();
                    let names: Vec<String> = ports.iter().map(|p| p.name.clone()).collect();
                    if names != last { let _ = handle.emit("ports-changed", ports); last = names; }
                    std::thread::sleep(Duration::from_secs(2));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_ports, test_port, usb_devices, set_close_to_tray, install_cable_access, download, load_store, save_store, load_store_bak, quarantine_store, default_backup_dir, write_backup, list_backups, read_text_file, save_bytes, export_file])
        .run(tauri::generate_context!())
        .expect("error while running DIABASS 6");
}
