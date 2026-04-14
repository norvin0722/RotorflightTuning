import { useState, useEffect, useRef } from "react"
import { api } from "../api"

const TABS    = ["Overview","FFT","Bode / Phase","PIDF Balance","AI Analysis"]
const AXES    = ["roll","pitch","yaw"]
const AXIS_COL = { roll:"var(--roll)", pitch:"var(--pitch)", yaw:"var(--yaw)" }
const AXIS_HEX = { roll:"#00c8ff",    pitch:"#39ff8a",      yaw:"#ff6b35" }
const WINDOWS  = ["hann","blackman","flattop","hamming","boxcar"]

export function SegmentView({ nav, flightId, segmentId }) {
  const [segment,   setSegment]   = useState(null)
  const [activeTab, setActiveTab] = useState("Overview")
  const [metrics,   setMetrics]   = useState([])
  const [fftData,   setFftData]   = useState(null)
  const [bodeData,  setBodeData]  = useState(null)
  const [aiResults, setAiResults] = useState([])
  const [running,   setRunning]   = useState(false)
  const [runDot,    setRunDot]    = useState("")
  const [runStatus, setRunStatus] = useState("No analysis run yet")
  const [fftCfg,    setFftCfg]    = useState({ nperseg:1024, overlap_pct:0.75, window:"hann", db_scale:true })

  useEffect(() => {
    api.segments.get(segmentId).then(setSegment)
    loadResults()
  }, [segmentId])

  async function loadResults() {
    const [m, fft, bode, ai] = await Promise.allSettled([
      api.analysis.results(segmentId),
      api.analysis.fftResults(segmentId),
      api.analysis.bodeResults(segmentId),
      api.ai.results(segmentId),
    ])
    if (m.status    === "fulfilled") setMetrics(m.value)
    if (fft.status  === "fulfilled") setFftData(fft.value)
    if (bode.status === "fulfilled") setBodeData(bode.value)
    if (ai.status   === "fulfilled") setAiResults(ai.value)
  }

  async function runAnalysis() {
    setRunning(true); setRunDot("pulse"); setRunStatus("Running analysis…")
    try {
      await api.analysis.run(segmentId, fftCfg)
      await new Promise(r => setTimeout(r, 3500))
      await loadResults()
      setRunDot("ok"); setRunStatus("Analysis complete")
    } catch (err) {
      setRunDot("err"); setRunStatus("Analysis failed: " + err.message)
    } finally { setRunning(false) }
  }

  const modMetrics = mod => metrics.filter(m => m.module === mod)

  if (!segment) return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <span className="loading-txt">LOADING SEGMENT…</span>
    </div>
  )

  return (
    <div className="page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <button className="bc-link" onClick={() => nav("flights")}>Flights</button>
        <span className="breadcrumb-sep">/</span>
        <button className="bc-link" onClick={() => nav("flight", { flightId })}>Flight</button>
        <span className="breadcrumb-sep">/</span>
        <span style={{ color: "var(--accent)" }}>{segment.label}</span>
      </div>

      {/* Segment header card */}
      <div className="card">
        <div className="card-inner" style={{ padding: "20px 28px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div>
              <div className="section-label">Segment Analysis</div>
              <h2 style={{ fontFamily: "var(--body)", fontSize: 24, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#fff", margin: "4px 0 8px" }}>
                {segment.label}
              </h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className="tag">{segment.maneuver_type?.replace(/_/g," ") ?? "general"}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", letterSpacing: "1px" }}>
                  {segment.start_iteration.toLocaleString()} → {segment.end_iteration.toLocaleString()}
                </span>
                <span className="tag tag-accent">{segment.duration_loops?.toLocaleString()} LOOPS</span>
                {segment.pid_profile_id && <span className="tag tag-green">PROFILE LINKED</span>}
              </div>
            </div>

            {/* Analysis controls */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 260 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select className="input" style={{ fontSize: 12, padding: "7px 10px", flex: 1, minWidth: 100 }}
                  value={fftCfg.window} onChange={e => setFftCfg(c => ({...c, window: e.target.value}))}>
                  {WINDOWS.map(w => <option key={w}>{w}</option>)}
                </select>
                <select className="input" style={{ fontSize: 12, padding: "7px 10px", flex: 1, minWidth: 90 }}
                  value={fftCfg.nperseg} onChange={e => setFftCfg(c => ({...c, nperseg: +e.target.value}))}>
                  {[256,512,1024,2048,4096].map(n => <option key={n} value={n}>{n} pts</option>)}
                </select>
                <select className="input" style={{ fontSize: 12, padding: "7px 10px", flex: 1, minWidth: 90 }}
                  value={fftCfg.overlap_pct} onChange={e => setFftCfg(c => ({...c, overlap_pct: +e.target.value}))}>
                  {[0.5,0.75,0.875].map(o => <option key={o} value={o}>{(o*100).toFixed(0)}% ovr</option>)}
                </select>
              </div>
              <button className="btn btn-primary btn-sm" onClick={runAnalysis} disabled={running}>
                {running ? <span className="loading-txt">RUNNING ANALYSIS…</span> : "▶  RUN ANALYSIS"}
              </button>
              <div className="status-bar" style={{ padding: "7px 12px" }}>
                <div className={`dot ${runDot ? `dot-${runDot}` : ""}`} />
                <span style={{ fontSize: 11 }}>{runStatus}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="tab-bar" style={{ borderTop: "1px solid var(--border)", borderBottom: "none", padding: "0 12px" }}>
          {TABS.map(t => (
            <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>
      </div>

      {/* Tab panels */}
      {activeTab === "Overview"     && <OverviewPanel     modMetrics={modMetrics} />}
      {activeTab === "FFT"          && <FFTPanel          fftData={fftData} />}
      {activeTab === "Bode / Phase" && <BodePanel         bodeData={bodeData} />}
      {activeTab === "PIDF Balance" && <PIDFPanel         metrics={modMetrics("pidf_balance")} />}
      {activeTab === "AI Analysis"  && <AIPanel           aiResults={aiResults} segmentId={segmentId} onRefresh={loadResults} />}
    </div>
  )
}

/* ── Overview ──────────────────────────────────────────────────────────────── */
function OverviewPanel({ modMetrics }) {
  const cards = [
    { key:"tracking_error",  title:"Tracking Error",       unit:"deg/s" },
    { key:"control_latency", title:"Control Latency",      unit:"ms" },
    { key:"oscillation",     title:"Oscillation",          unit:"" },
    { key:"governor",        title:"Headspeed / Governor", unit:"RPM" },
    { key:"step_response",   title:"Step Response",        unit:"ms" },
    { key:"servo",           title:"Servo Activity",       unit:"%" },
  ]
  return (
    <div className="grid-3" style={{ gap: 16 }}>
      {cards.map(c => <MetricCard key={c.key} {...c} metrics={modMetrics(c.key)} />)}
    </div>
  )
}

function MetricCard({ title, unit, metrics }) {
  const scalars = metrics.filter(m => m.value_float != null)
  return (
    <div className="card">
      <div className="card-inner" style={{ padding: "18px 20px" }}>
        <div className="section-label" style={{ marginBottom: 4, fontSize: 9 }}>{title}</div>
        {scalars.length === 0 ? (
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", letterSpacing: "2px", paddingTop: 8 }}>
            NO DATA — RUN ANALYSIS
          </div>
        ) : scalars.slice(0, 10).map(m => {
          const axisCol = m.metric_name.startsWith("roll_")  ? "var(--roll)"
                        : m.metric_name.startsWith("pitch_") ? "var(--pitch)"
                        : m.metric_name.startsWith("yaw_")   ? "var(--yaw)" : null
          const val = m.value_float
          const disp = typeof val === "number"
            ? val < 10 ? val.toFixed(3) : val.toFixed(1)
            : String(val)
          return (
            <div className="metric-row" key={m.metric_name}>
              <span className="metric-key">{m.metric_name.replace(/_/g," ")}</span>
              <span className="metric-val" style={axisCol ? { color: axisCol } : {}}>
                {disp}
                <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: 4 }}>
                  {m.unit || unit}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── FFT ───────────────────────────────────────────────────────────────────── */
function FFTPanel({ fftData }) {
  const canvasRef = useRef(null)
  const [axis, setAxis] = useState("roll")

  useEffect(() => {
    if (!fftData || !canvasRef.current) return
    drawFFT(canvasRef.current, fftData, axis)
  }, [fftData, axis])

  if (!fftData) return (
    <div className="card"><div className="card-inner">
      <div className="empty-state">
        NO FFT DATA<br />
        <span style={{ fontSize: 10, opacity: 0.5, marginTop: 6, display: "block" }}>CLICK RUN ANALYSIS ABOVE</span>
      </div>
    </div></div>
  )

  return (
    <div className="card">
      <div className="card-inner">
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <div className="section-label" style={{ marginBottom: 0 }}>FFT Vibration Analysis</div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            {AXES.map(a => (
              <button key={a} className="axis-btn"
                style={axis === a ? { borderColor: AXIS_HEX[a], color: AXIS_HEX[a], background: `${AXIS_HEX[a]}18` } : {}}
                onClick={() => setAxis(a)}>{a.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)", letterSpacing: "2px" }}>
            {fftData.window?.toUpperCase()} · {fftData.nperseg} PTS · {fftData.overlap_pct ? (fftData.overlap_pct*100).toFixed(0) : 0}% OVR
          </div>
        </div>

        <div className="chart-area">
          <canvas ref={canvasRef} width={1100} height={420} style={{ width: "100%", height: "auto", display: "block" }} />
        </div>

        <FFTLegend fftData={fftData} axis={axis} />
      </div>
    </div>
  )
}

function drawFFT(canvas, data, axis) {
  const ctx = canvas.getContext("2d")
  const W = canvas.width, H = canvas.height
  const P = { t:24, r:32, b:52, l:68 }
  const PW = W-P.l-P.r, PH = H-P.t-P.b
  ctx.clearRect(0, 0, W, H)

  const freqs   = data.freqs ?? []
  const rawPSD  = data[`${axis}_raw_psd`]
  const filtPSD = data[`${axis}_filt_psd`]
  const bands   = (data.filter_bands ?? []).filter(b => b.axis===axis || b.axis==="all")

  if (!rawPSD || freqs.length === 0) {
    ctx.fillStyle = "rgba(74,96,128,0.6)"; ctx.font = "13px 'Share Tech Mono',monospace"
    ctx.textAlign = "center"; ctx.fillText("No data for this axis", W/2, H/2); return
  }

  const maxF = Math.max(...freqs)
  const allV = [...(rawPSD??[]),...(filtPSD??[])].filter(isFinite)
  const minV = Math.min(...allV)-5, maxV = Math.max(...allV)+5
  const toX  = f => P.l + (f/maxF)*PW
  const toY  = v => P.t + PH - ((v-minV)/(maxV-minV))*PH

  // Shaded filter bands
  const bC = { blue:"rgba(0,200,255,0.07)", teal:"rgba(57,255,138,0.06)", amber:"rgba(255,107,53,0.07)", coral:"rgba(255,107,53,0.07)", purple:"rgba(150,100,255,0.07)", green:"rgba(57,255,138,0.06)" }
  bands.forEach(b => {
    const x1 = toX(Math.max(0, b.lo_hz)), x2 = toX(Math.min(maxF, b.hi_hz))
    ctx.fillStyle = bC[b.color_hint] ?? "rgba(255,255,255,0.03)"
    ctx.fillRect(x1, P.t, x2-x1, PH)
    ctx.strokeStyle = (bC[b.color_hint]??"rgba(255,255,255,0.03)").replace(/[\d.]+\)$/, "0.4)")
    ctx.lineWidth = 1; ctx.setLineDash([4,3])
    ctx.beginPath(); ctx.moveTo(x1, P.t); ctx.lineTo(x1, P.t+PH); ctx.stroke()
    ctx.setLineDash([])
  })

  // Grid
  ctx.font = "10px 'Share Tech Mono',monospace"; ctx.textAlign = "right"
  for (let db = Math.ceil(minV/10)*10; db <= maxV; db += 10) {
    const y = toY(db)
    ctx.strokeStyle = "rgba(30,58,95,0.8)"; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l+PW, y); ctx.stroke()
    ctx.fillStyle = "rgba(74,96,128,0.8)"; ctx.fillText(`${db}dB`, P.l-6, y+4)
  }
  ctx.textAlign = "center"
  for (let f = 0; f <= maxF; f += 50) {
    const x = toX(f)
    ctx.strokeStyle = "rgba(30,58,95,0.8)"; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t+PH); ctx.stroke()
    ctx.fillStyle = "rgba(74,96,128,0.8)"; ctx.fillText(`${f}`, x, P.t+PH+18)
  }
  ctx.fillStyle = "rgba(74,96,128,0.6)"
  ctx.fillText("Hz", P.l+PW/2, H-6)
  ctx.save(); ctx.translate(14, P.t+PH/2); ctx.rotate(-Math.PI/2)
  ctx.textAlign = "center"; ctx.fillText("dB", 0, 0); ctx.restore()

  // Raw trace (dashed, muted red)
  if (rawPSD) {
    ctx.strokeStyle = "rgba(255,56,96,0.5)"; ctx.lineWidth = 1.2; ctx.setLineDash([3,2])
    ctx.beginPath()
    rawPSD.forEach((v,i) => { const x=toX(freqs[i]),y=toY(v); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y) })
    ctx.stroke(); ctx.setLineDash([])
  }

  // Filtered trace (solid axis color with glow)
  if (filtPSD) {
    ctx.shadowColor = AXIS_HEX[axis]; ctx.shadowBlur = 4
    ctx.strokeStyle = AXIS_HEX[axis]; ctx.lineWidth = 1.5
    ctx.beginPath()
    filtPSD.forEach((v,i) => { const x=toX(freqs[i]),y=toY(v); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y) })
    ctx.stroke(); ctx.shadowBlur = 0
  }
}

function FFTLegend({ fftData, axis }) {
  const bands = (fftData.filter_bands ?? []).filter(b => b.axis===axis||b.axis==="all").slice(0,4)
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", letterSpacing: "1px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 20, borderTop: "2px dashed rgba(255,56,96,0.6)", display: "inline-block" }} />
        RAW GYRO
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 20, borderTop: `2px solid ${AXIS_HEX[axis]}`, display: "inline-block", boxShadow: `0 0 6px ${AXIS_HEX[axis]}` }} />
        FILTERED GYRO
      </span>
      {bands.map(b => (
        <span key={b.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, background: "rgba(255,107,53,0.2)", border: "1px solid var(--accent2)", borderRadius: 1, display: "inline-block" }} />
          {b.label.toUpperCase()}
        </span>
      ))}
    </div>
  )
}

/* ── Bode ──────────────────────────────────────────────────────────────────── */
function BodePanel({ bodeData }) {
  const [axis, setAxis] = useState("roll")
  const magRef   = useRef(null)
  const phaseRef = useRef(null)

  useEffect(() => {
    if (!bodeData || !magRef.current) return
    drawBode(magRef.current,   bodeData, axis, "magnitude")
    drawBode(phaseRef.current, bodeData, axis, "phase")
  }, [bodeData, axis])

  if (!bodeData) return (
    <div className="card"><div className="card-inner">
      <div className="empty-state">NO BODE DATA<br /><span style={{ fontSize: 10, opacity: 0.5, marginTop: 6, display: "block" }}>CLICK RUN ANALYSIS ABOVE</span></div>
    </div></div>
  )

  const pm  = bodeData[`${axis}_bode_phase_margin_deg`]
  const gm  = bodeData[`${axis}_bode_gain_margin_db`]
  const gcf = bodeData[`${axis}_bode_gain_crossover_hz`]
  const sta = bodeData[`${axis}_bode_stability`]

  return (
    <div className="card">
      <div className="card-inner">
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Bode Plot / Phase Margin</div>
          <div style={{ display: "flex", gap: 8 }}>
            {AXES.map(a => (
              <button key={a} className="axis-btn"
                style={axis===a ? { borderColor:AXIS_HEX[a], color:AXIS_HEX[a], background:`${AXIS_HEX[a]}18` } : {}}
                onClick={() => setAxis(a)}>{a.toUpperCase()}</button>
            ))}
          </div>
          {pm != null && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontFamily: "var(--mono)", fontSize: 11 }}>
              <span style={{ color: sta==="stable" ? "var(--green)" : sta==="unstable" ? "var(--danger)" : "var(--warning)" }}>
                ● {sta?.toUpperCase()}
              </span>
              <span>PM: <span style={{ color: AXIS_HEX[axis] }}>{pm.toFixed(1)}°</span></span>
              {gm  != null && <span>GM: <span style={{ color: AXIS_HEX[axis] }}>{gm.toFixed(1)} dB</span></span>}
              {gcf != null && <span>GCF: <span style={{ color: AXIS_HEX[axis] }}>{gcf.toFixed(1)} Hz</span></span>}
            </div>
          )}
        </div>

        <div className="chart-area" style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)", letterSpacing: "2px", marginBottom: 6 }}>MAGNITUDE (dB)</div>
          <canvas ref={magRef}   width={1100} height={240} style={{ width:"100%", height:"auto", display:"block" }} />
        </div>
        <div className="chart-area">
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)", letterSpacing: "2px", marginBottom: 6 }}>PHASE (°) — SHADED = LOW COHERENCE</div>
          <canvas ref={phaseRef} width={1100} height={200} style={{ width:"100%", height:"auto", display:"block" }} />
        </div>
      </div>
    </div>
  )
}

function drawBode(canvas, data, axis, type) {
  const prefix = `${axis}_bode`
  const freqs  = data[`${prefix}_freqs`]
  const series = type === "magnitude" ? data[`${prefix}_magnitude_db`] : data[`${prefix}_phase_unwrapped`]
  const coh    = data[`${prefix}_coherence`]
  if (!freqs || !series) return

  const ctx = canvas.getContext("2d")
  const W = canvas.width, H = canvas.height
  const P = { t:10, r:32, b:30, l:68 }
  const PW = W-P.l-P.r, PH = H-P.t-P.b
  ctx.clearRect(0,0,W,H)

  const vals = series.filter(isFinite)
  if (!vals.length) return
  const minV = Math.min(...vals)-5, maxV = Math.max(...vals)+5
  const maxF = Math.max(...freqs)
  const toX  = f => P.l + (f/maxF)*PW
  const toY  = v => P.t + PH - ((v-minV)/(maxV-minV))*PH

  // Low-coherence shading
  if (coh) {
    for (let i=1; i<freqs.length; i++) {
      if ((coh[i]??1) < 0.6) {
        ctx.fillStyle = "rgba(30,58,95,0.5)"
        ctx.fillRect(toX(freqs[i-1]), P.t, toX(freqs[i])-toX(freqs[i-1]), PH)
      }
    }
  }

  // 0 reference
  if (minV < 0 && maxV > 0) {
    const y0 = toY(0)
    ctx.strokeStyle = "rgba(0,200,255,0.15)"; ctx.lineWidth = 1; ctx.setLineDash([4,3])
    ctx.beginPath(); ctx.moveTo(P.l,y0); ctx.lineTo(P.l+PW,y0); ctx.stroke(); ctx.setLineDash([])
  }

  const ticks = type==="magnitude" ? [-40,-20,-10,0,10,20] : [-360,-270,-180,-90,0]
  ctx.font = "10px 'Share Tech Mono',monospace"; ctx.textAlign = "right"
  ticks.forEach(t => {
    const y = toY(t)
    if (y<P.t||y>P.t+PH) return
    ctx.strokeStyle = "rgba(30,58,95,0.8)"; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(P.l,y); ctx.lineTo(P.l+PW,y); ctx.stroke()
    ctx.fillStyle = "rgba(74,96,128,0.8)"; ctx.fillText(`${t}`, P.l-6, y+4)
  })

  ctx.shadowColor = AXIS_HEX[axis]; ctx.shadowBlur = 4
  ctx.strokeStyle = AXIS_HEX[axis]; ctx.lineWidth = 1.5
  ctx.beginPath()
  series.forEach((v,i) => { const x=toX(freqs[i]),y=toY(v); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y) })
  ctx.stroke(); ctx.shadowBlur = 0
}

/* ── PIDF Balance ──────────────────────────────────────────────────────────── */
function PIDFPanel({ metrics }) {
  if (!metrics.length) return (
    <div className="card"><div className="card-inner">
      <div className="empty-state">NO PIDF DATA<br /><span style={{ fontSize: 10, opacity: 0.5, marginTop: 6, display: "block" }}>CLICK RUN ANALYSIS ABOVE</span></div>
    </div></div>
  )
  return (
    <div className="grid-3" style={{ gap: 16 }}>
      {AXES.map(axis => {
        const rows = ["P","I","D","F","B","O"].map(t => ({
          term: t,
          rms: metrics.find(m => m.metric_name === `${axis}_${t}_rms`)?.value_float ?? 0,
          pct: metrics.find(m => m.metric_name === `${axis}_${t}_contribution`)?.value_float ?? 0,
        })).filter(r => r.rms > 0)
        const dp = metrics.find(m => m.metric_name === `${axis}_D_P_ratio`)?.value_float
        const iw = metrics.find(m => m.metric_name === `${axis}_i_windup_flag`)?.value_float
        const col = AXIS_HEX[axis]
        return (
          <div className="card" key={axis}>
            <div className="card-inner" style={{ padding: "18px 20px" }}>
              <div className="section-label" style={{ marginBottom: 4, color: col }}>{axis.toUpperCase()} AXIS</div>
              {rows.length === 0
                ? <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", letterSpacing: "2px" }}>NO DATA</div>
                : rows.map(r => (
                  <div key={r.term} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: "var(--muted)", letterSpacing: "2px" }}>{r.term}-TERM</span>
                      <span style={{ color: "var(--text)" }}>
                        {(r.pct*100).toFixed(1)}%
                        <span style={{ color: "var(--muted)", marginLeft: 8 }}>{r.rms.toFixed(1)} au</span>
                      </span>
                    </div>
                    <div className="prog-mini">
                      <div className="prog-mini-fill" style={{ width: `${Math.min(r.pct*100,100)}%`, background: col, boxShadow: `0 0 6px ${col}60` }} />
                    </div>
                  </div>
                ))
              }
              {(dp != null || iw === 1) && (
                <>
                  <hr className="separator" style={{ margin: "10px 0" }} />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {dp != null && (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: dp > 0.7 ? "var(--warning)" : "var(--muted)" }}>
                        D/P: {dp.toFixed(2)} {dp > 0.7 && "⚠ D-HEAVY"}
                      </span>
                    )}
                    {iw === 1 && <span className="tag tag-orange">I WIND-UP</span>}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── AI Analysis ───────────────────────────────────────────────────────────── */
function AIPanel({ aiResults, segmentId, onRefresh }) {
  const [model,    setModel]    = useState("claude-sonnet-4-20250514")
  const [template, setTemplate] = useState("default")
  const [loading,  setLoading]  = useState(false)
  const [dot,      setDot]      = useState("")
  const [status,   setStatus]   = useState("No AI analysis requested yet")
  const latest = aiResults[0]

  async function handleRequest() {
    setLoading(true); setDot("pulse"); setStatus("Requesting AI analysis…")
    try {
      await api.ai.analyze(segmentId, model, template)
      await new Promise(r => setTimeout(r, 4500))
      await onRefresh()
      setDot("ok"); setStatus("Analysis complete")
    } catch (err) {
      setDot("err"); setStatus("Request failed: " + err.message)
    } finally { setLoading(false) }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Request card */}
      <div className="card">
        <div className="card-inner">
          <div className="section-label">AI-Assisted Analysis</div>
          <div className="section-title" style={{ fontSize: 16, marginBottom: 16 }}>Request Analysis</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <select className="input" style={{ width: "auto", minWidth: 220 }}
              value={model} onChange={e => setModel(e.target.value)}>
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4.6</option>
              <option value="claude-opus-4-6">Claude Opus 4.6</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            </select>
            <select className="input" style={{ width: "auto", minWidth: 180 }}
              value={template} onChange={e => setTemplate(e.target.value)}>
              <option value="default">General analysis</option>
              <option value="oscillation">Oscillation focus</option>
              <option value="governor">Governor focus</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={handleRequest} disabled={loading}>
              {loading ? <span className="loading-txt">ANALYZING…</span> : "REQUEST ANALYSIS →"}
            </button>
          </div>

          <div className="status-bar">
            <div className={`dot ${dot ? `dot-${dot}` : ""}`} />
            <span>{status}</span>
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", marginTop: 10, lineHeight: 1.7 }}>
            Run the analysis engine first for best results. The AI uses computed metrics as context
            to provide specific tuning recommendations.
          </div>
        </div>
      </div>

      {/* Results */}
      {latest && (
        <div className="card">
          <div className="card-inner">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="section-label" style={{ marginBottom: 2 }}>Analysis Result</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", letterSpacing: "1px" }}>
                  {new Date(latest.requested_at).toLocaleString()} · {latest.model_used?.split("-").slice(1,4).join(" ")}
                </div>
              </div>
              <span className={`tag ${
                latest.status === "complete" ? "tag-green"
                : latest.status === "error"  ? "tag-danger"
                : "tag-accent"
              }`}>{latest.status.toUpperCase()}</span>
            </div>

            {latest.structured_output?.overall_quality && (
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", letterSpacing: "2px", marginRight: 10 }}>OVERALL QUALITY</span>
                <span className={`tag ${
                  latest.structured_output.overall_quality === "excellent" ? "tag-green"
                  : latest.structured_output.overall_quality === "good"    ? "tag-accent"
                  : latest.structured_output.overall_quality === "poor"    ? "tag-danger"
                  : "tag-orange"
                }`}>{latest.structured_output.overall_quality.toUpperCase()}</span>
              </div>
            )}

            {latest.narrative && (
              <div className="info-box" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent2)", fontSize: 14, lineHeight: 1.75, color: "var(--text)" }}>
                {latest.narrative}
              </div>
            )}

            {latest.structured_output?.issues?.length > 0 && (
              <>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)", letterSpacing: "3px", marginBottom: 10 }}>
                  ISSUES DETECTED — {latest.structured_output.issues.length}
                </div>
                {latest.structured_output.issues.map((issue, i) => (
                  <div key={i} className={`issue-card ${issue.severity}`}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span className={`tag ${issue.severity==="critical" ? "tag-danger" : issue.severity==="warning" ? "tag-orange" : "tag-accent"}`}>
                        {issue.severity.toUpperCase()}
                      </span>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", letterSpacing: "1px" }}>
                        {issue.axis?.toUpperCase()} / {issue.category?.toUpperCase()}
                      </span>
                    </div>
                    <p style={{ fontSize: 14, marginBottom: issue.recommendation ? 8 : 0 }}>{issue.description}</p>
                    {issue.recommendation && (
                      <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--accent)" }}>
                        → {issue.recommendation}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
