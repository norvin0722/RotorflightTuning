import { useState, useEffect } from "react"
import { api } from "../api"

export function FlightList({ nav }) {
  const [flights,     setFlights]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [uploading,   setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [name,        setName]        = useState("")
  const [file,        setFile]        = useState(null)

  useEffect(() => {
    api.flights.list().then(setFlights).finally(() => setLoading(false))
  }, [])

  async function handleUpload(e) {
    e.preventDefault()
    if (!file || !name.trim()) return
    setUploading(true)
    setUploadError(null)
    try {
      const flight = await api.flights.upload(file, name.trim())
      setFlights(prev => [flight, ...prev])
      setName("")
      setFile(null)
      e.target.reset()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this flight and all its segments?")) return
    await api.flights.delete(id)
    setFlights(prev => prev.filter(f => f.id !== id))
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Upload card */}
      <Card title="Upload Blackbox Log">
        <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Label text="Flight name">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Genesis — 3D practice session"
              required
              style={inputStyle}
            />
          </Label>
          <Label text="Blackbox CSV file">
            <input
              type="file"
              accept=".csv"
              onChange={e => setFile(e.target.files[0])}
              required
              style={{ ...inputStyle, padding: "6px 10px" }}
            />
          </Label>
          {uploadError && (
            <p style={{ color: "var(--color-text-danger)", fontSize: 13 }}>{uploadError}</p>
          )}
          <button type="submit" disabled={uploading} style={primaryBtn}>
            {uploading ? "Uploading…" : "Upload flight"}
          </button>
        </form>
      </Card>

      {/* Flights table */}
      <Card title="Flights">
        {loading ? (
          <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>Loading…</p>
        ) : flights.length === 0 ? (
          <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
            No flights yet. Upload a blackbox CSV to get started.
          </p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                {["Name", "Craft", "Firmware", "Duration", "Sample rate", ""].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flights.map(f => (
                <tr
                  key={f.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => nav("flight", { flightId: f.id })}
                >
                  <td style={tdStyle}>{f.name}</td>
                  <td style={tdStyle}>{f.craft_name ?? "—"}</td>
                  <td style={tdStyle}>{f.firmware_version ?? "—"}</td>
                  <td style={tdStyle}>{f.duration_s ? `${f.duration_s.toFixed(1)}s` : "—"}</td>
                  <td style={tdStyle}>{f.sample_rate_hz ? `${f.sample_rate_hz} Hz` : "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(f.id) }}
                      style={ghostBtn}
                    >
                      Delete
                    </button>
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

// ── Shared UI primitives ───────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "1px solid var(--color-border-tertiary)",
      borderRadius: 12,
      padding: 24,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 16px" }}>{title}</h2>
      {children}
    </div>
  )
}

function Label({ text, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{text}</span>
      {children}
    </label>
  )
}

const inputStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-secondary)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  outline: "none",
}

const primaryBtn = {
  padding: "9px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--color-text-primary)",
  color: "var(--color-background-primary)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  alignSelf: "flex-start",
}

const ghostBtn = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid var(--color-border-secondary)",
  background: "transparent",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  cursor: "pointer",
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
}

const thStyle = {
  textAlign: "left",
  padding: "8px 12px",
  color: "var(--color-text-secondary)",
  fontWeight: 500,
  fontSize: 12,
  borderBottom: "1px solid var(--color-border-tertiary)",
}

const tdStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--color-border-tertiary)",
  color: "var(--color-text-primary)",
}
