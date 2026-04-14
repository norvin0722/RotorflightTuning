import { useState, useEffect } from "react"
import { api } from "../api"

const MANEUVER_PRESETS = [
  "hover", "forward_flight", "pirouette", "tick_tock",
  "piro_flip", "piro_pitch_pump", "stationary_flip",
  "stationary_roll", "tic_toc_roll", "funnels",
  "stall_turn", "collective_pitch_pump", "step_response", "general",
]

export function FlightDetail({ nav, flightId }) {
  const [flight,      setFlight]    = useState(null)
  const [segments,    setSegments]  = useState([])
  const [profiles,    setProfiles]  = useState(null)
  const [dumpText,    setDumpText]  = useState("")
  const [dumpLoading, setDumpLoading] = useState(false)
  const [dumpError,   setDumpError]   = useState(null)
  const [dumpId,      setDumpId]      = useState(null)

  // Segment form state
  const [segLabel,    setSegLabel]    = useState("")
  const [startIter,   setStartIter]   = useState("")
  const [endIter,     setEndIter]     = useState("")
  const [maneuver,    setManeuver]    = useState("general")
  const [customMnvr,  setCustomMnvr]  = useState("")
  const [pidIdx,      setPidIdx]      = useState("")
  const [rateIdx,     setRateIdx]     = useState("")
  const [segNotes,    setSegNotes]    = useState("")
  const [segError,    setSegError]    = useState(null)

  useEffect(() => {
    api.flights.get(flightId).then(setFlight)
    api.segments.list(flightId).then(setSegments)
  }, [flightId])

  async function handleDumpUpload(e) {
    e.preventDefault()
    if (!dumpText.trim()) return
    setDumpLoading(true)
    setDumpError(null)
    try {
      const result = await api.configDumps.upload(flightId, dumpText)
      setDumpId(result.dump_id)
      const p = await api.configDumps.getProfiles(result.dump_id)
      setProfiles(p)
    } catch (err) {
      setDumpError(err.message)
    } finally {
      setDumpLoading(false)
    }
  }

  async function handleCreateSegment(e) {
    e.preventDefault()
    setSegError(null)
    const maneuverName = maneuver === "__custom__" ? customMnvr.trim() : maneuver
    try {
      const seg = await api.segments.create({
        flight_id:          flightId,
        label:              segLabel,
        start_iteration:    parseInt(startIter, 10),
        end_iteration:      parseInt(endIter, 10),
        maneuver_type_name: maneuverName || null,
        pid_profile_index:  pidIdx !== "" ? parseInt(pidIdx, 10) : null,
        rate_profile_index: rateIdx !== "" ? parseInt(rateIdx, 10) : null,
        notes:              segNotes || null,
      })
      setSegments(prev => [...prev, seg].sort((a, b) => a.start_iteration - b.start_iteration))
      setSegLabel(""); setStartIter(""); setEndIter("")
      setManeuver("general"); setCustomMnvr(""); setPidIdx(""); setRateIdx(""); setSegNotes("")
    } catch (err) {
      setSegError(err.message)
    }
  }

  async function handleDeleteSegment(id) {
    if (!confirm("Delete segment and all its analysis results?")) return
    await api.segments.delete(id)
    setSegments(prev => prev.filter(s => s.id !== id))
  }

  if (!flight) return <p style={{ color: "var(--color-text-secondary)" }}>Loading…</p>

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
        <button onClick={() => nav("flights")} style={linkBtn}>Flights</button>
        <span>/</span>
        <span style={{ color: "var(--color-text-primary)" }}>{flight.name}</span>
      </div>

      {/* Flight info */}
      <Card title={flight.name}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {[
            ["Craft",         flight.craft_name],
            ["Firmware",      flight.firmware_version],
            ["Board",         flight.board_name],
            ["Duration",      flight.duration_s ? `${flight.duration_s.toFixed(1)}s` : null],
            ["Sample rate",   flight.sample_rate_hz ? `${flight.sample_rate_hz} Hz` : null],
            ["Loop count",    flight.total_loop_iterations?.toLocaleString()],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 14 }}>{val ?? "—"}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Config dump */}
      <Card title="Config Dump (dump all)">
        {profiles ? (
          <ProfilesSummary profiles={profiles} />
        ) : (
          <form onSubmit={handleDumpUpload} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
              Paste the output of <code>dump all</code> from the Rotorflight CLI to associate
              PID profiles and filter settings with your segments.
            </p>
            <textarea
              value={dumpText}
              onChange={e => setDumpText(e.target.value)}
              placeholder="# dump all&#10;# version&#10;# Rotorflight / STM32F7X2..."
              rows={8}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
            />
            {dumpError && <p style={{ color: "var(--color-text-danger)", fontSize: 13 }}>{dumpError}</p>}
            <button type="submit" disabled={dumpLoading} style={primaryBtn}>
              {dumpLoading ? "Parsing…" : "Parse config dump"}
            </button>
          </form>
        )}
      </Card>

      {/* Create segment */}
      <Card title="Add Segment">
        <form onSubmit={handleCreateSegment}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Label text="Label" full>
              <input value={segLabel} onChange={e => setSegLabel(e.target.value)}
                placeholder="e.g. Hover test 1" required style={inputStyle} />
            </Label>
            <Label text="Maneuver type" full>
              <select value={maneuver} onChange={e => setManeuver(e.target.value)} style={inputStyle}>
                {MANEUVER_PRESETS.map(m => (
                  <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
            </Label>
            {maneuver === "__custom__" && (
              <Label text="Custom maneuver name" full>
                <input value={customMnvr} onChange={e => setCustomMnvr(e.target.value)}
                  placeholder="e.g. inverted pirouette" required style={inputStyle} />
              </Label>
            )}
            <Label text="Start loop iteration">
              <input type="number" value={startIter}
                onChange={e => setStartIter(e.target.value)} required
                placeholder="0" style={inputStyle} />
            </Label>
            <Label text="End loop iteration">
              <input type="number" value={endIter}
                onChange={e => setEndIter(e.target.value)} required
                placeholder="1000" style={inputStyle} />
            </Label>
            {profiles && (
              <>
                <Label text="PID profile index">
                  <select value={pidIdx} onChange={e => setPidIdx(e.target.value)} style={inputStyle}>
                    <option value="">— select —</option>
                    {profiles.pid_profiles.map(p => (
                      <option key={p.profile_index} value={p.profile_index}>
                        Profile {p.profile_index} ({p.gov_headspeed_rpm ?? "?"} RPM)
                      </option>
                    ))}
                  </select>
                </Label>
                <Label text="Rate profile index">
                  <select value={rateIdx} onChange={e => setRateIdx(e.target.value)} style={inputStyle}>
                    <option value="">— select —</option>
                    {profiles.rate_profiles.map(r => (
                      <option key={r.profile_index} value={r.profile_index}>
                        Rate {r.profile_index} (roll {r.roll_srate}°/s)
                      </option>
                    ))}
                  </select>
                </Label>
              </>
            )}
            <Label text="Notes" full>
              <input value={segNotes} onChange={e => setSegNotes(e.target.value)}
                placeholder="Optional notes about this segment" style={inputStyle} />
            </Label>
          </div>
          {segError && <p style={{ color: "var(--color-text-danger)", fontSize: 13, marginTop: 8 }}>{segError}</p>}
          <button type="submit" style={{ ...primaryBtn, marginTop: 16 }}>Add segment</button>
        </form>
      </Card>

      {/* Segments list */}
      <Card title={`Segments (${segments.length})`}>
        {segments.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            No segments yet. Define a segment above using loop iteration numbers from your log.
          </p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                {["Label", "Maneuver", "Start iter", "End iter", "Duration", "PID profile", ""].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {segments.map(s => (
                <tr key={s.id} style={{ cursor: "pointer" }}
                  onClick={() => nav("segment", { flightId, segmentId: s.id })}>
                  <td style={tdStyle}>{s.label}</td>
                  <td style={tdStyle}>{s.maneuver_type?.replace(/_/g, " ") ?? "—"}</td>
                  <td style={tdStyle}>{s.start_iteration.toLocaleString()}</td>
                  <td style={tdStyle}>{s.end_iteration.toLocaleString()}</td>
                  <td style={tdStyle}>{s.duration_loops?.toLocaleString()} loops</td>
                  <td style={tdStyle}>{s.pid_profile_id ? "✓" : "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button onClick={e => { e.stopPropagation(); handleDeleteSegment(s.id) }}
                      style={ghostBtn}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function ProfilesSummary({ profiles }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
        ✓ Config dump parsed — {profiles.pid_profiles.length} PID profiles,{" "}
        {profiles.rate_profiles.length} rate profiles
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
        {profiles.pid_profiles.map(p => (
          <div key={p.profile_index} style={profileChip}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Profile {p.profile_index}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
              {p.gov_headspeed_rpm ? `${p.gov_headspeed_rpm} RPM` : "—"}
              {" · "}P/R/Y {p.roll_p_gain}/{p.pitch_p_gain}/{p.yaw_p_gain}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared UI ────────────────────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:24 }}>
      <h2 style={{ fontSize:16, fontWeight:500, margin:"0 0 16px" }}>{title}</h2>
      {children}
    </div>
  )
}

function Label({ text, children, full }) {
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={{ fontSize:13, color:"var(--color-text-secondary)" }}>{text}</span>
      {children}
    </label>
  )
}

const inputStyle = { padding:"8px 12px", borderRadius:8, border:"1px solid var(--color-border-secondary)", background:"var(--color-background-secondary)", color:"var(--color-text-primary)", fontSize:14, outline:"none" }
const primaryBtn = { padding:"9px 18px", borderRadius:8, border:"none", background:"var(--color-text-primary)", color:"var(--color-background-primary)", fontSize:14, fontWeight:500, cursor:"pointer", alignSelf:"flex-start" }
const ghostBtn   = { padding:"5px 10px", borderRadius:6, border:"1px solid var(--color-border-secondary)", background:"transparent", color:"var(--color-text-secondary)", fontSize:12, cursor:"pointer" }
const linkBtn    = { background:"none", border:"none", cursor:"pointer", color:"var(--color-text-secondary)", fontSize:13, padding:0 }
const tableStyle = { width:"100%", borderCollapse:"collapse", fontSize:14 }
const thStyle    = { textAlign:"left", padding:"8px 12px", color:"var(--color-text-secondary)", fontWeight:500, fontSize:12, borderBottom:"1px solid var(--color-border-tertiary)" }
const tdStyle    = { padding:"10px 12px", borderBottom:"1px solid var(--color-border-tertiary)" }
const profileChip = { background:"var(--color-background-secondary)", borderRadius:8, padding:"8px 12px", border:"1px solid var(--color-border-tertiary)" }
