import { useState } from "react"
import { LogLoader }    from "./pages/LogLoader"
import { FlightManager } from "./pages/FlightManager"
import { SegmentView }   from "./pages/SegmentView"

/**
 * State machine:
 *   "load"     → LogLoader    (load CSV in browser, define segments, save to DB)
 *   "flights"  → FlightManager (list saved flights + segments)
 *   "segment"  → SegmentView  (analysis dashboards for a saved segment)
 */
export default function App() {
  const [route, setRoute] = useState({ page: "load", params: {} })
  const nav = (page, params = {}) => setRoute({ page, params })

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <AppHeader nav={nav} activePage={route.page} />
        <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px" }}>
          {route.page === "load"    && <LogLoader     nav={nav} />}
          {route.page === "flights" && <FlightManager nav={nav} />}
          {route.page === "segment" && <SegmentView   nav={nav} {...route.params} />}
        </main>
      </div>
    </>
  )
}

function AppHeader({ nav, activePage }) {
  return (
    <header style={{
      background: "var(--surface)", borderBottom: "1px solid var(--border)",
      padding: "0 32px", height: 52,
      display: "flex", alignItems: "center", gap: 32,
      position: "sticky", top: 0, zIndex: 100,
    }}>
      <button onClick={() => nav("load")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "4px", color: "var(--accent)", opacity: 0.7 }}>ROTORFLIGHT</div>
        <div style={{ fontFamily: "var(--body)", fontSize: 15, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#fff", lineHeight: 1 }}>
          BLACKBOX <span style={{ color: "var(--accent)" }}>ANALYZER</span>
        </div>
      </button>

      <nav style={{ display: "flex", gap: 0, borderLeft: "1px solid var(--border)", paddingLeft: 24, marginLeft: 8 }}>
        {[["load", "Load Log"], ["flights", "Saved Flights"]].map(([page, label]) => (
          <button key={page} onClick={() => nav(page)} style={{
            background: "none", border: "none",
            borderBottom: activePage === page ? "2px solid var(--accent)" : "2px solid transparent",
            padding: "0 16px", height: 52, cursor: "pointer",
            fontFamily: "var(--body)", fontSize: 13, fontWeight: 600,
            letterSpacing: "1px", textTransform: "uppercase",
            color: activePage === page ? "var(--accent)" : "var(--muted)",
            transition: "color 0.15s",
          }}>{label}</button>
        ))}
      </nav>

      <div style={{ marginLeft: "auto" }}>
        <span className="tag tag-accent">ONLINE</span>
      </div>
    </header>
  )
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@300;400;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #0a0e14;
  --surface:  #111820;
  --surface2: #1a2535;
  --border:   #1e3a5f;
  --border2:  #2a4a70;
  --accent:   #00c8ff;
  --accent2:  #ff6b35;
  --green:    #39ff8a;
  --text:     #ccd6f6;
  --muted:    #4a6080;
  --dim:      #2a3a50;
  --danger:   #ff3860;
  --warning:  #ffaa00;
  --roll:     #00c8ff;
  --pitch:    #39ff8a;
  --yaw:      #ff6b35;
  --mono:     'Share Tech Mono', monospace;
  --body:     'Barlow Condensed', sans-serif;
  --card-w:   680px;
}

html, body, #root {
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--body);
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
body {
  background-image:
    radial-gradient(ellipse at 15% 0%, rgba(0,200,255,0.06) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 100%, rgba(255,107,53,0.04) 0%, transparent 55%);
}
::selection { background: var(--accent); color: #000; }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* Card */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
  width: 100%;
}
.card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--accent), var(--accent2));
}
.card-body { padding: 28px 32px; }

/* Step wizard */
.step { display: none; flex-direction: column; gap: 20px; animation: fadeIn 0.25s ease; }
.step.active { display: flex; }
@keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
.step-label { font-family: var(--mono); font-size: 10px; letter-spacing: 4px; color: var(--accent); text-transform: uppercase; opacity: 0.8; }
.step-title { font-size: 22px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #fff; margin-top: -8px; }

/* Fields */
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-family: var(--mono); font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: var(--muted); }
.field.full { grid-column: 1 / -1; }
.input {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 3px; color: var(--text);
  font-family: var(--mono); font-size: 14px;
  padding: 11px 14px; width: 100%; outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0,200,255,0.1); }
.input::placeholder { color: var(--dim); }
select.input { cursor: pointer; }
textarea.input { resize: vertical; line-height: 1.7; min-height: 180px; }

/* Buttons */
.btn {
  background: transparent; border: 1px solid var(--accent);
  color: var(--accent); font-family: var(--body);
  font-size: 14px; font-weight: 600; letter-spacing: 3px;
  text-transform: uppercase; padding: 12px 28px;
  cursor: pointer; border-radius: 3px; transition: all 0.2s;
  display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
}
.btn:hover:not(:disabled) { background: var(--accent); color: var(--bg); box-shadow: 0 0 20px rgba(0,200,255,0.3); }
.btn:disabled { opacity: 0.3; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--bg); }
.btn-primary:hover:not(:disabled) { background: #33d4ff; box-shadow: 0 0 24px rgba(0,200,255,0.5); }
.btn-green  { border-color: var(--green); color: var(--green); }
.btn-green:hover:not(:disabled) { background: var(--green); color: var(--bg); box-shadow: 0 0 20px rgba(57,255,138,0.3); }
.btn-muted  { border-color: var(--muted); color: var(--muted); }
.btn-muted:hover:not(:disabled) { background: var(--muted); color: var(--bg); }
.btn-danger { border-color: var(--danger); color: var(--danger); padding: 6px 14px; font-size: 11px; letter-spacing: 2px; }
.btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
.btn-sm { padding: 8px 18px; font-size: 12px; letter-spacing: 2px; }

/* Status bar */
.status-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: var(--surface2);
  border: 1px solid var(--border); border-radius: 3px;
  font-family: var(--mono); font-size: 12px; color: var(--muted);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); flex-shrink: 0; transition: all 0.3s; }
.dot-ok    { background: var(--green);   box-shadow: 0 0 6px var(--green); }
.dot-warn  { background: var(--warning); box-shadow: 0 0 6px var(--warning); }
.dot-err   { background: var(--danger);  box-shadow: 0 0 6px var(--danger); }
.dot-pulse { background: var(--accent);  animation: pulse-dot 1s infinite; }
@keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.75)} }

/* Info box */
.info-box {
  background: var(--surface2); border: 1px solid var(--border);
  border-left: 3px solid var(--accent); padding: 12px 16px;
  border-radius: 3px; font-family: var(--mono); font-size: 12px;
  line-height: 1.75; color: var(--muted);
}
.info-box strong, .info-box .hi { color: var(--accent); }
.info-box .hi2 { color: var(--accent2); }

/* Error */
.error-msg {
  color: var(--danger); font-family: var(--mono); font-size: 12px;
  padding: 10px 14px; background: rgba(255,56,96,0.07);
  border: 1px solid rgba(255,56,96,0.3); border-radius: 3px;
}

/* Summary grid */
.sum-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.sum-cell { background: var(--surface2); border: 1px solid var(--border); border-radius: 3px; padding: 16px; text-align: center; }
.sum-val { font-family: var(--mono); font-size: 22px; color: var(--accent); display: block; line-height: 1; }
.sum-lbl { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); margin-top: 6px; display: block; }

/* Progress */
.prog-bar { height: 3px; background: var(--surface2); border-radius: 2px; overflow: hidden; }
.prog-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); transition: width 0.15s; }

/* Table */
.data-table { width: 100%; border-collapse: collapse; }
.data-table th { text-align: left; padding: 10px 16px; font-family: var(--mono); font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); }
.data-table td { padding: 13px 16px; border-bottom: 1px solid var(--border); font-family: var(--body); font-size: 14px; }
.data-table tbody tr { cursor: pointer; transition: background 0.1s; }
.data-table tbody tr:hover { background: rgba(30,58,95,0.4); }
.data-table tbody tr:last-child td { border-bottom: none; }

/* Tags / badges */
.tag { display: inline-block; background: var(--surface2); border: 1px solid var(--border); border-radius: 2px; padding: 2px 8px; font-family: var(--mono); font-size: 10px; color: var(--muted); letter-spacing: 1px; }
.tag-accent { border-color: var(--accent); color: var(--accent); background: rgba(0,200,255,0.07); }
.tag-green  { border-color: var(--green);  color: var(--green);  background: rgba(57,255,138,0.07); }
.tag-orange { border-color: var(--accent2);color: var(--accent2);background: rgba(255,107,53,0.07); }
.tag-danger { border-color: var(--danger); color: var(--danger); background: rgba(255,56,96,0.07); }

/* Filename preview */
.filename-preview { font-family: var(--mono); font-size: 13px; color: var(--accent2); padding: 10px 14px; background: var(--surface2); border-radius: 3px; border: 1px dashed var(--border); }

/* Tab bar */
.tab-bar { display: flex; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
.tab-bar::-webkit-scrollbar { display: none; }
.tab-btn { background: none; border: none; border-bottom: 2px solid transparent; padding: 12px 20px; font-family: var(--body); font-size: 14px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); cursor: pointer; transition: color 0.15s, border-color 0.15s; white-space: nowrap; margin-bottom: -1px; }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-btn:hover:not(.active) { color: var(--text); }

/* Breadcrumb */
.breadcrumb { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 10px; letter-spacing: 2px; color: var(--muted); text-transform: uppercase; }
.breadcrumb-sep { color: var(--dim); }
.bc-link { background: none; border: none; color: var(--muted); cursor: pointer; font-family: var(--mono); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; padding: 0; transition: color 0.15s; }
.bc-link:hover { color: var(--accent); }

/* Misc */
.page { display: flex; flex-direction: column; gap: 18px; width: 100%; max-width: 900px; }
.wide-page { display: flex; flex-direction: column; gap: 18px; width: 100%; max-width: 1280px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
@media (max-width: 700px) { .grid-2,.grid-3 { grid-template-columns: 1fr; } }
.separator { border: none; border-top: 1px solid var(--border); }
.empty-state { padding: 48px 24px; text-align: center; color: var(--muted); font-family: var(--mono); font-size: 11px; letter-spacing: 2px; }
.loading-txt { font-family: var(--mono); font-size: 12px; letter-spacing: 2px; color: var(--muted); animation: blink 1.2s ease-in-out infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
.mono { font-family: var(--mono) !important; font-size: 13px !important; }
.accent  { color: var(--accent)  !important; }
.accent2 { color: var(--accent2) !important; }
.green   { color: var(--green)   !important; }
.dim     { color: var(--muted)   !important; }
.metric-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
.metric-row:last-child { border-bottom: none; }
.metric-key { font-size: 13px; color: var(--muted); }
.metric-val { font-family: var(--mono); font-size: 12px; color: var(--text); }
.prog-mini { height: 4px; background: var(--surface2); border-radius: 2px; overflow: hidden; margin-top: 5px; }
.prog-mini-fill { height: 100%; border-radius: 2px; transition: width 0.5s; }
.issue-card { border-radius: 3px; padding: 14px 16px; border-left: 3px solid; background: var(--surface2); margin-bottom: 10px; }
.issue-card.critical { border-left-color: var(--danger); }
.issue-card.warning  { border-left-color: var(--warning); }
.issue-card.info     { border-left-color: var(--accent); }
.profile-chip { background: var(--surface2); border: 1px solid var(--border); border-radius: 3px; padding: 12px 16px; }
.chart-area { background: var(--surface2); border: 1px solid var(--border); border-radius: 3px; padding: 16px; }
.axis-btn { padding: 6px 14px; border-radius: 2px; border: 1px solid var(--border); background: transparent; font-family: var(--mono); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; color: var(--muted); transition: all 0.15s; }
.section-label { font-family: var(--mono); font-size: 10px; letter-spacing: 4px; color: var(--accent); text-transform: uppercase; margin-bottom: 4px; opacity: 0.8; }
.section-title { font-size: 18px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #fff; margin-bottom: 16px; }
`
