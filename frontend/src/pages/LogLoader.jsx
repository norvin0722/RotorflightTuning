import { useState, useRef } from "react"
import { api } from "../api"

const MANEUVER_PRESETS = [
  "hover","forward_flight","pirouette","tick_tock","piro_flip",
  "piro_pitch_pump","stationary_flip","stationary_roll","tic_toc_roll",
  "funnels","stall_turn","collective_pitch_pump","step_response","general",
]

// ── Browser-side CSV helpers ──────────────────────────────────────────────────

function parsePreamble(lines) {
  const meta = {}
  const kvRe = /^"?([^",]+)"?,(.+)$/
  for (const line of lines) {
    const m = line.trim().match(kvRe)
    if (!m) continue
    const key = m[1].trim().replace(/^"|"$/g, "")
    const val = m[2].trim().replace(/^"|"$/g, "")
    const n = Number(val)
    meta[key] = isNaN(n) ? val : n
  }
  return meta
}

function deriveSampleRate(meta) {
  const looptime = Number(meta["looptime"]) || 250
  const pid      = Number(meta["pid_process_denom"]) || 2
  const log      = Number(meta["frameIntervalPDenom"]) || 1
  return (1_000_000 / looptime) / pid / log
}

function getLoopIter(line) {
  const comma = line.indexOf(",")
  return parseInt(comma === -1 ? line : line.substring(0, comma), 10)
}

function unquoteHeader(line) {
  const t = line.trim()
  if (!t.startsWith('"')) return t
  return t.split('","').map(f => f.replace(/^"|"$/g, "")).join(",")
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LogLoader({ nav }) {
  // ── Step ──────────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1)  // 1 | 2 | 3 | 4

  // ── Step 1 state (file load) ───────────────────────────────────────────────
  const [fileDot,      setFileDot]      = useState("")
  const [fileStatus,   setFileStatus]   = useState("No file selected")
  const [fileError,    setFileError]    = useState(null)
  const [progress,     setProgress]     = useState(0)
  const [showProgress, setShowProgress] = useState(false)
  const fileRef = useRef(null)

  // Parsed log (all in browser memory — never uploaded)
  const [logMeta,    setLogMeta]    = useState(null)
  const [headerLine, setHeaderLine] = useState("")
  const [dataLines,  setDataLines]  = useState([])
  const [firstIter,  setFirstIter]  = useState(null)
  const [lastIter,   setLastIter]   = useState(null)
  const [fileName,   setFileName]   = useState("")

  // ── Step 2 state (flight info + config dump) ───────────────────────────────
  const [flightName,   setFlightName]   = useState("")
  const [dumpText,     setDumpText]     = useState("")
  const [dumpFileName, setDumpFileName] = useState("")
  const [profiles,     setProfiles]     = useState(null)
  const [flightId,     setFlightId]     = useState(null)
  const [dumpDot,      setDumpDot]      = useState("")
  const [dumpStatus,   setDumpStatus]   = useState("No config dump loaded")
  const [dumpError,    setDumpError]    = useState(null)
  const [step2Loading, setStep2Loading] = useState(false)
  const dumpFileRef = useRef(null)

  // ── Step 3 state (define segment) ─────────────────────────────────────────
  const [segLabel,   setSegLabel]   = useState("")
  const [startIter,  setStartIter]  = useState("")
  const [endIter,    setEndIter]    = useState("")
  const [maneuver,   setManeuver]   = useState("general")
  const [customMnvr, setCustomMnvr] = useState("")
  const [pidIdx,     setPidIdx]     = useState("")
  const [rateIdx,    setRateIdx]    = useState("")
  const [segNotes,   setSegNotes]   = useState("")
  const [segError,   setSegError]   = useState(null)
  const [sliceCount, setSliceCount] = useState(null)

  // ── Step 4 state (preview + save) ─────────────────────────────────────────
  const [sliceRows,      setSliceRows]      = useState([])
  const [saving,         setSaving]         = useState(false)
  const [saveError,      setSaveError]      = useState(null)
  const [saveDot,        setSaveDot]        = useState("")
  const [saveStatus,     setSaveStatus]     = useState("Ready to save")
  const [savedSegments,  setSavedSegments]  = useState([])

  // ── Step 1: Load CSV ───────────────────────────────────────────────────────

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileDot("pulse"); setFileStatus("Reading file…"); setFileError(null)
    setShowProgress(true); setProgress(0)

    const reader = new FileReader()
    reader.onprogress = ev => { if (ev.lengthComputable) setProgress(ev.loaded / ev.total * 100) }
    reader.onload = ev => {
      setShowProgress(false)
      const lines = ev.target.result.split(/\r?\n/)

      let headerIdx = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].replace(/^"/, "").startsWith("loopIteration")) { headerIdx = i; break }
      }
      if (headerIdx === -1) {
        setFileDot("err"); setFileError("No loopIteration header found — is this a Rotorflight blackbox CSV?")
        setFileStatus("Invalid file"); return
      }

      const meta   = parsePreamble(lines.slice(0, headerIdx))
      const hLine  = lines[headerIdx]
      const dLines = lines.slice(headerIdx + 1).filter(l => l.trim().length > 0)

      if (dLines.length === 0) {
        setFileDot("err"); setFileError("Header found but no data rows.")
        setFileStatus("Empty log"); return
      }

      const fi = getLoopIter(dLines[0])
      const li = getLoopIter(dLines[dLines.length - 1])
      const sr = deriveSampleRate(meta)
      const dur = (dLines.length / sr).toFixed(1)

      setLogMeta({ ...meta, sample_rate_hz: sr, duration_s: parseFloat(dur), original_filename: file.name })
      setHeaderLine(hLine); setDataLines(dLines)
      setFirstIter(fi); setLastIter(li); setFileName(file.name)

      const craft = meta["Craft name"] || meta["craft_name"] || meta["name"] || ""
      setFlightName(craft ? `${craft} — ${new Date().toLocaleDateString()}` : file.name.replace(/\.csv$/i, ""))
      setStartIter(String(fi)); setEndIter(String(li))

      setFileDot("ok")
      setFileStatus(`${file.name}  ·  ${dLines.length.toLocaleString()} rows  ·  ${fi.toLocaleString()} → ${li.toLocaleString()}  ·  ${dur}s @ ${sr} Hz`)
      setTimeout(() => setStep(2), 200)
    }
    reader.onerror = () => { setShowProgress(false); setFileDot("err"); setFileStatus("Error reading file") }
    reader.readAsText(file)
  }

  // ── Step 2: Dump file upload ───────────────────────────────────────────────

  function handleDumpFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setDumpFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      setDumpText(ev.target.result)
      setDumpDot("ok")
      setDumpStatus(`Loaded: ${file.name}  (${(file.size / 1024).toFixed(0)} KB)`)
    }
    reader.onerror = () => { setDumpDot("err"); setDumpStatus("Error reading dump file") }
    reader.readAsText(file)
  }

  // ── Step 2: Create flight record + parse dump ──────────────────────────────

  async function handleContinue(e) {
    e?.preventDefault()
    setDumpError(null); setStep2Loading(true)
    setDumpDot("pulse"); setDumpStatus("Creating flight record…")

    // 1. Create flight in DB (metadata only — no CSV upload)
    let fid = flightId
    if (!fid) {
      try {
        const flight = await api.flights.create({
          name:                  flightName.trim() || fileName,
          craft_name:            logMeta["Craft name"] || logMeta["craft_name"] || null,
          firmware_version:      logMeta["firmwareVersion"] || logMeta["Firmware revision"] || null,
          board_name:            logMeta["Board information"] || null,
          sample_rate_hz:        logMeta.sample_rate_hz,
          total_loop_iterations: lastIter,
          duration_s:            logMeta.duration_s,
          original_filename:     logMeta.original_filename,
        })
        fid = flight.id
        setFlightId(fid)
        setDumpStatus("Flight record created")
      } catch (err) {
        setDumpDot("err")
        setDumpStatus("Failed to create flight")
        setDumpError(
          `API error: ${err.message}. ` +
          `Check that the backend is running at http://localhost:8000 ` +
          `(open http://localhost:8000/health in your browser to verify).`
        )
        setStep2Loading(false); return
      }
    }

    // 2. Parse config dump if provided
    if (dumpText.trim()) {
      setDumpStatus("Parsing config dump…")
      try {
        const result = await api.configDumps.upload(fid, dumpText)
        const p = await api.configDumps.getProfiles(result.dump_id)
        setProfiles(p)
        setDumpDot("ok")
        setDumpStatus(`Parsed: ${result.pid_profiles} PID profiles, ${result.rate_profiles} rate profiles`)
      } catch (err) {
        setDumpDot("warn")
        setDumpStatus(`Config dump parse failed: ${err.message} — continuing without it`)
      }
    } else {
      setDumpDot("ok"); setDumpStatus("Flight saved — no config dump")
    }

    setStep2Loading(false)
    setStep(3)
  }

  // ── Step 3: Live slice preview ─────────────────────────────────────────────

  function getSliceCount(s, e2) {
    if (isNaN(s) || isNaN(e2) || s >= e2) return null
    return dataLines.filter(ln => { const i = getLoopIter(ln); return i >= s && i <= e2 }).length
  }

  function handleRangeChange(field, val) {
    if (field === "start") setStartIter(val)
    else setEndIter(val)
    const s = field === "start" ? parseInt(val, 10) : parseInt(startIter, 10)
    const e2 = field === "end"   ? parseInt(val, 10) : parseInt(endIter,   10)
    setSliceCount(getSliceCount(s, e2))
  }

  function handlePreview(e) {
    e.preventDefault(); setSegError(null)
    const s  = parseInt(startIter, 10)
    const e2 = parseInt(endIter,   10)
    if (isNaN(s) || isNaN(e2)) { setSegError("Enter valid iteration numbers."); return }
    if (s >= e2)                { setSegError("Start must be less than end."); return }
    if (!segLabel.trim())       { setSegError("Enter a segment label."); return }

    const slice = dataLines.filter(ln => { const i = getLoopIter(ln); return i >= s && i <= e2 })
    if (slice.length === 0) { setSegError(`No rows found between ${s.toLocaleString()} and ${e2.toLocaleString()}.`); return }

    setSliceRows(slice)
    setStep(4)
  }

  // ── Step 4: Save ──────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setSaveError(null)
    setSaveDot("pulse"); setSaveStatus("Uploading segment slice…")

    const s   = parseInt(startIter, 10)
    const e2  = parseInt(endIter,   10)
    const mnvr = maneuver === "__custom__" ? customMnvr.trim() : maneuver
    const csvText = [unquoteHeader(headerLine), ...sliceRows].join("\n")

    try {
      const seg = await api.segments.upload(
        {
          flightId:          flightId,
          label:             segLabel,
          startIteration:    s,
          endIteration:      e2,
          rowCount:          sliceRows.length,
          maneuverTypeName:  mnvr,
          pidProfileIndex:   pidIdx  !== "" ? parseInt(pidIdx,  10) : null,
          rateProfileIndex:  rateIdx !== "" ? parseInt(rateIdx, 10) : null,
          notes:             segNotes,
        },
        csvText,
      )
      setSavedSegments(prev => [...prev, seg])
      setSaveDot("ok")
      setSaveStatus(`Saved: "${seg.label}"  ·  ${sliceRows.length.toLocaleString()} rows`)
    } catch (err) {
      setSaveDot("err"); setSaveStatus("Save failed"); setSaveError(err.message)
    } finally { setSaving(false) }
  }

  function addAnother() {
    setSegLabel(""); setStartIter(String(firstIter)); setEndIter(String(lastIter))
    setManeuver("general"); setCustomMnvr(""); setPidIdx(""); setRateIdx(""); setSegNotes("")
    setSliceRows([]); setSegError(null); setSliceCount(null)
    setSaveDot(""); setSaveStatus("Ready to save"); setSaveError(null)
    setStep(3)
  }

  function startOver() {
    setStep(1); setLogMeta(null); setHeaderLine(""); setDataLines([])
    setFirstIter(null); setLastIter(null); setFileName(""); setFlightId(null)
    setProfiles(null); setDumpText(""); setDumpFileName("")
    setFileDot(""); setFileStatus("No file selected"); setFileError(null)
    setFlightName(""); setDumpDot(""); setDumpStatus("No config dump loaded")
    setSegLabel(""); setStartIter(""); setEndIter(""); setManeuver("general")
    setCustomMnvr(""); setPidIdx(""); setRateIdx(""); setSegNotes("")
    setSliceRows([]); setSavedSegments([]); setSaveDot(""); setSaveStatus("Ready to save")
    setSliceCount(null); setDumpError(null)
    if (fileRef.current)     fileRef.current.value = ""
    if (dumpFileRef.current) dumpFileRef.current.value = ""
  }

  // ── Derived display values ─────────────────────────────────────────────────

  const sr    = logMeta?.sample_rate_hz
  const craft = logMeta ? (logMeta["Craft name"] || logMeta["craft_name"] || "Unknown") : ""
  const previewCount = sliceCount ?? (startIter && endIter
    ? getSliceCount(parseInt(startIter, 10), parseInt(endIter, 10))
    : null)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: "100%", maxWidth: "var(--card-w)", display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Header */}
      <header style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "4px", color: "var(--accent)", opacity: 0.7, marginBottom: 8 }}>ROTORFLIGHT BLACKBOX</div>
        <h1 style={{ fontFamily: "var(--body)", fontSize: 40, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#fff", lineHeight: 1 }}>
          Log <span style={{ color: "var(--accent)" }}>Analyzer</span>
        </h1>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "3px", color: "var(--muted)", textTransform: "uppercase", marginTop: 8 }}>Extract · Analyze · Tune</div>
      </header>

      {/* Step indicator */}
      <div style={{ display: "flex", gap: 0, marginBottom: 0 }}>
        {[1,2,3,4].map(n => (
          <div key={n} style={{
            flex: 1, height: 3,
            background: step >= n ? "var(--accent)" : "var(--dim)",
            transition: "background 0.3s",
            marginRight: n < 4 ? 3 : 0,
          }} />
        ))}
      </div>

      <div className="card">
        <div className="card-body">

          {/* ── STEP 1: Load CSV ────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="step active">
              <div className="step-label">Step 01 / 04</div>
              <div className="step-title">Load Blackbox CSV</div>

              <div className="field">
                <label className="field-label">Select Blackbox CSV File</label>
                <input type="file" accept=".csv" ref={fileRef} onChange={handleFileChange} style={fileInputStyle} />
              </div>

              <div className="status-bar">
                <div className={`dot ${fileDot ? `dot-${fileDot}` : ""}`} />
                <span>{fileStatus}</span>
              </div>

              {showProgress && (
                <div className="prog-bar">
                  <div className="prog-fill" style={{ width: progress + "%" }} />
                </div>
              )}

              {fileError && <div className="error-msg">{fileError}</div>}

              <div className="info-box">
                Files up to <strong>300+ MB</strong> are processed <strong>entirely in your browser</strong>.
                No server upload — only small segment slices are saved to the database.
              </div>
            </div>
          )}

          {/* ── STEP 2: Flight info + config dump ───────────────────────────── */}
          {step === 2 && (
            <div className="step active">
              <div className="step-label">Step 02 / 04</div>
              <div className="step-title">Flight Info &amp; Config Dump</div>

              <div className="info-box">
                <strong style={{ color: "var(--accent2)" }}>{fileName}</strong> — {dataLines.length.toLocaleString()} rows<br />
                Craft: <strong>{craft}</strong> · Range: <strong>{firstIter?.toLocaleString()} → {lastIter?.toLocaleString()}</strong>
                {logMeta?.duration_s && <> · <strong>{logMeta.duration_s}s</strong> @ <strong>{sr} Hz</strong></>}
              </div>

              <div className="field">
                <label className="field-label">Flight Name</label>
                <input className="input" value={flightName} onChange={e => setFlightName(e.target.value)}
                  placeholder="e.g. Genesis — 3D Practice" />
              </div>

              {/* Config dump — file OR paste */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="field-label" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "3px", textTransform: "uppercase", color: "var(--muted)" }}>
                  Config Dump — Optional
                </div>

                {/* File upload option */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label style={{
                    display: "inline-flex", alignItems: "center", gap: 10,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    borderRadius: 3, padding: "9px 14px", cursor: "pointer",
                    fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)",
                    transition: "border-color 0.2s", whiteSpace: "nowrap",
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1V9M3.5 5L7 1L10.5 5" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M1 12H13" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                    {dumpFileName || "Upload .txt file"}
                    <input type="file" accept=".txt,.cli,.conf" ref={dumpFileRef} onChange={handleDumpFileChange} style={{ display: "none" }} />
                  </label>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>or paste below</span>
                </div>

                <textarea
                  className="input"
                  value={dumpText}
                  onChange={e => { setDumpText(e.target.value); if (e.target.value) { setDumpDot("ok"); setDumpStatus("Dump text ready") } }}
                  placeholder={"# dump all\n# version\n# Rotorflight / STM32F7X2 (S7X2) 4.5.1…\n\nprofile 0\nset pitch_p_gain = 360\n…"}
                />
              </div>

              <div className="status-bar">
                <div className={`dot ${dumpDot ? `dot-${dumpDot}` : ""}`} />
                <span>{dumpStatus}</span>
              </div>

              {dumpError && <div className="error-msg">{dumpError}</div>}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button className="btn btn-muted btn-sm" onClick={() => setStep(1)}>← BACK</button>
                <button className="btn btn-muted btn-sm" onClick={handleContinue} disabled={step2Loading}>
                  SKIP DUMP →
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleContinue} disabled={step2Loading}>
                  {step2Loading ? <span className="loading-txt">SAVING…</span> : "CONTINUE →"}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Define segment ───────────────────────────────────────── */}
          {step === 3 && (
            <div className="step active">
              <div className="step-label">Step 03 / 04</div>
              <div className="step-title">Define Segment</div>

              <div className="info-box">
                Log range: <strong>{firstIter?.toLocaleString()} → {lastIter?.toLocaleString()}</strong>
                {" "}({dataLines.length.toLocaleString()} total rows)<br />
                {profiles
                  ? <><strong style={{ color: "var(--green)" }}>✓ Config dump linked</strong> — {profiles.pid_profiles.length} PID profiles available</>
                  : "Enter the loop iteration range for the maneuver you want to analyze."}
              </div>

              <form onSubmit={handlePreview} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="field">
                  <label className="field-label">Segment Label</label>
                  <input className="input" value={segLabel} onChange={e => setSegLabel(e.target.value)}
                    placeholder="e.g. Hover Test — Profile 0" required />
                </div>

                <div className="grid-2">
                  <div className="field">
                    <label className="field-label">Start Loop Iteration</label>
                    <input className="input" type="number" min="0"
                      value={startIter}
                      onChange={e => handleRangeChange("start", e.target.value)}
                      placeholder={firstIter} required />
                  </div>
                  <div className="field">
                    <label className="field-label">End Loop Iteration</label>
                    <input className="input" type="number" min="0"
                      value={endIter}
                      onChange={e => handleRangeChange("end", e.target.value)}
                      placeholder={lastIter} required />
                  </div>
                </div>

                {/* Live row count preview */}
                {previewCount !== null && (
                  <div className="filename-preview">
                    {previewCount <= 0
                      ? "⚠  No rows in this range — check your iteration values"
                      : `~${previewCount.toLocaleString()} rows  ·  ~${sr ? (previewCount / sr).toFixed(2) : "?"}s  ·  ~${(previewCount * 0.5 / 1024).toFixed(1)} KB to save`
                    }
                  </div>
                )}

                <div className="field">
                  <label className="field-label">Maneuver Type</label>
                  <select className="input" value={maneuver} onChange={e => setManeuver(e.target.value)}>
                    {MANEUVER_PRESETS.map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                    <option value="__custom__">Custom…</option>
                  </select>
                </div>

                {maneuver === "__custom__" && (
                  <div className="field">
                    <label className="field-label">Custom Maneuver Name</label>
                    <input className="input" value={customMnvr} onChange={e => setCustomMnvr(e.target.value)}
                      placeholder="e.g. inverted pirouette" required />
                  </div>
                )}

                {profiles && (
                  <div className="grid-2">
                    <div className="field">
                      <label className="field-label">PID Profile</label>
                      <select className="input" value={pidIdx} onChange={e => setPidIdx(e.target.value)}>
                        <option value="">— select —</option>
                        {profiles.pid_profiles.map(p => (
                          <option key={p.profile_index} value={p.profile_index}>
                            Profile {p.profile_index} — {p.gov_headspeed_rpm ?? "?"} RPM
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label className="field-label">Rate Profile</label>
                      <select className="input" value={rateIdx} onChange={e => setRateIdx(e.target.value)}>
                        <option value="">— select —</option>
                        {profiles.rate_profiles.map(r => (
                          <option key={r.profile_index} value={r.profile_index}>
                            Rates {r.profile_index} — {r.roll_srate ?? "?"}°/s
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="field">
                  <label className="field-label">Notes (optional)</label>
                  <input className="input" value={segNotes} onChange={e => setSegNotes(e.target.value)}
                    placeholder="Battery level, wind conditions, observations…" />
                </div>

                {segError && <div className="error-msg">{segError}</div>}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-muted btn-sm" onClick={() => setStep(2)}>← BACK</button>
                  <button type="submit" className="btn btn-primary btn-sm">PREVIEW →</button>
                </div>
              </form>
            </div>
          )}

          {/* ── STEP 4: Preview + save ───────────────────────────────────────── */}
          {step === 4 && (
            <div className="step active">
              <div className="step-label">Step 04 / 04</div>
              <div className="step-title">Preview &amp; Save</div>

              <div className="sum-grid">
                <div className="sum-cell">
                  <span className="sum-val">{sliceRows.length.toLocaleString()}</span>
                  <span className="sum-lbl">Rows</span>
                </div>
                <div className="sum-cell">
                  <span className="sum-val">{parseInt(startIter).toLocaleString()}</span>
                  <span className="sum-lbl">Start Iter</span>
                </div>
                <div className="sum-cell">
                  <span className="sum-val">{parseInt(endIter).toLocaleString()}</span>
                  <span className="sum-lbl">End Iter</span>
                </div>
              </div>

              <div className="info-box">
                <strong>Segment:</strong> {segLabel}<br />
                <strong>Maneuver:</strong> {(maneuver === "__custom__" ? customMnvr : maneuver).replace(/_/g, " ")}<br />
                <strong>Flight:</strong> {flightName}<br />
                {sr && <><strong>Duration:</strong> ~{(sliceRows.length / sr).toFixed(2)}s @ {sr} Hz</>}
                {pidIdx !== "" && profiles && (
                  <><br /><strong>Profile:</strong> {pidIdx} — {profiles.pid_profiles.find(p => p.profile_index === parseInt(pidIdx))?.gov_headspeed_rpm ?? "?"} RPM</>
                )}
              </div>

              <div className="status-bar">
                <div className={`dot ${saveDot ? `dot-${saveDot}` : ""}`} />
                <span>{saveStatus}</span>
              </div>

              {saveError && <div className="error-msg">{saveError}</div>}

              {savedSegments.length > 0 && (
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--green)", letterSpacing: "1px", lineHeight: 2 }}>
                  {savedSegments.map(s => (
                    <div key={s.id}>✓  {s.label} — {s.duration_loops?.toLocaleString()} loops saved</div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button className="btn btn-muted btn-sm" onClick={() => setStep(3)}>← BACK</button>
                <button className="btn btn-green" onClick={handleSave} disabled={saving || saveDot === "ok"}>
                  {saving ? <span className="loading-txt">SAVING…</span> : saveDot === "ok" ? "✓ SAVED" : "⬇  SAVE SEGMENT"}
                </button>
                {saveDot === "ok" && (
                  <>
                    <button className="btn btn-sm" onClick={addAnother}>+ ANOTHER SEGMENT</button>
                    <button className="btn btn-muted btn-sm" onClick={() => nav("flights")}>VIEW FLIGHTS →</button>
                  </>
                )}
                <button className="btn btn-muted btn-sm" onClick={startOver}>NEW LOG</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

const fileInputStyle = {
  background: "var(--surface2)", border: "1px solid var(--border)",
  borderRadius: 3, color: "var(--text)", fontFamily: "var(--mono)",
  fontSize: 13, padding: "10px 14px", width: "100%", cursor: "pointer",
}
