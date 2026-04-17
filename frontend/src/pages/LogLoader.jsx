import { useState, useRef } from "react";
import { createFlight, uploadSegment, createConfigDump } from "../api.js";

// ── Shared styles injected once ──────────────────────────────────────────────
const CSS = `
.ll-root { max-width: 720px; margin: 0 auto; padding: 32px 24px; display: flex; flex-direction: column; gap: 20px; }
.ll-step { background: #111820; border: 1px solid #1e3a5f; border-radius: 10px; padding: 20px 24px; }
.ll-step-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.ll-step-num { width: 26px; height: 26px; border-radius: 6px; background: linear-gradient(135deg,#00c8ff,#7c3aed); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: #fff; flex-shrink: 0; }
.ll-step-title { font-size: 15px; font-weight: 700; }
.ll-step-badge { font-family: 'JetBrains Mono',monospace; font-size: 9px; color: #475569; border: 1px solid #252d40; padding: 2px 7px; border-radius: 3px; margin-left: auto; }
.ll-drop { border: 1.5px dashed #1e3a5f; border-radius: 8px; padding: 28px 20px; text-align: center; cursor: pointer; transition: all .2s; background: #0f1219; }
.ll-drop:hover, .ll-drop.over { border-color: #00c8ff; background: rgba(0,200,255,.04); }
.ll-drop-icon  { font-size: 26px; margin-bottom: 8px; }
.ll-drop-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
.ll-drop-sub   { font-size: 11px; color: #475569; font-family: 'JetBrains Mono',monospace; }
.ll-progress { height: 3px; background: #1e3a5f; border-radius: 2px; overflow: hidden; margin-top: 10px; }
.ll-progress-fill { height: 100%; background: #00c8ff; transition: width .1s; }
.ll-info-box { background: #0f1219; border: 1px solid #1e3a5f; border-left: 3px solid #39ff8a; border-radius: 4px; padding: 10px 14px; font-family: 'JetBrains Mono',monospace; font-size: 11px; color: #94a3b8; line-height: 1.8; margin-top: 10px; }
.ll-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ll-label { font-size: 10px; letter-spacing: 1.5px; color: #475569; font-family: 'JetBrains Mono',monospace; text-transform: uppercase; margin-bottom: 5px; }
.ll-input { width: 100%; background: #0f1219; border: 1px solid #252d40; border-radius: 5px; color: #e2e8f0; font-family: 'JetBrains Mono',monospace; font-size: 13px; padding: 8px 10px; outline: none; transition: border-color .15s; }
.ll-input:focus { border-color: #00c8ff; }
.ll-textarea { width: 100%; background: #0f1219; border: 1px solid #252d40; border-radius: 5px; color: #e2e8f0; font-family: 'JetBrains Mono',monospace; font-size: 11px; padding: 8px 10px; outline: none; resize: vertical; transition: border-color .15s; }
.ll-textarea:focus { border-color: #00c8ff; }
.ll-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
.ll-btn { padding: 7px 18px; border-radius: 5px; border: 1px solid; font-family: 'Barlow Condensed',sans-serif; font-weight: 700; font-size: 13px; cursor: pointer; transition: all .15s; white-space: nowrap; }
.ll-btn-primary  { background: rgba(0,200,255,.1); border-color: #00c8ff; color: #00c8ff; }
.ll-btn-primary:hover:not(:disabled)  { background: rgba(0,200,255,.18); box-shadow: 0 0 14px rgba(0,200,255,.25); }
.ll-btn-success  { background: rgba(57,255,138,.08); border-color: #39ff8a; color: #39ff8a; }
.ll-btn-success:hover:not(:disabled)  { background: rgba(57,255,138,.16); box-shadow: 0 0 14px rgba(57,255,138,.25); }
.ll-btn-ghost    { background: none; border-color: #1e3a5f; color: #475569; }
.ll-btn-ghost:hover { border-color: #475569; color: #94a3b8; }
.ll-btn:disabled { opacity: .4; cursor: not-allowed; }
.ll-error { font-size: 11px; color: #ef4444; font-family: 'JetBrains Mono',monospace; padding: 7px 12px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.3); border-radius: 4px; margin-top: 8px; }
.ll-success { font-size: 11px; color: #39ff8a; font-family: 'JetBrains Mono',monospace; padding: 7px 12px; background: rgba(57,255,138,.08); border: 1px solid rgba(57,255,138,.3); border-radius: 4px; margin-top: 8px; }
.ll-stat-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-top: 4px; }
.ll-stat { background: #0f1219; border: 1px solid #1e3a5f; border-radius: 5px; padding: 12px; text-align: center; }
.ll-stat-val  { font-size: 20px; font-weight: 800; color: #00c8ff; font-family: 'JetBrains Mono',monospace; }
.ll-stat-sub  { font-size: 9px; color: #475569; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 3px; }
.ll-filename-preview { font-family: 'JetBrains Mono',monospace; font-size: 11px; color: #f59e0b; padding: 8px 12px; background: #0f1219; border: 1px dashed #252d40; border-radius: 4px; margin-top: 6px; }
.ll-config-status { font-size: 10px; font-family: 'JetBrains Mono',monospace; padding: 5px 10px; border-radius: 4px; margin-top: 6px; background: #0f1219; border: 1px solid #1e3a5f; color: #475569; }
.ll-config-status.ok { color: #39ff8a; border-color: rgba(57,255,138,.3); background: rgba(57,255,138,.05); }
.ll-config-status.err { color: #ef4444; }

/* Staged segments list */
.ll-seg-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.ll-seg-item {
  display: flex; align-items: center; gap: 10px;
  background: #0f1219; border: 1px solid #1e3a5f; border-radius: 6px;
  padding: 8px 12px;
}
.ll-seg-item-dot { width: 7px; height: 7px; border-radius: 2px; background: #00c8ff; flex-shrink: 0; box-shadow: 0 0 6px rgba(0,200,255,.4); }
.ll-seg-item-label { font-size: 13px; font-weight: 700; color: #e2e8f0; }
.ll-seg-item-meta { font-size: 10px; color: #475569; font-family: 'JetBrains Mono',monospace; margin-top: 1px; }
.ll-seg-item-remove {
  margin-left: auto; background: none; border: none; color: #475569;
  cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: 4px; transition: all .15s; flex-shrink: 0;
}
.ll-seg-item-remove:hover { color: #ef4444; background: rgba(239,68,68,.1); }
.ll-seg-divider { border: none; border-top: 1px solid #1e3a5f; margin: 14px 0; }
.ll-seg-count-badge {
  font-family: 'JetBrains Mono',monospace; font-size: 10px;
  background: rgba(0,200,255,.1); border: 1px solid rgba(0,200,255,.2); color: #00c8ff;
  padding: 2px 8px; border-radius: 4px; margin-left: 8px;
}

/* Step 4 segment summary list */
.ll-save-seg-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.ll-save-seg-item {
  display: flex; align-items: center; gap: 10px;
  background: #0f1219; border: 1px solid #1e3a5f; border-radius: 6px;
  padding: 8px 12px;
}
.ll-save-seg-label { font-size: 12px; font-weight: 700; color: #e2e8f0; }
.ll-save-seg-meta { font-size: 10px; color: #475569; font-family: 'JetBrains Mono',monospace; margin-left: auto; }
`;

// ── CSV preamble parser (browser-side) ───────────────────────────────────────
function parsePreamble(text) {
  const meta = {};
  const lines = text.split("\n").slice(0, 60);
  for (const line of lines) {
    const m = line.match(/^#\s*(\w[\w\s]+?)\s*:\s*(.+)$/);
    if (m) {
      const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
      meta[key] = m[2].trim();
    }
  }
  let sampleRateHz = 1000;
  if (meta.looptime) {
    const lt = parseFloat(meta.looptime);
    const gyroRate = lt > 0 ? 1_000_000 / lt : 4000;
    const pidDenom = parseFloat(meta.pid_process_denom || "1");
    const logDenom = parseFloat(meta.frameintervalpdenom || "1");
    sampleRateHz = Math.round(gyroRate / pidDenom / logDenom);
  }
  return { ...meta, sampleRateHz };
}

// ── Stream-read a large CSV in 4 MB chunks ──────────────────────────────────
function streamCSV(file, onProgress) {
  return new Promise((resolve, reject) => {
    const CHUNK = 4 * 1024 * 1024;
    let offset = 0, residual = "", headerLine = "", dataLines = [], headerFound = false;

    function readChunk() {
      const slice = file.slice(offset, offset + CHUNK);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = residual + e.target.result;
        const lines = text.split("\n");
        residual = lines.pop() || "";
        offset += CHUNK;
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          if (!headerFound) {
            if (line.replace(/^"/, "").startsWith("loopIteration")) {
              headerLine = line;
              headerFound = true;
            }
            continue;
          }
          dataLines.push(line);
        }
        const pct = Math.min(99, Math.round(Math.min(offset, file.size) / file.size * 100));
        onProgress(pct, dataLines.length);
        if (offset < file.size) { setTimeout(readChunk, 0); return; }
        if (residual.trim() && headerFound) dataLines.push(residual.trim());
        if (!headerFound) { reject(new Error("No loopIteration header found — is this a Rotorflight blackbox CSV?")); return; }
        resolve({ headerLine, dataLines });
      };
      reader.onerror = () => reject(new Error("File read error"));
      reader.readAsText(slice);
    }
    readChunk();
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LogLoader({ onSaved }) {
  const [step, setStep]     = useState(1);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState("");

  // Step 1 — CSV load state
  const [csvFile, setCsvFile]       = useState(null);
  const [csvMeta, setCsvMeta]       = useState(null);
  const [csvHeader, setCsvHeader]   = useState("");
  const [csvDataLines, setCsvDataLines] = useState([]);
  const [progress, setProgress]     = useState(0);
  const [csvDragOver, setCsvDragOver] = useState(false);

  // Step 2 — Flight info + config dump
  const [flightName, setFlightName]     = useState("");
  const [craftName, setCraftName]       = useState("");
  const [notes, setNotes]               = useState("");
  const [configText, setConfigText]     = useState("");
  const [configFile, setConfigFile]     = useState(null);
  const [configStatus, setConfigStatus] = useState("");
  const [configDragOver, setConfigDragOver] = useState(false);

  // Step 3 — Segment definition (current entry form)
  const [segLabel, setSegLabel]         = useState("");
  const [startIter, setStartIter]       = useState("");
  const [endIter, setEndIter]           = useState("");
  const [segNotes, setSegNotes]         = useState("");

  // Step 3 — Staged segments list
  const [stagedSegments, setStagedSegments] = useState([]);

  // Step 4 — Saved IDs

  const csvInputRef    = useRef();
  const configInputRef = useRef();

  // ── Step 1: Load CSV ────────────────────────────────────────────────────
  async function handleCSVFile(file) {
    if (!file) return;
    setError(""); setSuccess("");
    setBusy(true);
    setCsvFile(file);
    setProgress(0);
    try {
      const preambleBlob = file.slice(0, 8192);
      const preambleText = await preambleBlob.text();
      const meta = parsePreamble(preambleText);
      setCsvMeta(meta);
      if (meta.craft_name) setCraftName(meta.craft_name.replace(/"/g, ""));
      if (!flightName) setFlightName(file.name.replace(/\.csv$/i, ""));

      const { headerLine, dataLines } = await streamCSV(file, (pct) => {
        setProgress(pct);
      });
      setCsvHeader(headerLine);
      setCsvDataLines(dataLines);

      const getIter = (ln) => parseInt(ln.split(",")[0], 10);
      if (dataLines.length) {
        setStartIter(String(getIter(dataLines[0])));
        setEndIter(String(getIter(dataLines[dataLines.length - 1])));
      }
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Config dump file loader ─────────────────────────────────────────────
  async function handleConfigFile(file) {
    if (!file) return;
    setConfigFile(file);
    try {
      const text = await file.text();
      setConfigText(text);
      setConfigStatus("ok");
    } catch {
      setConfigStatus("err");
    }
  }

  // ── Step 3: Add segment to staged list ─────────────────────────────────
  function handleAddSegment() {
    setError("");
    const s = parseInt(startIter), e = parseInt(endIter);
    if (isNaN(s) || isNaN(e) || s > e) { setError("Invalid iteration range."); return; }
    if (!segLabel.trim()) { setError("Segment label is required."); return; }
    if (stagedSegments.some(seg => seg.label === segLabel.trim())) {
      setError(`A segment named "${segLabel.trim()}" already exists.`); return;
    }
    const getIter = (ln) => parseInt(ln.split(",")[0], 10);
    const rowCount = csvDataLines.filter(ln => {
      const it = getIter(ln);
      return it >= s && it <= e;
    }).length;
    if (!rowCount) { setError("No rows found in that iteration range."); return; }

    setStagedSegments(prev => [...prev, {
      label: segLabel.trim(),
      startIter: s,
      endIter: e,
      notes: segNotes.trim() || null,
      rowCount,
    }]);

    // Clear form for next segment entry
    setSegLabel("");
    setStartIter("");
    setEndIter("");
    setSegNotes("");
  }

  function handleRemoveSegment(idx) {
    setStagedSegments(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Step 4: Save everything ─────────────────────────────────────────────
  async function handleSave() {
    setBusy(true); setError(""); setSuccess("");
    try {
      const sr = csvMeta?.sampleRateHz;
      const validSr = (sr && isFinite(sr) && sr > 0) ? sr : null;

      // 1. Create flight
      const flight = await createFlight({
        name: flightName.trim() || csvFile?.name || "Flight",
        craft_name: craftName.trim() || null,
        csv_filename: csvFile?.name || null,
        total_loop_iterations: csvDataLines.length || null,
        sample_rate_hz: validSr,
        duration_s: null,
        firmware_version: csvMeta?.firmware_version || null,
        board_name: csvMeta?.board_type || null,
        notes: notes.trim() || null,
      });
      // 2. Save config dump — failure is non-fatal
      if (configText.trim()) {
        try {
          await createConfigDump({ flight_id: flight.id, raw_text: configText });
        } catch (cfgErr) {
          console.warn("Config dump save failed (non-fatal):", cfgErr.message);
        }
      }

      // 3. Clean header
      let cleanHeader = csvHeader.trim();
      if (cleanHeader.startsWith('"')) {
        cleanHeader = cleanHeader.split('","').map(f => f.replace(/^"|"$/g, "")).join(",");
      }

      const getIter = (ln) => parseInt(ln.split(",")[0], 10);

      // 4. Upload each staged segment
      for (const seg of stagedSegments) {
        const filtered = csvDataLines.filter(ln => {
          const it = getIter(ln);
          return it >= seg.startIter && it <= seg.endIter;
        });
        if (!filtered.length) continue;
        const csvContent = [cleanHeader, ...filtered].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv" });
        const safeLabel = seg.label.replace(/[^a-zA-Z0-9_\-]/g, "_");
        await uploadSegment({
          flightId: flight.id,
          label: seg.label,
          startIteration: seg.startIter,
          endIteration: seg.endIter,
          notes: seg.notes,
          csvBlob: blob,
          filename: `${safeLabel}.csv`,
        });
      }

      const n = stagedSegments.length;
      setSuccess(`✓ Saved ${n} segment${n !== 1 ? "s" : ""} for "${flightName.trim() || csvFile?.name}"`);
      setTimeout(() => onSaved && onSaved(flight.id), 1500);
    } catch (err) {
      setError(err.message || "Unknown error — check browser console and backend logs.");
    } finally {
      setBusy(false);
    }
  }

  function resetAll() {
    setStep(1); setCsvFile(null); setCsvMeta(null); setCsvHeader(""); setCsvDataLines([]);
    setProgress(0); setFlightName(""); setCraftName(""); setNotes(""); setConfigText(""); setConfigFile(null);
    setConfigStatus(""); setSegLabel(""); setStartIter(""); setEndIter(""); setSegNotes("");
    setStagedSegments([]); setError(""); setSuccess("");
  }

  const firstIter = csvDataLines.length ? parseInt(csvDataLines[0].split(",")[0]) : 0;
  const lastIter  = csvDataLines.length ? parseInt(csvDataLines[csvDataLines.length - 1].split(",")[0]) : 0;

  return (
    <>
      <style>{CSS}</style>
      <div className="ll-root">

        {/* ── STEP 1: Load CSV ── */}
        <div className="ll-step">
          <div className="ll-step-header">
            <div className="ll-step-num">1</div>
            <div className="ll-step-title">Load Blackbox CSV</div>
            {csvFile && <div className="ll-step-badge">✓ {csvFile.name}</div>}
          </div>

          {!csvFile ? (
            <div
              className={`ll-drop ${csvDragOver ? "over" : ""}`}
              onDragOver={e => { e.preventDefault(); setCsvDragOver(true); }}
              onDragLeave={() => setCsvDragOver(false)}
              onDrop={e => { e.preventDefault(); setCsvDragOver(false); handleCSVFile(e.dataTransfer.files[0]); }}
              onClick={() => csvInputRef.current?.click()}
            >
              <input ref={csvInputRef} type="file" accept=".csv" style={{ display: "none" }}
                onChange={e => handleCSVFile(e.target.files[0])} />
              <div className="ll-drop-icon">📂</div>
              <div className="ll-drop-title">Drop Rotorflight blackbox CSV here</div>
              <div className="ll-drop-sub">or click to browse — handles 300 MB+ files</div>
            </div>
          ) : (
            <div className="ll-info-box">
              <strong style={{ color: "#00c8ff" }}>{csvFile.name}</strong><br />
              {csvDataLines.length.toLocaleString()} data rows &nbsp;·&nbsp;
              Loop iterations: <strong>{firstIter.toLocaleString()}</strong> → <strong>{lastIter.toLocaleString()}</strong><br />
              {csvMeta?.sampleRateHz && <>Sample rate: <strong>{csvMeta.sampleRateHz} Hz</strong> &nbsp;·&nbsp;</>}
              File size: {(csvFile.size / 1024 / 1024).toFixed(1)} MB
            </div>
          )}
          {busy && step === 1 && (
            <div>
              <div className="ll-progress"><div className="ll-progress-fill" style={{ width: `${progress}%` }} /></div>
              <div style={{ fontSize: 10, color: "#475569", fontFamily: "JetBrains Mono,monospace", marginTop: 4 }}>
                Reading… {progress}%
              </div>
            </div>
          )}
        </div>

        {/* ── STEP 2: Flight info + config ── */}
        {step >= 2 && (
          <div className="ll-step">
            <div className="ll-step-header">
              <div className="ll-step-num">2</div>
              <div className="ll-step-title">Flight Info &amp; Config</div>
            </div>

            <div className="ll-grid2">
              <div>
                <div className="ll-label">Flight Name *</div>
                <input className="ll-input" value={flightName} onChange={e => setFlightName(e.target.value)} placeholder="e.g. Sunday tuning session" />
              </div>
              <div>
                <div className="ll-label">Craft Name</div>
                <input className="ll-input" value={craftName} onChange={e => setCraftName(e.target.value)} placeholder="e.g. Vantac RF007" />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="ll-label">Notes (optional)</div>
              <textarea className="ll-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Weather, battery pack, flight conditions…" />
            </div>

            {/* Config dump */}
            <div style={{ marginTop: 16 }}>
              <div className="ll-label">Config Dump (optional — enables PID Profile matching)</div>
              <div
                className={`ll-drop ${configDragOver ? "over" : ""}`}
                style={{ padding: "16px 20px", marginTop: 6 }}
                onDragOver={e => { e.preventDefault(); setConfigDragOver(true); }}
                onDragLeave={() => setConfigDragOver(false)}
                onDrop={e => { e.preventDefault(); setConfigDragOver(false); handleConfigFile(e.dataTransfer.files[0]); }}
                onClick={() => configInputRef.current?.click()}
              >
                <input ref={configInputRef} type="file" accept=".txt,.conf" style={{ display: "none" }}
                  onChange={e => handleConfigFile(e.target.files[0])} />
                <div className="ll-drop-icon" style={{ fontSize: 20 }}>⚙️</div>
                <div className="ll-drop-title" style={{ fontSize: 12 }}>Drop Rotorflight CLI dump file (.txt)</div>
                <div className="ll-drop-sub">or paste below</div>
              </div>
              <div className={`ll-config-status ${configStatus}`} style={{ display: configStatus ? "block" : "none" }}>
                {configStatus === "ok"  && `✓ Config loaded — ${configFile?.name || "pasted"}`}
                {configStatus === "err" && "✗ Could not read config file"}
              </div>
              {!configFile && (
                <textarea className="ll-textarea" rows={4} style={{ marginTop: 8 }}
                  value={configText} onChange={e => setConfigText(e.target.value)}
                  placeholder="Paste 'dump all' output here (optional)…" />
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: Define Segments ── */}
        {step >= 2 && (
          <div className="ll-step">
            <div className="ll-step-header">
              <div className="ll-step-num">3</div>
              <div className="ll-step-title">
                Define Segments
                {stagedSegments.length > 0 && (
                  <span className="ll-seg-count-badge">{stagedSegments.length} queued</span>
                )}
              </div>
              <div className="ll-step-badge">
                available: {firstIter.toLocaleString()} – {lastIter.toLocaleString()}
              </div>
            </div>

            {/* Staged segments list */}
            {stagedSegments.length > 0 && (
              <>
                <div className="ll-seg-list">
                  {stagedSegments.map((seg, idx) => (
                    <div key={idx} className="ll-seg-item">
                      <div className="ll-seg-item-dot" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ll-seg-item-label">{seg.label}</div>
                        <div className="ll-seg-item-meta">
                          {seg.startIter.toLocaleString()} – {seg.endIter.toLocaleString()}
                          &nbsp;·&nbsp;{seg.rowCount.toLocaleString()} rows
                          {seg.notes && <> &nbsp;·&nbsp; {seg.notes}</>}
                        </div>
                      </div>
                      <button className="ll-seg-item-remove" onClick={() => handleRemoveSegment(idx)} title="Remove segment">✕</button>
                    </div>
                  ))}
                </div>
                <hr className="ll-seg-divider" />
              </>
            )}

            {/* Segment entry form */}
            <div>
              <div className="ll-label">Segment Label *</div>
              <input className="ll-input" value={segLabel} onChange={e => setSegLabel(e.target.value)}
                placeholder="e.g. HoverTest, DoubleRoll, FF_tune"
                onKeyDown={e => e.key === "Enter" && handleAddSegment()} />
            </div>

            <div className="ll-grid2" style={{ marginTop: 12 }}>
              <div>
                <div className="ll-label">Start Loop Iteration</div>
                <input className="ll-input" type="number" value={startIter} onChange={e => setStartIter(e.target.value)} placeholder={String(firstIter)} />
              </div>
              <div>
                <div className="ll-label">End Loop Iteration</div>
                <input className="ll-input" type="number" value={endIter} onChange={e => setEndIter(e.target.value)} placeholder={String(lastIter)} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="ll-label">Segment Notes (optional)</div>
              <input className="ll-input" value={segNotes} onChange={e => setSegNotes(e.target.value)} placeholder="What maneuver / tuning goal?" />
            </div>

            {error && <div className="ll-error">{error}</div>}

            <div className="ll-row">
              <button className="ll-btn ll-btn-primary" onClick={handleAddSegment}
                disabled={!segLabel.trim() || !startIter || !endIter}>
                + Add Segment
              </button>
              {stagedSegments.length > 0 && (
                <button className="ll-btn ll-btn-success" onClick={() => { setError(""); setStep(4); }}>
                  Review &amp; Save ({stagedSegments.length}) →
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 4: Review & Save ── */}
        {step >= 4 && (
          <div className="ll-step">
            <div className="ll-step-header">
              <div className="ll-step-num">4</div>
              <div className="ll-step-title">Save &amp; Analyze</div>
            </div>

            <div className="ll-stat-row">
              <div className="ll-stat">
                <div className="ll-stat-val">{stagedSegments.length}</div>
                <div className="ll-stat-sub">Segments</div>
              </div>
              <div className="ll-stat">
                <div className="ll-stat-val">{stagedSegments.reduce((sum, s) => sum + s.rowCount, 0).toLocaleString()}</div>
                <div className="ll-stat-sub">Total Rows</div>
              </div>
              <div className="ll-stat">
                <div className="ll-stat-val">{csvMeta?.sampleRateHz ? `${csvMeta.sampleRateHz}` : "—"}</div>
                <div className="ll-stat-sub">Hz</div>
              </div>
            </div>

            <div className="ll-save-seg-list">
              {stagedSegments.map((seg, idx) => (
                <div key={idx} className="ll-save-seg-item">
                  <div className="ll-seg-item-dot" />
                  <div>
                    <div className="ll-save-seg-label">{seg.label}</div>
                    {seg.notes && <div style={{ fontSize: 10, color: "#475569", fontFamily: "JetBrains Mono,monospace" }}>{seg.notes}</div>}
                  </div>
                  <div className="ll-save-seg-meta">
                    {seg.startIter.toLocaleString()} – {seg.endIter.toLocaleString()}
                    &nbsp;·&nbsp;{seg.rowCount.toLocaleString()} rows
                  </div>
                </div>
              ))}
            </div>

            <div className="ll-filename-preview" style={{ marginTop: 12 }}>
              Flight: <strong style={{ color: "#00c8ff" }}>{flightName || csvFile?.name}</strong>
              {configText && <>&nbsp;·&nbsp;<span style={{ color: "#39ff8a" }}>Config attached</span></>}
            </div>

            {error   && <div className="ll-error">{error}</div>}
            {success && <div className="ll-success">{success}</div>}

            <div className="ll-row">
              <button className="ll-btn ll-btn-ghost" onClick={() => setStep(3)}>← Back</button>
              <button className="ll-btn ll-btn-success" onClick={handleSave} disabled={busy}>
                {busy ? "Saving…" : `⬇ Save to Database`}
              </button>
              <button className="ll-btn ll-btn-ghost" onClick={resetAll}>New Log</button>
            </div>
          </div>
        )}

        {/* Global error banner (steps 1–2) */}
        {error && step < 3 && <div className="ll-error">{error}</div>}
      </div>
    </>
  );
}
