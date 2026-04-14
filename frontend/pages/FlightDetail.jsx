import { useState, useEffect } from "react"
import { api } from "../api"

const MANEUVER_PRESETS = [
  "hover","forward_flight","pirouette","tick_tock","piro_flip",
  "piro_pitch_pump","stationary_flip","stationary_roll","tic_toc_roll",
  "funnels","stall_turn","collective_pitch_pump","step_response","general",
]

export function FlightDetail({ nav, flightId }) {
  const [flight,      setFlight]      = useState(null)
  const [segments,    setSegments]    = useState([])
  const [profiles,    setProfiles]    = useState(null)
  const [step,        setStep]        = useState(1)   // 1=info/dump  2=segments

  // Config dump state
  const [dumpText,    setDumpText]    = useState("")
  const [dumpLoading, setDumpLoading] = useState(false)
  const [dumpError,   setDumpError]   = useState(null)
  const [dumpDot,     setDumpDot]     = useState("")
  const [dumpStatus,  setDumpStatus]  = useState("No config dump loaded")

  // Segment form
  const [segLabel,    setSegLabel]    = useState("")
  const [startIter,   setStartIter]   = useState("")
  const [endIter,     setEndIter]     = useState("")
  const [maneuver,    setManeuver]    = useState("general")
  const [customMnvr,  setCustomMnvr]  = useState("")
  const [pidIdx,      setPidIdx]      = useState("")
  const [rateIdx,     setRateIdx]     = useState("")
  const [segNotes,    setSegNotes]    = useState("")
  const [segError,    setSegError]    = useState(null)
  const [segCreating, setSegCreating] = useState(false)

  useEffect(() => {
    api.flights.get(flightId).then(setFlight)
    api.segments.list(flightId).then(setSegments)
  }, [flightId])

  async function handleDumpUpload(e) {
    e.preventDefault()
    if (!dumpText.trim()) return
    setDumpLoading(true); setDumpError(null)
    setDumpDot("pulse"); setDumpStatus("Parsing config dump…")
    try {
      const result = await api.configDumps.upload(flightId, dumpText)
      const p = await api.configDumps.getProfiles(result.dump_id)
      setProfiles(p)
      setDumpDot("ok")
      setDumpStatus(`Parsed: ${result.pid_profiles} PID profiles, ${result.rate_profiles} rate profiles — craft: ${result.craft_name ?? "unknown"}`)
    } catch (err) {
      setDumpDot("err"); setDumpStatus("Parse failed"); setDumpError(err.message)
    } finally { setDumpLoading(false) }
  }

  async function handleCreateSegment(e) {
    e.preventDefault(); setSegError(null); setSegCreating(true)
    const mnvr = maneuver === "__custom__" ? customMnvr.trim() : maneuver
    try {
      const seg = await api.segments.create({
        flight_id: flightId, label: segLabel,
        start_iteration: parseInt(startIter, 10), end_iteration: parseInt(endIter, 10),
        maneuver_type_name: mnvr || null,
        pid_profile_index:  pidIdx  !== "" ? parseInt(pidIdx,  10) : null,
        rate_profile_index: rateIdx !== "" ? parseInt(rateIdx, 10) : null,
        notes: segNotes || null,
      })
      setSegments(prev => [...prev, seg].sort((a,b) => a.start_iteration - b.start_iteration))
      setSegLabel(""); setStartIter(""); setEndIter(""); setManeuver("general")
      setCustomMnvr(""); setPidIdx(""); setRateIdx(""); setSegNotes("")
    } catch (err) { setSegError(err.message) }
    finally { setSegCreating(false) }
  }

  async function handleDeleteSegment(e, id) {
    e.stopPropagation()
    if (!confirm("Delete segment and all analysis results?")) return
    await api.segments.delete(id).catch(() => {})
    setSegments(prev => prev.filter(s => s.id !== id))
  }

  if (!flight) return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <span className="loading-txt">LOADING FLIGHT DATA…</span>
    </div>
  )

  const iterRange = flight.total_loop_iterations
    ? `0 → ${flight.total_loop_iterations.toLocaleString()}`
    : "unknown"

  return (
    <div className="page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <button className="bc-link" onClick={() => nav("flights")}>Flights</button>
        <span className="breadcrumb-sep">/</span>
        <span style={{ color: "var(--accent)" }}>{flight.name}</span>
      </div>

      {/* Flight summary card */}
      <div className="card" style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
        <div className="card-inner">
          <div className="section-label">Flight Record</div>
          <div className="section-title">{flight.name}</div>

          <div className="sum-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
            {[
              ["Craft",       flight.craft_name,                              "accent"],
              ["Firmware",    flight.firmware_version,                        ""],
              ["Board",       flight.board_name,                              ""],
              ["Duration",    flight.duration_s ? `${flight.duration_s.toFixed(1)}s` : null, ""],
              ["Sample Rate", flight.sample_rate_hz ? `${flight.sample_rate_hz} Hz` : null, ""],
              ["Iter Range",  iterRange,                                      ""],
            ].map(([lbl, val, cls]) => (
              <div className="sum-cell" key={lbl}>
                <span className={`sum-val ${cls}`} style={cls ? {} : { fontSize: 15, color: "var(--text)" }}>
                  {val ?? <span style={{ color: "var(--muted)" }}>—</span>}
                </span>
                <span className="sum-lbl">{lbl}</span>
              </div>
            ))}
          </div>

          {/* Step selector */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
            {[["01", "Config Dump"], ["02", "Segments"]].map(([num, lbl], i) => (
              <button key={num}
                className={`tab-btn ${step === i+1 ? "active" : ""}`}
                onClick={() => setStep(i+1)}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9, opacity: 0.6, marginRight: 6 }}>{num}</span>
                {lbl}
              </button>
            ))}
          </div>

          {/* Step 1: Config dump */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.2s ease" }}>
              {profiles ? (
                <ProfilesView profiles={profiles} onContinue={() => setStep(2)} />
              ) : (
                <form onSubmit={handleDumpUpload} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div className="info-box">
                    Paste the output of{" "}
                    <strong>dump all</strong> from the Rotorflight CLI.
                    This links PID profiles, filter settings, and governor targets to your segments.
                    <br />Loop iteration range in this file: <strong>{iterRange}</strong>
                  </div>

                  <div className="field">
                    <label className="field-label">CLI Output — dump all</label>
                    <textarea
                      className="input"
                      value={dumpText}
                      onChange={e => setDumpText(e.target.value)}
                      placeholder={"# dump all\n# version\n# Rotorflight / STM32F7X2 (S7X2) 4.5.1 Jul 25 2025 / 06:37:48 (e69823a) MSP API: 12.8\n\nprofile 0\n\nset pitch_p_gain = 360\n…"}
                    />
                  </div>

                  <div className="status-bar">
                    <div className={`dot ${dumpDot ? `dot-${dumpDot}` : ""}`} />
                    <span>{dumpStatus}</span>
                  </div>

                  {dumpError && <div className="error-msg">{dumpError}</div>}

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-muted btn-sm" onClick={() => setStep(2)}>
                      SKIP →
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={dumpLoading || !dumpText.trim()}>
                      {dumpLoading ? <span className="loading-txt">PARSING…</span> : "PARSE DUMP →"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Step 2: Add segment */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.2s ease" }}>
              <div className="info-box">
                Define a segment by specifying the <strong>start and end loop iteration</strong> values.
                Find these by opening your CSV in a text editor or using the
                {" "}<strong className="hi2">Excerpt Tool</strong> to identify the range.
                <br />Full log range: <strong>{iterRange}</strong>
                {profiles && <><br />Config dump linked — {profiles.pid_profiles.length} PID profiles available</>}
              </div>

              <form onSubmit={handleCreateSegment}>
                <div className="grid-2" style={{ gap: 14, marginBottom: 14 }}>
                  <div className="field full">
                    <label className="field-label">Segment Label</label>
                    <input className="input" value={segLabel} onChange={e => setSegLabel(e.target.value)}
                      placeholder="e.g. Hover Test — Profile 0" required />
                  </div>
                  <div className="field">
                    <label className="field-label">Start Loop Iteration</label>
                    <input className="input" type="number" min="0" value={startIter}
                      onChange={e => setStartIter(e.target.value)} placeholder="e.g. 0" required />
                  </div>
                  <div className="field">
                    <label className="field-label">End Loop Iteration</label>
                    <input className="input" type="number" min="0" value={endIter}
                      onChange={e => setEndIter(e.target.value)} placeholder="e.g. 4000" required />
                  </div>
                  <div className="field">
                    <label className="field-label">Maneuver Type</label>
                    <select className="input" value={maneuver} onChange={e => setManeuver(e.target.value)}>
                      {MANEUVER_PRESETS.map(m => (
                        <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                      ))}
                      <option value="__custom__">Custom…</option>
                    </select>
                  </div>
                  {maneuver === "__custom__" && (
                    <div className="field">
                      <label className="field-label">Custom Name</label>
                      <input className="input" value={customMnvr} onChange={e => setCustomMnvr(e.target.value)} required placeholder="e.g. inverted pirouette" />
                    </div>
                  )}
                  {profiles && (
                    <>
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
                              Rates {r.profile_index} — roll {r.roll_srate ?? "?"}°/s
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  <div className="field full">
                    <label className="field-label">Notes (optional)</label>
                    <input className="input" value={segNotes} onChange={e => setSegNotes(e.target.value)} placeholder="Conditions, battery, observations…" />
                  </div>
                </div>

                {segError && <div className="error-msg" style={{ marginBottom: 14 }}>{segError}</div>}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-muted btn-sm" onClick={() => setStep(1)}>← BACK</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={segCreating}>
                    {segCreating ? <span className="loading-txt">CREATING…</span> : "ADD SEGMENT →"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Segments list */}
      <div className="card" style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
        <div style={{ padding: "18px 28px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="section-label" style={{ marginBottom: 2 }}>Defined Segments</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", letterSpacing: "2px" }}>
              {segments.length} SEGMENT{segments.length !== 1 ? "S" : ""} — CLICK TO ANALYZE
            </div>
          </div>
          {segments.length > 0 && <span className="tag tag-green">READY TO ANALYZE</span>}
        </div>

        {segments.length === 0 ? (
          <div className="empty-state">
            NO SEGMENTS YET<br />
            <span style={{ fontSize: 10, opacity: 0.5, marginTop: 6, display: "block" }}>
              DEFINE A SEGMENT ABOVE USING LOOP ITERATION NUMBERS
            </span>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Maneuver</th>
                <th>Start Iter</th>
                <th>End Iter</th>
                <th>Duration</th>
                <th>Profile</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {segments.map(s => (
                <tr key={s.id} onClick={() => nav("segment", { flightId, segmentId: s.id })}>
                  <td style={{ color: "#fff", fontWeight: 600 }}>{s.label}</td>
                  <td><span className="tag">{s.maneuver_type?.replace(/_/g," ") ?? "general"}</span></td>
                  <td className="mono dim">{s.start_iteration.toLocaleString()}</td>
                  <td className="mono dim">{s.end_iteration.toLocaleString()}</td>
                  <td className="mono accent">{s.duration_loops?.toLocaleString()} loops</td>
                  <td>{s.pid_profile_id ? <span className="tag tag-accent">LINKED</span> : <span className="dim">—</span>}</td>
                  <td style={{ textAlign: "right", paddingRight: 16 }}>
                    <button className="btn btn-danger btn-sm" onClick={e => handleDeleteSegment(e, s.id)}>DEL</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`@keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }`}</style>
    </div>
  )
}

function ProfilesView({ profiles, onContinue }) {
  const fs = profiles.filter_settings
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="status-bar">
        <div className="dot dot-ok" />
        <span>
          Parsed {profiles.pid_profiles.length} PID profiles · {profiles.rate_profiles.length} rate profiles
          {fs && <> · LPF1: <strong style={{ color: "var(--accent)" }}>{fs.gyro_lpf1_static_hz} Hz</strong>
            · Dyn notch: <strong style={{ color: "var(--accent)" }}>{fs.dyn_notch_min_hz}–{fs.dyn_notch_max_hz} Hz</strong></>}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
        {profiles.pid_profiles.map(p => (
          <div className="profile-chip" key={p.profile_index}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent)", letterSpacing: "2px" }}>
                PROFILE {p.profile_index}
              </span>
              <span className="tag">{p.gov_headspeed_rpm ?? "?"} RPM</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {[
                ["R", p.roll_p_gain,  p.roll_i_gain,  p.roll_d_gain,  "var(--roll)"],
                ["P", p.pitch_p_gain, p.pitch_i_gain, p.pitch_d_gain, "var(--pitch)"],
                ["Y", p.yaw_p_gain,   p.yaw_i_gain,   p.yaw_d_gain,  "var(--yaw)"],
              ].map(([axis, P, I, D, col]) => (
                <div key={axis} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: col, letterSpacing: "1px", marginBottom: 3 }}>{axis}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text)" }}>{P}/{I}/{D}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div>
        <button className="btn btn-primary btn-sm" onClick={onContinue}>DEFINE SEGMENTS →</button>
      </div>
    </div>
  )
}
