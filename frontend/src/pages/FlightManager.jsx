import { useState, useEffect } from "react";
import { listFlights, listSegments, deleteFlight, deleteSegment, exportSegmentCSV } from "../api.js";

const CSS = `
.fm-root { padding: 28px 24px; max-width: 1100px; margin: 0 auto; }
.fm-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.fm-title  { font-size: 20px; font-weight: 800; }
.fm-count  { font-family: 'JetBrains Mono',monospace; font-size: 10px; color: #475569; border: 1px solid #1e3a5f; padding: 2px 8px; border-radius: 3px; }
.fm-empty  { text-align: center; padding: 60px 20px; color: #475569; }
.fm-empty-icon  { font-size: 42px; opacity: .3; margin-bottom: 12px; }
.fm-empty-title { font-size: 16px; font-weight: 700; color: #94a3b8; margin-bottom: 6px; }
.fm-empty-sub   { font-size: 12px; line-height: 1.6; }
.fm-flight { background: #111820; border: 1px solid #1e3a5f; border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
.fm-flight-header {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; cursor: pointer;
  transition: background .15s;
}
.fm-flight-header:hover { background: rgba(0,200,255,.04); }
.fm-flight-hex {
  width: 36px; height: 36px;
  background: linear-gradient(135deg,#00c8ff22,#7c3aed22);
  border: 1px solid #1e3a5f;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
}
.fm-flight-name  { font-size: 14px; font-weight: 700; }
.fm-flight-meta  { font-size: 11px; color: #475569; font-family: 'JetBrains Mono',monospace; margin-top: 2px; }
.fm-flight-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.fm-chip {
  font-family: 'JetBrains Mono',monospace; font-size: 10px;
  padding: 2px 8px; border-radius: 4px;
  background: #0f1219; border: 1px solid #1e3a5f; color: #94a3b8;
}
.fm-chip.hs { background: rgba(0,200,255,.07); border-color: rgba(0,200,255,.2); color: #00c8ff; }
.fm-chip.fw { background: rgba(124,58,237,.07); border-color: rgba(124,58,237,.2); color: #a78bfa; }
.fm-expand-icon { font-size: 12px; color: #475569; margin-left: 4px; transition: transform .2s; }
.fm-expand-icon.open { transform: rotate(90deg); }
.fm-delete-btn {
  background: none; border: none; color: #475569; cursor: pointer;
  font-size: 16px; padding: 2px 4px; border-radius: 4px; transition: all .15s;
}
.fm-delete-btn:hover { color: #ef4444; background: rgba(239,68,68,.1); }

.fm-segments { border-top: 1px solid #1e3a5f; background: #0a0e14; }
.fm-seg-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px 10px 52px;
  border-bottom: 1px solid #111820;
  cursor: pointer; transition: background .15s;
}
.fm-seg-row:last-child { border-bottom: none; }
.fm-seg-row:hover { background: rgba(0,200,255,.04); }
.fm-seg-dot { width: 8px; height: 8px; border-radius: 2px; background: #1e3a5f; flex-shrink: 0; }
.fm-seg-dot.complete { background: #39ff8a; box-shadow: 0 0 6px rgba(57,255,138,.4); }
.fm-seg-dot.running  { background: #00c8ff; animation: pulse 1s infinite; }
.fm-seg-dot.error    { background: #ef4444; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.fm-seg-label { font-size: 13px; font-weight: 700; }
.fm-seg-meta  { font-size: 10px; color: #475569; font-family: 'JetBrains Mono',monospace; margin-top: 1px; }
.fm-seg-status {
  font-family: 'JetBrains Mono',monospace; font-size: 9px; letter-spacing: 1px;
  padding: 2px 7px; border-radius: 3px; text-transform: uppercase; flex-shrink: 0;
}
.fm-seg-status.complete { background: rgba(57,255,138,.1); color: #39ff8a; border: 1px solid rgba(57,255,138,.25); }
.fm-seg-status.pending  { background: #0f1219; color: #475569; border: 1px solid #1e3a5f; }
.fm-seg-status.running  { background: rgba(0,200,255,.1); color: #00c8ff; border: 1px solid rgba(0,200,255,.25); }
.fm-seg-status.error    { background: rgba(239,68,68,.1); color: #ef4444; border: 1px solid rgba(239,68,68,.25); }
.fm-seg-analyze {
  margin-left: auto; font-size: 11px; font-weight: 700;
  font-family: 'Barlow Condensed',sans-serif;
  padding: 4px 12px; border-radius: 5px; border: none; cursor: pointer;
  background: rgba(0,200,255,.08); color: #00c8ff; border: 1px solid rgba(0,200,255,.2);
  transition: all .15s;
}
.fm-seg-analyze:hover { background: rgba(0,200,255,.16); box-shadow: 0 0 10px rgba(0,200,255,.2); }
.fm-seg-export {
  font-size: 11px; font-weight: 700;
  font-family: 'Barlow Condensed',sans-serif;
  padding: 4px 12px; border-radius: 5px; cursor: pointer;
  background: rgba(57,255,138,.06); color: #39ff8a; border: 1px solid rgba(57,255,138,.2);
  transition: all .15s;
}
.fm-seg-export:hover { background: rgba(57,255,138,.14); box-shadow: 0 0 10px rgba(57,255,138,.2); }
.fm-no-segs { padding: 14px 18px 14px 52px; font-size: 11px; color: #475569; font-family: 'JetBrains Mono',monospace; }
.fm-loading { text-align: center; padding: 60px; color: #475569; font-family: 'JetBrains Mono',monospace; font-size: 12px; }
`;

export default function FlightManager({ onOpenSegment }) {
  const [flights,  setFlights]  = useState([]);
  const [segments, setSegments] = useState({}); // { flightId: [...] }
  const [expanded, setExpanded] = useState({}); // { flightId: bool }
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    listFlights().then(data => { setFlights(data || []); setLoading(false); });
  }, []);

  async function toggleFlight(flightId) {
    const isOpen = expanded[flightId];
    setExpanded(e => ({ ...e, [flightId]: !isOpen }));
    if (!isOpen && !segments[flightId]) {
      const segs = await listSegments(flightId).catch(() => []);
      setSegments(s => ({ ...s, [flightId]: segs }));
    }
  }

  async function handleDeleteFlight(e, flightId) {
    e.stopPropagation();
    if (!confirm("Delete this flight and all its segments?")) return;
    await deleteFlight(flightId);
    setFlights(f => f.filter(x => x.id !== flightId));
  }

  async function handleDeleteSegment(e, segId, flightId) {
    e.stopPropagation();
    if (!confirm("Delete this segment?")) return;
    await deleteSegment(segId);
    setSegments(s => ({ ...s, [flightId]: (s[flightId] || []).filter(x => x.id !== segId) }));
  }

  if (loading) return <div className="fm-loading">⟳ Loading flights…</div>;

  return (
    <>
      <style>{CSS}</style>
      <div className="fm-root">
        <div className="fm-header">
          <div className="fm-title">Saved Flights</div>
          <div className="fm-count">{flights.length} flight{flights.length !== 1 ? "s" : ""}</div>
        </div>

        {flights.length === 0 && (
          <div className="fm-empty">
            <div className="fm-empty-icon">🚁</div>
            <div className="fm-empty-title">No flights saved yet</div>
            <div className="fm-empty-sub">Go to "Load Log" to import a blackbox CSV<br />and define your first segment.</div>
          </div>
        )}

        {flights.map(flight => {
          const segs = segments[flight.id] || [];
          const isOpen = expanded[flight.id];
          return (
            <div key={flight.id} className="fm-flight">
              <div className="fm-flight-header" onClick={() => toggleFlight(flight.id)}>
                <div className="fm-flight-hex">🚁</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="fm-flight-name">{flight.name}</div>
                  <div className="fm-flight-meta">
                    {flight.craft_name && <>{flight.craft_name} &nbsp;·&nbsp;</>}
                    {flight.created_at && new Date(flight.created_at).toLocaleDateString()}
                    {flight.duration_s && <> &nbsp;·&nbsp; {flight.duration_s.toFixed(1)}s</>}
                    {flight.sample_rate_hz && <> &nbsp;·&nbsp; {Math.round(flight.sample_rate_hz)} Hz</>}
                  </div>
                </div>
                <div className="fm-flight-right">
                  {flight.firmware_version && <span className="fm-chip fw">{flight.firmware_version}</span>}
                  {flight.total_loop_iterations && (
                    <span className="fm-chip">{(flight.total_loop_iterations/1000).toFixed(0)}K loops</span>
                  )}
                  <button className="fm-delete-btn" onClick={e => handleDeleteFlight(e, flight.id)} title="Delete flight">✕</button>
                  <span className={`fm-expand-icon ${isOpen ? "open" : ""}`}>▶</span>
                </div>
              </div>

              {isOpen && (
                <div className="fm-segments">
                  {segs.length === 0 ? (
                    <div className="fm-no-segs">No segments saved for this flight.</div>
                  ) : segs.map(seg => (
                    <div key={seg.id} className="fm-seg-row" onClick={() => onOpenSegment(seg.id)}>
                      <div className={`fm-seg-dot ${seg.analysis_status || "pending"}`} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="fm-seg-label">{seg.label}</div>
                        <div className="fm-seg-meta">
                          {seg.row_count?.toLocaleString()} rows
                          {seg.duration_loops && <> &nbsp;·&nbsp; {seg.duration_loops.toLocaleString()} loops</>}
                          {seg.notes && <> &nbsp;·&nbsp; {seg.notes}</>}
                        </div>
                      </div>
                      <span className={`fm-seg-status ${seg.analysis_status || "pending"}`}>
                        {seg.analysis_status || "pending"}
                      </span>
                      <button className="fm-seg-export"
                        onClick={e => { e.stopPropagation(); exportSegmentCSV(seg.id, seg.label); }}
                        title="Download segment as CSV">
                        ↓ CSV
                      </button>
                      <button className="fm-seg-analyze"
                        onClick={e => { e.stopPropagation(); onOpenSegment(seg.id); }}>
                        View →
                      </button>
                      <button className="fm-delete-btn"
                        onClick={e => handleDeleteSegment(e, seg.id, flight.id)}
                        title="Delete segment">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
