import { useState } from "react";
import LogLoader from "./pages/LogLoader.jsx";
import FlightManager from "./pages/FlightManager.jsx";
import SegmentView from "./pages/SegmentView.jsx";

const NAV = [
  { id: "load",    label: "📂 Load Log"    },
  { id: "flights", label: "🗂 Flights"     },
];

export default function App() {
  const [page, setPage]         = useState("flights");
  const [segmentId, setSegmentId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function openSegment(id) {
    setSegmentId(id);
    setPage("segment");
  }

  function backFromSegment() {
    setSegmentId(null);
    setPage("flights");
  }

  function afterSave() {
    setRefreshKey(k => k + 1);
    setPage("flights");
  }

  return (
    <>
      <style>{`
        .app-header {
          background: linear-gradient(135deg, #0a0e14 0%, #0d1a2e 100%);
          border-bottom: 1px solid #1e3a5f;
          height: 56px;
          display: flex;
          align-items: center;
          padding: 0 24px;
          gap: 20px;
          position: sticky;
          top: 0;
          z-index: 200;
        }
        .app-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
        }
        .app-logo-hex {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #00c8ff, #7c3aed);
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 800;
          color: #fff;
          flex-shrink: 0;
        }
        .app-logo-text { font-size: 16px; font-weight: 800; color: #e2e8f0; letter-spacing: -0.3px; }
        .app-logo-sub  { font-size: 9px; color: #475569; font-family: 'JetBrains Mono', monospace; letter-spacing: 2px; text-transform: uppercase; }
        .app-spacer { flex: 1; }
        .app-nav { display: flex; gap: 4px; }
        .app-nav-btn {
          background: none;
          border: 1px solid transparent;
          color: #475569;
          padding: 5px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 13px;
          font-weight: 600;
          transition: all .15s;
          white-space: nowrap;
        }
        .app-nav-btn:hover  { color: #94a3b8; background: rgba(255,255,255,.04); }
        .app-nav-btn.active { color: #00c8ff; border-color: rgba(0,200,255,.25); background: rgba(0,200,255,.07); }
        .app-version {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          color: #00c8ff;
          border: 1px solid rgba(0,200,255,.3);
          padding: 2px 7px;
          border-radius: 3px;
          opacity: 0.7;
          letter-spacing: 1px;
        }
        .app-page { min-height: calc(100vh - 56px); }
      `}</style>

      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-hex">RF</div>
          <div>
            <div className="app-logo-text">Rotorflight Tuning</div>
            <div className="app-logo-sub">Blackbox Analysis Platform</div>
          </div>
        </div>
        <div className="app-spacer" />
        {page !== "segment" && (
          <nav className="app-nav">
            {NAV.map(n => (
              <button
                key={n.id}
                className={`app-nav-btn ${page === n.id ? "active" : ""}`}
                onClick={() => setPage(n.id)}
              >
                {n.label}
              </button>
            ))}
          </nav>
        )}
        <div className="app-version">v1.0</div>
      </header>

      <div className="app-page">
        {page === "load"    && <LogLoader onSaved={afterSave} />}
        {page === "flights" && <FlightManager key={refreshKey} onOpenSegment={openSegment} />}
        {page === "segment" && segmentId && (
          <SegmentView segmentId={segmentId} onBack={backFromSegment} />
        )}
      </div>
    </>
  );
}
