import { useState, useEffect } from "react"
import { api } from "../api"

export function FlightManager({ nav }) {
  const [flights,  setFlights]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(null)   // flight id with segments showing
  const [segments, setSegments] = useState({})     // { flightId: [...segments] }
  const [segLoading, setSegLoading] = useState({})

  useEffect(() => {
    api.flights.list()
      .then(setFlights)
      .catch(() => setFlights([]))
      .finally(() => setLoading(false))
  }, [])

  async function toggleFlight(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (segments[id]) return
    setSegLoading(prev => ({ ...prev, [id]: true }))
    try {
      const segs = await api.segments.list(id)
      setSegments(prev => ({ ...prev, [id]: segs }))
    } catch { setSegments(prev => ({ ...prev, [id]: [] })) }
    finally { setSegLoading(prev => ({ ...prev, [id]: false })) }
  }

  async function handleDeleteFlight(e, id) {
    e.stopPropagation()
    if (!confirm("Delete this flight and ALL its segments?")) return
    await api.flights.delete(id).catch(() => {})
    setFlights(prev => prev.filter(f => f.id !== id))
    if (expanded === id) setExpanded(null)
  }

  async function handleDeleteSegment(e, flightId, segId) {
    e.stopPropagation()
    if (!confirm("Delete this segment and all its analysis results?")) return
    await api.segments.delete(segId).catch(() => {})
    setSegments(prev => ({ ...prev, [flightId]: prev[flightId].filter(s => s.id !== segId) }))
  }

  return (
    <div className="wide-page">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div className="section-label">Database</div>
          <h1 style={{ fontFamily: "var(--body)", fontSize: 28, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#fff" }}>
            Saved <span style={{ color: "var(--accent)" }}>Flights</span>
          </h1>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => nav("load")}>
          + LOAD NEW LOG
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="empty-state"><span className="loading-txt">LOADING…</span></div>
        ) : flights.length === 0 ? (
          <div className="empty-state">
            NO FLIGHTS SAVED YET<br />
            <span style={{ fontSize: 10, opacity: 0.5, marginTop: 6, display: "block" }}>
              LOAD A BLACKBOX LOG TO GET STARTED
            </span>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto", padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
              {["Flight Name", "Craft", "Duration", "Sample Rate", "Segments", ""].map(h => (
                <div key={h} style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "3px", textTransform: "uppercase", color: "var(--muted)" }}>{h}</div>
              ))}
            </div>

            {flights.map(f => (
              <div key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
                {/* Flight row */}
                <div
                  style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto", padding: "14px 20px", cursor: "pointer", transition: "background 0.1s", alignItems: "center" }}
                  onClick={() => toggleFlight(f.id)}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(30,58,95,0.4)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: expanded === f.id ? "var(--accent)" : "var(--muted)", transition: "color 0.15s" }}>
                        {expanded === f.id ? "▼" : "▶"}
                      </span>
                      <span style={{ fontWeight: 600, color: "#fff" }}>{f.name}</span>
                    </div>
                    {f.csv_filename && (
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, marginLeft: 20, fontFamily: "var(--mono)" }}>{f.csv_filename}</div>
                    )}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--accent)" }}>{f.craft_name ?? <span style={{ color: "var(--dim)" }}>—</span>}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{f.duration_s ? `${f.duration_s.toFixed(1)}s` : "—"}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{f.sample_rate_hz ? `${f.sample_rate_hz} Hz` : "—"}</div>
                  <div>
                    <span className="tag tag-accent">
                      {segments[f.id]?.length ?? "?"} SEGS
                    </span>
                  </div>
                  <button className="btn btn-danger" style={{ fontSize: 10, padding: "4px 10px" }} onClick={e => handleDeleteFlight(e, f.id)}>DEL</button>
                </div>

                {/* Segments sub-table */}
                {expanded === f.id && (
                  <div style={{ background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
                    {segLoading[f.id] ? (
                      <div style={{ padding: "16px 40px" }}><span className="loading-txt">LOADING SEGMENTS…</span></div>
                    ) : !segments[f.id] || segments[f.id].length === 0 ? (
                      <div style={{ padding: "16px 40px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", letterSpacing: "2px" }}>
                        NO SEGMENTS SAVED FOR THIS FLIGHT
                      </div>
                    ) : (
                      <table className="data-table" style={{ background: "transparent" }}>
                        <thead>
                          <tr>
                            <th style={{ paddingLeft: 40 }}>Label</th>
                            <th>Maneuver</th>
                            <th>Iterations</th>
                            <th>Duration</th>
                            <th>Rows</th>
                            <th>Profile</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {segments[f.id].map(s => (
                            <tr key={s.id} onClick={() => nav("segment", { flightId: f.id, segmentId: s.id })}>
                              <td style={{ paddingLeft: 40, color: "#fff", fontWeight: 600 }}>{s.label}</td>
                              <td><span className="tag">{s.maneuver_type?.replace(/_/g," ") ?? "general"}</span></td>
                              <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                                {s.start_iteration.toLocaleString()} → {s.end_iteration.toLocaleString()}
                              </td>
                              <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--accent)" }}>
                                {s.duration_loops?.toLocaleString()} loops
                              </td>
                              <td style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                                {s.row_count?.toLocaleString() ?? "—"}
                              </td>
                              <td>{s.pid_profile_id ? <span className="tag tag-accent">LINKED</span> : <span style={{ color: "var(--dim)" }}>—</span>}</td>
                              <td style={{ textAlign: "right", paddingRight: 20 }}>
                                <button className="btn btn-danger" style={{ fontSize: 10, padding: "4px 10px" }}
                                  onClick={e => handleDeleteSegment(e, f.id, s.id)}>DEL</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
