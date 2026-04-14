import { useState, useEffect } from "react"
import { api } from "../api"

export function FlightList({ nav }) {
  const [flights,   setFlights]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [dotState,  setDotState]  = useState("")
  const [statusTxt, setStatusTxt] = useState("No file selected")
  const [error,     setError]     = useState(null)
  const [name,      setName]      = useState("")
  const [file,      setFile]      = useState(null)

  useEffect(() => {
    api.flights.list()
      .then(setFlights)
      .catch(() => setFlights([]))
      .finally(() => setLoading(false))
  }, [])

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setDotState("ok")
    setStatusTxt(`${f.name}  |  ${(f.size / 1024 / 1024).toFixed(1)} MB`)
    if (!name) setName(f.name.replace(/\.csv$/i, "").replace(/_/g, " "))
    setError(null)
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!file || !name.trim()) return
    setUploading(true); setError(null)
    setDotState("pulse"); setStatusTxt("Uploading…")

    try {
      const flight = await api.flights.upload(file, name.trim())
      setFlights(prev => [flight, ...prev])
      setDotState("ok")
      setStatusTxt(`Uploaded: ${flight.name}`)
      setName(""); setFile(null)
      e.target.reset()
    } catch (err) {
      setDotState("err")
      setStatusTxt("Upload failed")
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!confirm("Delete this flight and all segments?")) return
    await api.flights.delete(id).catch(() => {})
    setFlights(prev => prev.filter(f => f.id !== id))
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div className="section-label">Flight Management</div>
        <h1 style={{ fontFamily: "var(--body)", fontSize: 36, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#fff", lineHeight: 1 }}>
          Upload <span style={{ color: "var(--accent)" }}>Blackbox</span> Log
        </h1>
        <p style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "3px", color: "var(--muted)", marginTop: 8, textTransform: "uppercase" }}>
          Load a Rotorflight CSV export to begin analysis
        </p>
      </div>

      {/* Upload card */}
      <div className="card" style={{ maxWidth: 680, width: "100%", margin: "0 auto" }}>
        <div className="card-inner">
          <div className="section-label">Step 01</div>
          <div className="section-title">Select Flight Log</div>

          <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="field">
              <label className="field-label">Blackbox CSV File</label>
              <input
                type="file" accept=".csv"
                onChange={handleFileChange}
                style={{
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  borderRadius: 3, color: "var(--text)", fontFamily: "var(--mono)",
                  fontSize: 13, padding: "10px 14px", width: "100%", cursor: "pointer",
                }}
              />
            </div>

            <div className="status-bar">
              <div className={`dot ${dotState ? `dot-${dotState}` : ""}`} />
              <span>{statusTxt}</span>
            </div>

            <div className="field">
              <label className="field-label">Flight Name</label>
              <input
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Genesis — 3D Practice Session"
                required
              />
            </div>

            {error && <div className="error-msg">{error}</div>}

            <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
              {uploading ? <><span className="loading-txt">UPLOADING</span></> : "UPLOAD FLIGHT →"}
            </button>
          </form>
        </div>
      </div>

      {/* Flights list */}
      <div className="card" style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
        <div style={{ padding: "20px 28px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="section-label" style={{ marginBottom: 2 }}>Loaded Flights</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", letterSpacing: "2px" }}>
              {flights.length} LOG{flights.length !== 1 ? "S" : ""} ON RECORD
            </div>
          </div>
          {flights.length > 0 && (
            <span className="tag tag-green">READY</span>
          )}
        </div>

        {loading ? (
          <div className="empty-state"><span className="loading-txt">LOADING RECORDS…</span></div>
        ) : flights.length === 0 ? (
          <div className="empty-state">
            NO FLIGHTS YET<br />
            <span style={{ fontSize: 10, opacity: 0.5, marginTop: 6, display: "block" }}>UPLOAD A BLACKBOX CSV TO GET STARTED</span>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Flight Name</th>
                <th>Craft</th>
                <th>Firmware</th>
                <th>Duration</th>
                <th>Sample Rate</th>
                <th>Loops</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flights.map(f => (
                <tr key={f.id} onClick={() => nav("flight", { flightId: f.id })}>
                  <td>
                    <span style={{ color: "#fff", fontWeight: 600, letterSpacing: "0.5px" }}>{f.name}</span>
                    {f.notes && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{f.notes}</div>}
                  </td>
                  <td className="mono accent">{f.craft_name ?? <span className="dim">—</span>}</td>
                  <td><span className="tag">{f.firmware_version ?? "—"}</span></td>
                  <td className="mono">{f.duration_s ? `${f.duration_s.toFixed(1)}s` : <span className="dim">—</span>}</td>
                  <td className="mono">{f.sample_rate_hz ? `${f.sample_rate_hz} Hz` : <span className="dim">—</span>}</td>
                  <td className="mono dim">{f.total_loop_iterations?.toLocaleString() ?? "—"}</td>
                  <td style={{ textAlign: "right", paddingRight: 16 }}>
                    <button className="btn btn-danger btn-sm" onClick={e => handleDelete(e, f.id)}>DELETE</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
