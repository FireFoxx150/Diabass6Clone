//! TaiDoc-style meter protocol (GlucoRx Nexus / TaiDoc TD-4277 family), spoken over any byte link.
//! Frame: 0x51, command, 4 message bytes, direction (0xA3 to the meter, 0xA5 from it), checksum (sum of the first 7 bytes).
//! Command set after the open-source glucometerutils driver (MIT licensed).
#![allow(dead_code)]
use std::collections::HashSet;
use std::time::{Duration, Instant};

pub trait Link {
    fn send(&mut self, data: &[u8]) -> Result<(), String>;
    /// Waits up to `timeout_ms` for bytes; returns how many were read (0 = nothing arrived).
    fn recv(&mut self, buf: &mut [u8], timeout_ms: u64) -> Result<usize, String>;
}

pub const STX: u8 = 0x51;
pub const OUT: u8 = 0xA3;
pub const CMD_CONNECT: u8 = 0x22;
pub const CMD_DATETIME: u8 = 0x23;
pub const CMD_MODEL: u8 = 0x24;
pub const CMD_READING_TIME: u8 = 0x25;
pub const CMD_READING_VALUE: u8 = 0x26;
pub const CMD_COUNT: u8 = 0x2b;
const CONNECT_REPLIES: [u8; 3] = [0x22, 0x24, 0x54];

pub fn checksum(b: &[u8]) -> u8 { b.iter().fold(0u8, |a, x| a.wrapping_add(*x)) }
pub fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join(" ") }

pub fn make_packet(cmd: u8, msg: [u8; 4]) -> [u8; 8] {
    let mut p = [STX, cmd, msg[0], msg[1], msg[2], msg[3], OUT, 0];
    p[7] = checksum(&p[..7]);
    p
}

#[derive(Debug, Clone, PartialEq)]
pub struct Frame { pub cmd: u8, pub msg: [u8; 4], pub dir: u8 }

/// Finds the first valid frame in `rx`; returns it and how many bytes to drop. Garbage before a frame is skipped.
pub fn take_frame(rx: &[u8]) -> Option<(Frame, usize)> {
    let mut i = 0;
    while i + 8 <= rx.len() {
        if rx[i] == STX && checksum(&rx[i..i + 7]) == rx[i + 7] {
            return Some((Frame { cmd: rx[i + 1], msg: [rx[i + 2], rx[i + 3], rx[i + 4], rx[i + 5]], dir: rx[i + 6] }, i + 8));
        }
        i += 1;
    }
    None
}

/// Date/time message: 16-bit little-endian word (year-2000: 7 bits, month: 4, day: 5), then minute, then hour.
pub fn parse_datetime(msg: [u8; 4]) -> Option<String> {
    let w = u16::from_le_bytes([msg[0], msg[1]]);
    let (year, month, day, minute, hour) = (2000 + (w >> 9) as u32, ((w >> 5) & 0xF) as u32, (w & 0x1F) as u32, msg[2] as u32, msg[3] as u32);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 { return None; }
    Some(format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:00"))
}

pub struct Reading { pub ts: String, pub mgdl: u32, pub meal: &'static str, pub hct: Option<u32> }
/// A record of a kind this decoder doesn't understand (for example ketones), kept so the app can offer to map it.
pub struct Extra { pub ts: String, pub value: u32, pub k2: u8, pub k3: u8 }
/// Identity of a reading for "already stored?" checks: minute plus value.
pub fn key(ts: &str, mg: u32) -> String { format!("{}|{}", &ts[..16], mg) }
#[derive(Default)]
pub struct Session {
    pub readings: Vec<Reading>, pub model: String, pub meter_clock: Option<String>,
    pub declared: u16, pub skipped_other: u32, pub hct_seen: u32, pub error: Option<String>, pub trace: Vec<String>,
    pub extras: Vec<Extra>, pub stopped_early: Option<usize>, pub clock_jumps: Vec<String>,
}
pub struct Failure { pub error: String, pub trace: Vec<String> }

struct Conn<'a, L: Link> { link: &'a mut L, rx: Vec<u8>, trace: Vec<String>, verbose: bool }

impl<'a, L: Link> Conn<'a, L> {
    fn new(link: &'a mut L) -> Self { Conn { link, rx: vec![], trace: vec![], verbose: true } }

    fn exchange(&mut self, cmd: u8, msg: [u8; 4]) -> Result<Frame, String> {
        let pkt = make_packet(cmd, msg);
        for attempt in 1..=3 {
            self.rx.clear();
            if self.verbose { self.trace.push(format!("-> {}", hex(&pkt))); }
            self.link.send(&pkt)?;
            let start = Instant::now();
            let mut buf = [0u8; 64];
            while start.elapsed() < Duration::from_millis(1200) {
                if let Some((f, n)) = take_frame(&self.rx) {
                    if self.verbose { self.trace.push(format!("<- {}", hex(&self.rx[..n]))); }
                    self.rx.drain(..n);
                    return Ok(f);
                }
                let n = self.link.recv(&mut buf, 150)?;
                self.rx.extend_from_slice(&buf[..n]);
            }
            if self.rx.is_empty() { self.trace.push(format!("no reply to command {cmd:02x} (attempt {attempt})")); }
            else { self.trace.push(format!("unusable reply to command {cmd:02x} (attempt {attempt}): {}", hex(&self.rx))); }
        }
        Err(format!("no valid reply to command {cmd:02x}"))
    }

    fn command(&mut self, cmd: u8, msg: [u8; 4]) -> Result<Frame, String> {
        let f = self.exchange(cmd, msg)?;
        if f.cmd != cmd { return Err(format!("asked for {cmd:02x} but the meter answered {:02x}", f.cmd)); }
        Ok(f)
    }

    /// Connect request and model query. Returns the model message.
    fn handshake(&mut self) -> Result<[u8; 4], String> {
        let f = self.exchange(CMD_CONNECT, [0; 4]).map_err(|e| format!("no reply from the meter ({e})"))?;
        if !CONNECT_REPLIES.contains(&f.cmd) { return Err(format!("the meter replied, but not like a TaiDoc-protocol meter (reply command {:02x})", f.cmd)); }
        let m = self.command(CMD_MODEL, [0; 4])?;
        if m.msg[1] != 0x42 { self.trace.push(format!("note: model reply {} is not of the usual form .. 42 .. .. (continuing anyway)", hex(&m.msg))); }
        Ok(m.msg)
    }
}

/// Connect and identify only. Used by "Test port".
pub fn probe<L: Link>(link: &mut L) -> Result<String, Failure> {
    let mut c = Conn::new(link);
    match c.handshake() {
        Ok(m) => Ok(hex(&m)),
        Err(e) => Err(Failure { error: e, trace: c.trace }),
    }
}

/// Downloads every stored reading. `progress(done, total)` is called as records arrive.
/// `known` holds keys of readings the app already has. With `fast`, reading stops once six glucose readings in a row are
/// already known (records arrive newest first); if the timestamps ever run out of order it quietly reads everything.
pub fn run<L: Link>(link: &mut L, progress: &mut dyn FnMut(usize, usize), known: &HashSet<String>, fast: bool) -> Result<Session, Failure> {
    let mut c = Conn::new(link);
    let mut s = Session::default();
    let model = match c.handshake() { Ok(m) => m, Err(e) => return Err(Failure { error: e, trace: c.trace }) };
    s.model = hex(&model);
    if let Ok(f) = c.command(CMD_DATETIME, [0; 4]) { s.meter_clock = parse_datetime(f.msg); }
    let count = match c.command(CMD_COUNT, [0; 4]) {
        Ok(f) => u16::from_le_bytes([f.msg[0], f.msg[1]]),
        Err(e) => { return Err(Failure { error: format!("couldn't read the number of stored results ({e})"), trace: c.trace }); }
    };
    s.declared = count;
    if count > 5000 { return Err(Failure { error: format!("the meter claims {count} stored results, which isn't believable"), trace: c.trace }); }

    let mut bad_in_a_row = 0;
    let mut kinds: std::collections::BTreeMap<(u8, u8), u32> = Default::default();
    let mut hct: std::collections::HashMap<String, u32> = Default::default();
    let mut known_run = 0u32;
    let mut last_glucose: Option<String> = None;
    let mut order_ok = true;
    let (mut vmin, mut vmax) = (u32::MAX, 0u32);
    for i in 0..count {
        c.verbose = i < 4;
        let sel = [(i & 0xff) as u8, (i >> 8) as u8, 0, 0];
        let got = (|| -> Result<(String, Frame), String> {
            let when = c.command(CMD_READING_TIME, sel)?;
            let ts = parse_datetime(when.msg).ok_or_else(|| format!("record {i}: unreadable date {}", hex(&when.msg)))?;
            let val = c.command(CMD_READING_VALUE, sel)?;
            Ok((ts, val))
        })();
        match got {
            Ok((ts, val)) => {
                bad_in_a_row = 0;
                let v = u16::from_le_bytes([val.msg[0], val.msg[1]]) as u32;
                *kinds.entry((val.msg[2], val.msg[3])).or_insert(0) += 1; vmin = vmin.min(v); vmax = vmax.max(v);
                // Nexus-style records: byte 3 is 06 and byte 4 is the meal flag. GlucoRx HCT records: byte 4 is the type (03 glucose, db haematocrit).
                let nexus = val.msg[2] == 0x06;
                if (nexus || val.msg[3] == 0x03) && (10..=900).contains(&v) {
                    let meal = if !nexus { "" } else if val.msg[3] & 0x80 != 0 { "after meal" } else if val.msg[3] & 0x40 != 0 { "before meal" } else { "" };
                    if let Some(prev) = &last_glucose {
                        if ts.as_str() > prev.as_str() { order_ok = false; if s.clock_jumps.len() < 10 { s.clock_jumps.push(format!("record {i}: {ts} comes after the older {prev}")); } }
                    }
                    last_glucose = Some(ts.clone());
                    if fast && order_ok { if known.contains(&key(&ts, v)) { known_run += 1; } else { known_run = 0; } }
                    s.readings.push(Reading { ts, mgdl: v, meal, hct: None });
                } else if !nexus && val.msg[3] == 0xdb && (1..=100).contains(&v) {
                    s.hct_seen += 1; hct.insert(ts, v);
                } else {
                    s.skipped_other += 1;
                    if s.skipped_other <= 8 { s.trace.push(format!("record {i} ({ts}) is not a glucose or haematocrit result: {}", hex(&val.msg))); }
                    if s.extras.len() < 6000 { s.extras.push(Extra { ts, value: v, k2: val.msg[2], k3: val.msg[3] }); }
                }
            }
            Err(e) => {
                bad_in_a_row += 1; c.trace.push(format!("record {i}: {e}"));
                if bad_in_a_row >= 5 { s.error = Some(format!("stopped after {i} records: the meter stopped answering ({e})")); break; }
            }
        }
        progress(i as usize + 1, count as usize);
        if fast && order_ok && known_run >= 6 {
            s.stopped_early = Some(i as usize + 1);
            progress(count as usize, count as usize);
            break;
        }
    }
    for r in s.readings.iter_mut() { r.hct = hct.get(&r.ts).copied(); }
    if !kinds.is_empty() {
        let t = kinds.iter().map(|((a, b), n)| format!("{a:02x} {b:02x} x{n}")).collect::<Vec<_>>().join(", ");
        s.trace.push(format!("summary: record kinds seen (bytes 3 and 4 of the value reply): {t}. Raw values ranged {vmin} to {vmax}. Type 03 = glucose, db = haematocrit; anything else is skipped."));
    }
    s.trace.splice(0..0, c.trace);
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[test] fn packet_matches_the_reference_test_vector() {
        assert_eq!(make_packet(0x22, [0; 4]), [0x51, 0x22, 0, 0, 0, 0, 0xa3, 0x16]);
    }
    #[test] fn datetime_matches_the_reference_test_vectors() {
        assert_eq!(parse_datetime([0x21, 0x24, 0x0e, 0x15]).unwrap(), "2018-01-01T21:14:00");
        assert_eq!(parse_datetime([0x21, 0x26, 0x0e, 0x15]).unwrap(), "2019-01-01T21:14:00");
        assert_eq!(parse_datetime([0x04, 0x27, 0x25, 0x0d]).unwrap(), "2019-08-04T13:37:00");
        assert!(parse_datetime([0x00, 0x00, 0, 0]).is_none());          // month 0
        assert!(parse_datetime([0x21, 0x24, 70, 5]).is_none());          // minute 70
    }
    #[test] fn frames_resync_after_garbage() {
        let mut v = vec![0x00, 0x51, 0x99, 0x13];                         // junk, including a fake STX
        let p = respond(0x24, [0x77, 0x42, 1, 2]); v.extend_from_slice(&p);
        let (f, n) = take_frame(&v).unwrap(); assert_eq!((f.cmd, f.msg, n), (0x24, [0x77, 0x42, 1, 2], v.len()));
        let mut bad = p; bad[7] ^= 1; assert!(take_frame(&bad).is_none());   // checksum guards
    }

    fn respond(cmd: u8, msg: [u8; 4]) -> [u8; 8] { let mut p = [STX, cmd, msg[0], msg[1], msg[2], msg[3], 0xA5, 0]; p[7] = checksum(&p[..7]); p }
    fn day_word(y: u16, m: u16, d: u16) -> [u8; 2] { (((y - 2000) << 9) | (m << 5) | d).to_le_bytes() }

    /// A pretend meter reached through a pretend HID bridge that delivers data in small chunks.
    struct Fake { model: [u8; 4], records: Vec<([u8; 4], [u8; 4])>, out: VecDeque<u8>, drop_first_connect: bool, junk_first: bool, silent: bool, log: Vec<u8> }
    impl Fake { fn new(records: Vec<([u8; 4], [u8; 4])>) -> Fake { Fake { model: [0x77, 0x42, 7, 7], records, out: VecDeque::new(), drop_first_connect: false, junk_first: false, silent: false, log: vec![] } } }
    impl Link for Fake {
        fn send(&mut self, d: &[u8]) -> Result<(), String> {
            assert_eq!(d.len(), 8, "always whole packets"); assert_eq!(d[0], STX); assert_eq!(d[6], OUT); assert_eq!(d[7], checksum(&d[..7]));
            self.log.push(d[1]);
            if self.silent { return Ok(()); }
            let (cmd, sel) = (d[1], u16::from_le_bytes([d[2], d[3]]) as usize);
            let reply: Option<[u8; 8]> = match cmd {
                0x22 => if self.drop_first_connect { self.drop_first_connect = false; None } else { Some(respond(0x22, [0; 4])) },
                0x24 => Some(respond(0x24, self.model)),
                0x23 => { let w = day_word(2026, 10, 12); Some(respond(0x23, [w[0], w[1], 30, 9])) }
                0x2b => { let n = (self.records.len() as u16).to_le_bytes(); Some(respond(0x2b, [n[0], n[1], 0, 0])) }
                0x25 => self.records.get(sel).map(|r| respond(0x25, r.0)),
                0x26 => self.records.get(sel).map(|r| respond(0x26, r.1)),
                _ => None,
            };
            if let Some(r) = reply { if self.junk_first { self.junk_first = false; self.out.extend([0x00u8, 0xff, 0x51]); } self.out.extend(r); }
            Ok(())
        }
        fn recv(&mut self, buf: &mut [u8], _t: u64) -> Result<usize, String> {
            let n = self.out.len().min(3).min(buf.len());                // 3-byte chunks, like a slow bridge
            for i in 0..n { buf[i] = self.out.pop_front().unwrap(); }
            Ok(n)
        }
    }
    fn rec(y: u16, m: u16, d: u16, h: u8, mi: u8, mg: u16, meal: u8) -> ([u8; 4], [u8; 4]) {
        let w = day_word(y, m, d); let v = mg.to_le_bytes(); ([w[0], w[1], mi, h], [v[0], v[1], 0x06, meal])
    }

    #[test] fn downloads_everything_through_a_chunky_flaky_link() {
        let mut f = Fake::new(vec![rec(2026, 10, 5, 7, 12, 132, 0x00), rec(2026, 10, 5, 13, 2, 96, 0x40), rec(2026, 10, 6, 21, 45, 211, 0x80), rec(2026, 10, 7, 8, 0, 74, 0)]);
        f.drop_first_connect = true; f.junk_first = true;
        let mut ticks = vec![];
        let s = run(&mut f, &mut |d, t| ticks.push((d, t)), &HashSet::new(), false).ok().unwrap();
        assert_eq!(s.declared, 4); assert_eq!(s.readings.len(), 4); assert!(s.error.is_none());
        assert_eq!((s.readings[0].ts.as_str(), s.readings[0].mgdl, s.readings[0].meal), ("2026-10-05T07:12:00", 132, ""));
        assert_eq!((s.readings[1].mgdl, s.readings[1].meal), (96, "before meal"));
        assert_eq!((s.readings[2].mgdl, s.readings[2].meal), (211, "after meal"));
        assert_eq!(s.model, "77 42 07 07"); assert_eq!(s.meter_clock.as_deref(), Some("2026-10-12T09:30:00"));
        assert_eq!(ticks.last(), Some(&(4, 4)));
        assert_eq!(f.log.iter().filter(|c| **c == 0x22).count(), 2, "the dropped connect reply was retried once");
    }
    /// Bytes copied from a real GlucoRx HCT's capture log: results come in glucose/haematocrit pairs sharing a timestamp.
    #[test] fn real_glucorx_hct_records_decode() {
        let recs = vec![
            ([0x4b, 0x35, 0x20, 0x14], [0x6a, 0x00, 0x40, 0x03]), ([0x4b, 0x35, 0x20, 0x14], [0x27, 0x00, 0x40, 0xdb]),
            ([0x4b, 0x35, 0x2c, 0x06], [0x36, 0x01, 0x40, 0x03]), ([0x4b, 0x35, 0x2c, 0x06], [0x2c, 0x00, 0x40, 0xdb]),
            ([0x48, 0x35, 0x00, 0x08], [0x29, 0x01, 0x40, 0x03]), ([0x48, 0x35, 0x00, 0x08], [0x24, 0x00, 0x40, 0xdb]),
            ([0x47, 0x35, 0x1d, 0x11], [0x4d, 0x00, 0x40, 0x03]), ([0x47, 0x35, 0x1d, 0x11], [0x2b, 0x00, 0x40, 0xdb]),
        ];
        let mut f = Fake::new(recs); f.model = [0x79, 0x42, 0x03, 0x00];
        let s = run(&mut f, &mut |_, _| {}, &HashSet::new(), false).ok().unwrap();
        let got: Vec<_> = s.readings.iter().map(|r| (r.ts.as_str(), r.mgdl, r.hct)).collect();
        assert_eq!(got, vec![("2026-10-11T20:32:00", 106, Some(39)), ("2026-10-11T06:44:00", 310, Some(44)), ("2026-10-08T08:00:00", 297, Some(36)), ("2026-10-07T17:29:00", 77, Some(43))]);
        assert_eq!((s.hct_seen, s.skipped_other), (4, 0)); assert!(s.readings.iter().all(|r| r.meal.is_empty()));
        assert!(!s.trace.iter().any(|l| l.contains("not of the usual form")), "model 79 42 is accepted without complaint");
        assert!(s.trace.iter().any(|l| l.contains("40 03 x4, 40 db x4")), "{:?}", s.trace);
    }
    #[test] fn unknown_kinds_are_counted_not_imported() {
        let ketone = ([0x4b, 0x35, 0x20, 0x14], [0x0c, 0x00, 0x40, 0x07]);        // some other type code
        let s = run(&mut Fake::new(vec![([0x4b, 0x35, 0x20, 0x14], [0x6a, 0x00, 0x40, 0x03]), ketone]), &mut |_, _| {}, &HashSet::new(), false).ok().unwrap();
        assert_eq!((s.readings.len(), s.skipped_other), (1, 1)); assert!(s.trace.iter().any(|l| l.contains("40 07 x1")));
        assert_eq!((s.extras.len(), s.extras[0].k3, s.extras[0].value, s.extras[0].ts.as_str()), (1, 7, 12, "2026-10-11T20:32:00"));
    }

    /// Newest-first records: glucose then haematocrit for each of 12 days, glucose = 100 + day index.
    fn newest_first(n: u16) -> Vec<([u8; 4], [u8; 4])> {
        let mut v = vec![];
        for g in 0..n { let w = day_word(2026, 10, 28 - g); let mg = (100 + g).to_le_bytes();
            v.push(([w[0], w[1], 0, 8], [mg[0], mg[1], 0x40, 0x03])); v.push(([w[0], w[1], 0, 8], [40, 0, 0x40, 0xdb])); }
        v
    }
    fn known_keys(range: std::ops::Range<u16>) -> HashSet<String> { range.map(|g| key(&format!("2026-10-{:02}T08:00:00", 28 - g), (100 + g) as u32)).collect() }

    #[test] fn fast_download_stops_once_six_known_readings_in_a_row_are_seen() {
        let s = run(&mut Fake::new(newest_first(12)), &mut |_, _| {}, &known_keys(4..12), true).ok().unwrap();
        assert_eq!(s.readings.len(), 10, "4 new + 6 known, then stop");
        assert_eq!(s.stopped_early, Some(19), "stops right after the sixth known glucose record"); assert_eq!(s.readings[0].mgdl, 100);
        assert!(s.readings[..4].iter().all(|r| r.hct == Some(40)), "every NEW reading still gets its haematocrit");
        let full = run(&mut Fake::new(newest_first(12)), &mut |_, _| {}, &known_keys(4..12), false).ok().unwrap();
        assert_eq!((full.readings.len(), full.stopped_early), (12, None), "a full download ignores the known set");
    }
    #[test] fn fast_download_with_nothing_new_is_only_a_dozen_records() {
        let mut ticks = vec![];
        let s = run(&mut Fake::new(newest_first(12)), &mut |d, t| ticks.push((d, t)), &known_keys(0..12), true).ok().unwrap();
        assert_eq!((s.readings.len(), s.stopped_early), (6, Some(11))); assert_eq!(ticks.last(), Some(&(24, 24)), "progress jumps to done");
    }
    #[test] fn a_known_reading_with_a_different_value_is_not_treated_as_known() {
        let mut k = known_keys(0..12); k.remove(&key("2026-10-28T08:00:00", 100)); k.insert(key("2026-10-28T08:00:00", 999));
        let s = run(&mut Fake::new(newest_first(12)), &mut |_, _| {}, &k, true).ok().unwrap();
        assert!(s.readings.len() >= 7, "the changed first reading resets the run: {}", s.readings.len());
    }
    #[test] fn out_of_order_timestamps_disable_early_stopping_and_are_reported() {
        let mut recs = newest_first(12);
        let w = day_word(2026, 11, 3); recs[8].0 = [w[0], w[1], 0, 8];          // a glucose record dated after its neighbours
        let s = run(&mut Fake::new(recs), &mut |_, _| {}, &known_keys(0..12), true).ok().unwrap();
        assert!(s.clock_jumps.iter().any(|l| l.contains("record 8") && l.contains("comes after")), "{:?}", s.clock_jumps);
        assert!(s.readings.len() >= 6);
    }
    #[test] fn handles_a_full_1000_record_memory() {
        let recs: Vec<_> = (0..1000u16).map(|i| rec(2026, 1 + (i / 100) % 12, 1 + (i % 28), (i % 24) as u8, (i % 60) as u8, 60 + (i % 200), 0)).collect();
        let s = run(&mut Fake::new(recs), &mut |_, _| {}, &HashSet::new(), false).ok().unwrap();
        assert_eq!(s.readings.len(), 1000); assert_eq!(s.readings[999].mgdl, 60 + 999 % 200);
        assert!(s.trace.len() < 100, "trace stays small: {}", s.trace.len());
    }
    #[test] fn non_glucose_records_are_skipped_not_mangled() {
        let mut ketone = rec(2026, 10, 5, 7, 12, 3, 0); ketone.1[2] = 0x0a;      // different type byte, tiny value
        let s = run(&mut Fake::new(vec![rec(2026, 10, 5, 7, 0, 100, 0), ketone, rec(2026, 10, 5, 8, 0, 110, 0)]), &mut |_, _| {}, &HashSet::new(), false).ok().unwrap();
        assert_eq!((s.readings.len(), s.skipped_other), (2, 1));
        assert!(s.trace.iter().any(|l| l.contains("06 00 x2, 0a 00 x1") && l.contains("3 to 110")), "{:?}", s.trace);
    }
    #[test] fn silent_device_fails_cleanly_with_a_trace() {
        let mut f = Fake::new(vec![]); f.silent = true;
        let e = run(&mut f, &mut |_, _| {}, &HashSet::new(), false).err().unwrap();
        assert!(e.error.contains("no reply"), "{}", e.error); assert!(e.trace.iter().filter(|l| l.contains("no reply to command 22")).count() == 3);
    }
    #[test] fn a_meter_that_speaks_something_else_is_reported_not_trusted() {
        struct Other; impl Link for Other { fn send(&mut self, _: &[u8]) -> Result<(), String> { Ok(()) } fn recv(&mut self, b: &mut [u8], _: u64) -> Result<usize, String> { b[..4].copy_from_slice(b"OK\r\n"); Ok(4) } }
        let e = probe(&mut Other).err().unwrap(); assert!(e.error.contains("no reply") && e.trace.iter().any(|l| l.contains("unusable reply") && l.contains("4f 4b 0d 0a")));
    }
    #[test] fn probe_returns_the_model_bytes() { assert_eq!(probe(&mut Fake::new(vec![])).ok().unwrap(), "77 42 07 07"); }
}
