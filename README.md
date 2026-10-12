# DIABASS 6 — Glucose Rx HCT (Linux Mint)

Native desktop app (Tauri 2 + React + TypeScript + Rust). No Chrome, no Google components; it uses the system WebKitGTK.

## Build & install on Linux Mint 22
```bash
sudo apt install -y build-essential curl wget file libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev pkg-config nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # then restart the terminal
cd diabass6 && npm install
npm run tauri build          # produces src-tauri/target/release/bundle/deb/*.deb
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
sudo usermod -aG dialout $USER   # then log out and back in (USB serial permission)
```
Dev mode: `npm run tauri dev`.

## Using the meter
Meter tab -> pick the port (usually /dev/ttyUSB0 or /dev/ttyACM0) -> Download all readings.
The app reads everything the meter sends, merges it into history and skips duplicates.
If nothing is recognised, open the Capture log, Save it, and send it over so the exact protocol can be wired in.

## Insulin CSV import
Insulin tab -> Choose CSV file. Needs a date/time and a units column (header row optional; comma, semicolon or tab separated).
Optional: type (basal/bolus/brand) and note. Duplicates are skipped. Dates follow the "Meter date order" setting.

## Doctor report
Doctor report tab -> choose dates -> Print / save as PDF, or Save as HTML file (Documents/DIABASS6).
Includes summary, time in range, charts, time-of-day table, day-by-day glucose + insulin, and optional full logs.

## More features
- **Insulin on charts:** doses appear as bars under the glucose trend and daily profile (toggle "Show insulin").
- **Patterns:** descriptive observations on the Overview (low/high clusters by time of day, lows soon after insulin, weekday vs weekend, variability, testing gaps). Not medical advice.
- **Low-glucose log:** lows from the meter are listed so you can add symptoms, treatment and recovery; events appear in the doctor report.
- **Plug-in detection:** a background watcher notices a new USB serial device and offers to download, or downloads automatically once the app has learned your meter's USB ID. Needs `libudev-dev` to build.
- **Period comparison:** Overview and doctor report compare the period with the one before it.

## Further features
- **24-hour AGP chart:** Daily profile > "24-hour AGP" (median, 25-75% and 5-95% bands). Used in the doctor report when there is enough data.
- **Lab HbA1c:** log lab results (% or mmol/mol) and compare with the meter-based estimate for the 90 days before each result.
- **Supplies:** strips (counted stock minus tests since), control solution (discard date after opening) and expiry dates, with warnings on the Overview.
- **Meter clock check:** Meter > Check meter clock. Can apply a correction to future downloads. Warns if readings are dated in the future.
- **Calendar:** month heatmap by average, time in range or lowest reading; click a day for readings, insulin, events and notes.
- **Notes & tags:** tag days (exercise, illness, stress, alcohol...); filter Readings by tagged days; notes appear in the doctor report.

## Data safety and packaging
- **Automatic backups:** Data & settings > Automatic backups. One dated file per day (the newest state of that day) in a folder you choose; the oldest beyond "keep" are deleted. If password protection is on, backups are encrypted too. Backups made before protection was switched on stay plain text.
- **Password protection:** encrypts the data file and backups (AES-256-GCM, key from PBKDF2-SHA256, 600,000 iterations). Asks for the password at start-up, locks after inactivity, and **a forgotten password cannot be recovered**. Keep a plain backup somewhere safe if that worries you.
- **Safer saving:** the data file is written atomically and a recovery copy is kept (refreshed at most every 30 minutes). A damaged file is never overwritten: the app tells you and offers to move it aside.
- **Import from other systems:** Libre/LibreView, Dexcom Clarity, Glooko or generic CSV. Fingerstick readings and insulin only; continuous-sensor values are skipped. Shows a preview first. The layouts were written from the published column names and tested on synthetic files, not real exports.
- **Appearance:** dark, light or follow the system; three text sizes.
- **PDF report:** Doctor report > Save as PDF file (real text and vector charts, A4). Print... and Save as HTML still work.

## Building for Windows
Tauri installers must be built on the target OS.
1. On Windows 10/11 install: Microsoft C++ Build Tools (Desktop development with C++), Rust (rustup, MSVC toolchain), Node.js 20+. WebView2 is already part of Windows 11.
2. `npm install` then `npm run tauri build`. The installer appears in `src-tauri/target/release/bundle/nsis/`.
3. Your USB cable needs its driver (FTDI, Prolific, CH340 or Silicon Labs, depending on the cable). The meter then shows up as a COM port.

No Windows machine? Push the folder to a GitHub repository and run the "Build installers" workflow (`.github/workflows/build.yml`): it builds the Linux .deb and the Windows installer and attaches both.

## Troubleshooting the meter connection
- **"Input/output error" on a port:** you picked a built-in serial port (`/dev/ttyS*`) with nothing attached. The app now hides those by default; your meter's cable should appear as `/dev/ttyUSB0` or `/dev/ttyACM0`.
- **No USB port appears:** Meter tab > "What does the computer see?" shows how the kernel exposes the cable. If it says the device is an HID device (`hidraw`), the serial method can't talk to it; send the report so HID support can be added.
- **Permission denied:** `sudo usermod -aG dialout $USER`, then log out and in.
- **Port opens then errors, or is busy:** `sudo systemctl stop ModemManager` (it probes USB serial devices), and `sudo apt remove brltty` if `dmesg | tail` mentions brltty.
- **Test port** opens the port and listens for a moment, to separate "can't open it" from "nothing to say".

## GlucoRx / TaiDoc meters (HID cable)
GlucoRx meters use a cable with a Silicon Labs CP2110 "HID to UART" chip (USB ID `10c4:ea80`). Linux does not show that as `/dev/ttyUSB0`; it appears as `/dev/hidrawN`, and the app lists it as `hid:/dev/hidrawN`.
- The app speaks the TaiDoc protocol (connect, model, clock, count, then date and value for each stored result) and tries 19200, 9600, 38400 and 115200 baud.
- Switch the meter **off**, then plug the cable in; the meter should show "PC" or "USB".
- Permission: if opening `/dev/hidrawN` fails, allow access with
  `echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea80", MODE="0666", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/60-diabass6-hid.rules && sudo udevadm control --reload && sudo udevadm trigger`
  then unplug and replug. (The .deb package installs the same rule.)
- Protocol credit: the open-source glucometerutils TaiDoc driver (MIT). The protocol layer is tested against a simulated meter and the reference test vectors, not against a GlucoRx HCT.

### No-interface check
`src-tauri/target/release/diabass6 --probe` (or the installed `diabass6 --probe`) talks to the GlucoRx cable from a terminal and prints the model reply, meter clock, how many results the meter says it holds, the record type bytes seen, and the first readings.

## Installing (one command)
`./scripts/install.sh` installs the build packages, Rust if missing, builds the app, installs the `.deb` (menu entry, USB rules) and adds you to `dialout`.
For a portable AppImage instead: `npm run appimage` (it downloads its bundling tools during the build).

## Faster downloads
The first download reads everything the meter holds. After that, "Download new readings" stops as soon as it meets six readings in a row that are already stored (the meter returns newest first), so it takes seconds. "Full re-download" reads everything again, and the app does that automatically every 30 days. If the meter's records ever come back out of date order (a clock reset), it reads everything and tells you on the Data quality screen.

## Ketones and haematocrit
Haematocrit arrives with each glucose reading and is shown in the Readings table, a trend chart and the reports. Any other record kind the meter stores (for example ketones) is held back and offered on the Ketone & HCT screen: you say what it is and how to scale it, and the choice is remembered. Nothing is guessed. Ketone bands shown are commonly used guideline bands, not advice.

## Tray, reminders, profiles
- **Tray icon:** Show, Download readings, Quit. Needs a desktop with tray support (Cinnamon has it) and `libayatana-appindicator3`. If the tray isn't available the app still starts. "Keep running in the tray when the window is closed" is under Data & settings.
- **Reminders:** test times, a week without a download, and low or expired supplies, as desktop notifications. They only fire while the app is running (use the tray option to keep it running).
- **Profiles:** separate readings, settings, backups and password per person. Backups are named per profile and pruned per profile.

## Reports
Appointment tab: pick the date and the period (since last lab result, since last appointment, 30/90 days or custom), then make a one-page PDF summary and/or the full report, optionally with a PDF password. A PDF password stops casual readers but is not strong encryption; send it by a different route.

## Insulin pen exports
The Insulin tab's CSV import also reads insulin-pen exports shaped like `Serial;Timestamp;Time;Value`. A column called "Value" is ambiguous, so the import shows what it assumed before saving anything: values above 100 that are all multiples of 5 are tenths of a unit (300 = 30 units), and small records (4 units or less) within three minutes before a larger dose are priming shots, which are left out unless you choose otherwise. The pen's serial number is kept as a note, and times are used as written in the file.
