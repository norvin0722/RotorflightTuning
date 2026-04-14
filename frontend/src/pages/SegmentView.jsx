import { useState, useEffect, useRef } from "react"
import { api } from "../api"

const TABS = ["Overview", "FFT", "Bode / Phase", "PIDF Balance", "AI Analysis"]
const AXES = ["roll", "pitch", "yaw"]
const AXIS_COLORS = { roll: "#185FA5", pitch: "#0F6E56", yaw: "#BA7517" }
const WINDOWS = ["hann", "blackman", "flattop", "hamming", "boxcar"]

export function SegmentView({ nav, flightId, segmentId }) {
  const [segment,    setSegment]    = useState(null)
  const [activeTab,  setActiveTab]  = useState("Overview")
  const [metrics,    setMetrics]    = useState([])
  const [fftData,    setFftData]    = useState(null)
  const [bodeData,   setBodeData]   = useState(null)
  const [aiResults,  setAiResults]  = useState([])
  const [running,    setRunning]    = useState(false)
  const [fftCfg,     setFftCfg]     = useState({ nperseg:1024, overlap_pct:0.75, window:"hann", db_scale:true })

  useEffect(() => {
    api.segments.get(segmentId).then(setSegment)
    loadResults()
  }, [segmentId])

  async function loadResults() {
    try {
      const [m, fft, bode, ai] = await Promise.allSettled([
        api.analysis.results(segmentId),
        api.analysis.fftResults(segmentId),
        api.analysis.bodeResults(segmentId),
        api.ai.results(segmentId),
      ])
      if (m.status     === "fulfilled") setMetrics(m.value)
      if (fft.status   === "fulfilled") setFftData(fft.value)
      if (bode.status  === "fulfilled") setBodeData(bode.value)
      if (ai.status    === "fulfilled") setAiResults(ai.value)
    } catch {}
  }

  async function runAnalysis() {
    setRunning(true)
    await api.analysis.run(segmentId, fftCfg)
    // Poll until results appear (simple approach: wait 3s then reload)
    await new Promise(r => setTimeout(r, 3000))
    await loadResults()
    setRunning(false)
  }

  const moduleMetrics = (module) =>
    metrics.filter(m => m.module === module)

  if (!segment) return <p style={{ color:"var(--color-text-secondary)" }}>Loading…</p>

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      {/* Breadcrumb */}
      <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"var(--color-text-secondary)" }}>
        <button onClick={() => nav("flights")} style={linkBtn}>Flights</button>
        <span>/</span>
        <button onClick={() => nav("flight", { flightId })} style={linkBtn}>Flight</button>
        <span>/</span>
        <span style={{ color:"var(--color-text-primary)" }}>{segment.label}</span>
      </div>

      {/* Header row */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:500, margin:"0 0 4px" }}>{segment.label}</h1>
          <p style={{ fontSize:13, color:"var(--color-text-secondary)", margin:0 }}>
            {segment.maneuver_type?.replace(/_/g," ") ?? "General"}{" · "}
            Iterations {segment.start_iteration.toLocaleString()} — {segment.end_iteration.toLocaleString()}{" · "}
            {segment.duration_loops?.toLocaleString()} loops
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <select value={fftCfg.window} onChange={e => setFftCfg(c => ({...c, window: e.target.value}))} style={smInput}>
            {WINDOWS.map(w => <option key={w}>{w}</option>)}
          </select>
          <select value={fftCfg.nperseg} onChange={e => setFftCfg(c => ({...c, nperseg: +e.target.value}))} style={smInput}>
            {[256,512,1024,2048,4096].map(n => <option key={n} value={n}>{n} pts</option>)}
          </select>
          <select value={fftCfg.overlap_pct} onChange={e => setFftCfg(c => ({...c, overlap_pct: +e.target.value}))} style={smInput}>
            {[0.5,0.75,0.875].map(o => <option key={o} value={o}>{(o*100).toFixed(0)}% overlap</option>)}
          </select>
          <button onClick={runAnalysis} disabled={running} style={primaryBtn}>
            {running ? "Running…" : "Run analysis"}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:2, borderBottom:"1px solid var(--color-border-tertiary)" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            ...tabBtn,
            color: activeTab===t ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            borderBottom: activeTab===t ? "2px solid var(--color-text-primary)" : "2px solid transparent",
          }}>{t}</button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "Overview"      && <OverviewPanel   metrics={metrics} moduleMetrics={moduleMetrics} />}
      {activeTab === "FFT"           && <FFTPanel        fftData={fftData} />}
      {activeTab === "Bode / Phase"  && <BodePanel       bodeData={bodeData} />}
      {activeTab === "PIDF Balance"  && <PIDFPanel       metrics={moduleMetrics("pidf_balance")} />}
      {activeTab === "AI Analysis"   && <AIPanel         aiResults={aiResults} segmentId={segmentId} onRefresh={loadResults} />}
    </div>
  )
}

// ── Overview panel ────────────────────────────────────────────────────────────

function OverviewPanel({ metrics, moduleMetrics }) {
  const modules = [
    { key:"tracking_error",  title:"Tracking Error",     unit:"deg/s" },
    { key:"step_response",   title:"Step Response" },
    { key:"oscillation",     title:"Oscillation" },
    { key:"control_latency", title:"Control Latency",    unit:"ms" },
    { key:"governor",        title:"Governor / Headspeed", unit:"RPM" },
  ]

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:16 }}>
      {modules.map(m => (
        <MetricCard key={m.key} title={m.title} metrics={moduleMetrics(m.key)} unit={m.unit} />
      ))}
    </div>
  )
}

function MetricCard({ title, metrics, unit }) {
  const scalars = metrics.filter(m => m.value_float !== null && m.value_float !== undefined)
  return (
    <div style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:20 }}>
      <h3 style={{ fontSize:14, fontWeight:500, margin:"0 0 12px" }}>{title}</h3>
      {scalars.length === 0 ? (
        <p style={{ fontSize:13, color:"var(--color-text-tertiary)", margin:0 }}>No results yet</p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {scalars.slice(0,12).map(m => (
            <div key={m.metric_name} style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
              <span style={{ color:"var(--color-text-secondary)" }}>{m.metric_name.replace(/_/g," ")}</span>
              <span style={{ fontVariantNumeric:"tabular-nums" }}>
                {typeof m.value_float === "number"
                  ? m.value_float < 10 ? m.value_float.toFixed(3) : m.value_float.toFixed(1)
                  : String(m.value_float)}
                {m.unit ? ` ${m.unit}` : unit ? ` ${unit}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── FFT panel ─────────────────────────────────────────────────────────────────

function FFTPanel({ fftData }) {
  const canvasRef = useRef(null)
  const [axis, setAxis] = useState("roll")

  useEffect(() => {
    if (!fftData || !canvasRef.current) return
    drawFFT(canvasRef.current, fftData, axis)
  }, [fftData, axis])

  if (!fftData) return <EmptyState msg="Run analysis to generate FFT data." />

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <span style={{ fontSize:13, color:"var(--color-text-secondary)" }}>Axis:</span>
        {AXES.map(a => (
          <button key={a} onClick={() => setAxis(a)} style={{
            ...smBtn,
            background: axis===a ? "var(--color-text-primary)" : "transparent",
            color: axis===a ? "var(--color-background-primary)" : "var(--color-text-secondary)",
          }}>{a}</button>
        ))}
        <span style={{ fontSize:12, color:"var(--color-text-tertiary)", marginLeft:"auto" }}>
          Window: {fftData.window} · {fftData.nperseg} pts · {(fftData.overlap_pct*100).toFixed(0)}% overlap
        </span>
      </div>
      <div style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:16 }}>
        <canvas ref={canvasRef} width={900} height={380} style={{ width:"100%", height:"auto" }} />
        <FFTLegend fftData={fftData} axis={axis} />
      </div>
    </div>
  )
}

function drawFFT(canvas, fftData, axis) {
  const ctx  = canvas.getContext("2d")
  const W    = canvas.width
  const H    = canvas.height
  const PAD  = { top:20, right:40, bottom:50, left:60 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top  - PAD.bottom

  ctx.clearRect(0, 0, W, H)

  const freqs   = fftData.freqs ?? []
  const rawPSD  = fftData[`${axis}_raw_psd`]
  const filtPSD = fftData[`${axis}_filt_psd`]
  const bands   = (fftData.filter_bands ?? []).filter(b => b.axis === axis || b.axis === "all")

  if (!rawPSD || freqs.length === 0) return

  const maxFreq = Math.max(...freqs)
  const allVals = [...(rawPSD ?? []), ...(filtPSD ?? [])].filter(v => isFinite(v))
  const minV = Math.min(...allVals) - 5
  const maxV = Math.max(...allVals) + 5

  const toX = f  => PAD.left + (f / maxFreq) * plotW
  const toY = db => PAD.top  + plotH - ((db - minV) / (maxV - minV)) * plotH

  // Shaded filter bands
  const bandColors = { blue:"rgba(24,95,165,0.12)", teal:"rgba(15,110,86,0.12)", amber:"rgba(186,117,23,0.10)", coral:"rgba(216,90,48,0.12)", purple:"rgba(83,74,183,0.12)", green:"rgba(99,153,34,0.10)" }
  bands.forEach(band => {
    const x1 = toX(Math.max(0, band.lo_hz))
    const x2 = toX(Math.min(maxFreq, band.hi_hz))
    ctx.fillStyle = bandColors[band.color_hint] ?? "rgba(128,128,128,0.10)"
    ctx.fillRect(x1, PAD.top, x2 - x1, plotH)
    // Cutoff marker line
    ctx.strokeStyle = bandColors[band.color_hint]?.replace("0.12","0.5") ?? "rgba(128,128,128,0.4)"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(x1, PAD.top); ctx.lineTo(x1, PAD.top + plotH); ctx.stroke()
    ctx.setLineDash([])
  })

  // Grid lines
  ctx.strokeStyle = "rgba(128,128,128,0.15)"
  ctx.lineWidth = 0.5
  for (let db = Math.ceil(minV/10)*10; db <= maxV; db += 10) {
    const y = toY(db)
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke()
    ctx.fillStyle = "rgba(128,128,128,0.6)"; ctx.font = "11px sans-serif"
    ctx.fillText(`${db} dB`, PAD.left - 55, y + 4)
  }
  for (let f = 0; f <= maxFreq; f += 50) {
    const x = toX(f)
    ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke()
    ctx.fillStyle = "rgba(128,128,128,0.6)"; ctx.font = "11px sans-serif"
    ctx.fillText(`${f}`, x - 8, PAD.top + plotH + 18)
  }

  // Draw traces
  function drawLine(psd, color, dash=[]) {
    if (!psd) return
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash)
    ctx.beginPath()
    psd.forEach((v, i) => {
      const x = toX(freqs[i]); const y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke(); ctx.setLineDash([])
  }

  drawLine(rawPSD,  "rgba(200,80,80,0.7)",  [3,2])
  drawLine(filtPSD, AXIS_COLORS[axis] ?? "#185FA5")

  // Axis labels
  ctx.fillStyle = "rgba(128,128,128,0.8)"; ctx.font = "12px sans-serif"
  ctx.fillText("Hz", PAD.left + plotW/2 - 8, H - 8)
  ctx.save(); ctx.translate(14, PAD.top + plotH/2)
  ctx.rotate(-Math.PI/2); ctx.fillText("dB", -8, 0); ctx.restore()
}

function FFTLegend({ fftData, axis }) {
  const bands = (fftData.filter_bands ?? []).filter(b => b.axis === axis || b.axis === "all")
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:12, marginTop:12, fontSize:12, color:"var(--color-text-secondary)" }}>
      <span style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ width:20, height:2, background:"rgba(200,80,80,0.7)", display:"inline-block", borderTop:"2px dashed rgba(200,80,80,0.7)" }}></span>
        Raw gyro (pre-filter)
      </span>
      <span style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ width:20, height:2, background:AXIS_COLORS[axis], display:"inline-block" }}></span>
        Filtered gyro
      </span>
      {bands.slice(0,4).map(b => (
        <span key={b.label} style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ width:10, height:10, background:"rgba(186,117,23,0.3)", display:"inline-block", borderRadius:2 }}></span>
          {b.label}
        </span>
      ))}
    </div>
  )
}

// ── Bode panel ────────────────────────────────────────────────────────────────

function BodePanel({ bodeData }) {
  const [axis, setAxis] = useState("roll")
  const magRef = useRef(null)
  const phaseRef = useRef(null)

  useEffect(() => {
    if (!bodeData || !magRef.current) return
    drawBode(magRef.current, phaseRef.current, bodeData, axis)
  }, [bodeData, axis])

  if (!bodeData) return <EmptyState msg="Run analysis to generate Bode data." />

  const pm  = bodeData[`${axis}_bode_phase_margin_deg`]
  const gm  = bodeData[`${axis}_bode_gain_margin_db`]
  const gcf = bodeData[`${axis}_bode_gain_crossover_hz`]
  const sta = bodeData[`${axis}_bode_stability`]

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <span style={{ fontSize:13, color:"var(--color-text-secondary)" }}>Axis:</span>
        {AXES.map(a => (
          <button key={a} onClick={() => setAxis(a)} style={{
            ...smBtn,
            background: axis===a ? "var(--color-text-primary)" : "transparent",
            color: axis===a ? "var(--color-background-primary)" : "var(--color-text-secondary)",
          }}>{a}</button>
        ))}
        {pm != null && (
          <div style={{ marginLeft:"auto", display:"flex", gap:16, fontSize:13 }}>
            <span style={{ color: sta==="stable" ? "var(--color-text-success)" : sta==="unstable" ? "var(--color-text-danger)" : "var(--color-text-warning)" }}>
              {sta?.toUpperCase()}
            </span>
            <span>Phase margin: <strong>{pm?.toFixed(1)}°</strong></span>
            <span>Gain margin: <strong>{gm?.toFixed(1)} dB</strong></span>
            <span>Crossover: <strong>{gcf?.toFixed(1)} Hz</strong></span>
          </div>
        )}
      </div>
      <div style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:16 }}>
        <canvas ref={magRef}   width={900} height={240} style={{ width:"100%", height:"auto" }} />
        <canvas ref={phaseRef} width={900} height={200} style={{ width:"100%", height:"auto", marginTop:8 }} />
        <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginTop:8 }}>
          Shaded region = coherence &lt; 0.6 (unreliable estimate)
        </div>
      </div>
    </div>
  )
}

function drawBode(magCanvas, phaseCanvas, bodeData, axis) {
  const prefix = `${axis}_bode`
  const freqs = bodeData[`${prefix}_freqs`]
  const mag   = bodeData[`${prefix}_magnitude_db`]
  const phase = bodeData[`${prefix}_phase_unwrapped`]
  const coh   = bodeData[`${prefix}_coherence`]
  if (!freqs || !mag) return

  const color = AXIS_COLORS[axis]
  const PAD   = { top:16, right:30, bottom:36, left:56 }

  function drawPlot(canvas, data, yLabel, yTicks, color, coherence) {
    const ctx = canvas.getContext("2d")
    const W = canvas.width, H = canvas.height
    const plotW = W - PAD.left - PAD.right
    const plotH = H - PAD.top  - PAD.bottom
    ctx.clearRect(0, 0, W, H)

    const vals   = data.filter(v => isFinite(v))
    const minV   = Math.min(...vals) - 5
    const maxV   = Math.max(...vals) + 5
    const maxFreq = Math.max(...freqs)
    const toX    = f  => PAD.left + (f/maxFreq)*plotW
    const toY    = v  => PAD.top  + plotH - ((v-minV)/(maxV-minV))*plotH

    // Shade low-coherence regions
    if (coherence) {
      for (let i = 1; i < freqs.length; i++) {
        if (coherence[i] < 0.6) {
          ctx.fillStyle = "rgba(128,128,128,0.12)"
          ctx.fillRect(toX(freqs[i-1]), PAD.top, toX(freqs[i])-toX(freqs[i-1]), plotH)
        }
      }
    }

    // 0 dB / 0° reference line
    if (minV < 0 && maxV > 0) {
      const y0 = toY(0)
      ctx.strokeStyle = "rgba(128,128,128,0.3)"; ctx.lineWidth = 1; ctx.setLineDash([4,3])
      ctx.beginPath(); ctx.moveTo(PAD.left, y0); ctx.lineTo(PAD.left+plotW, y0); ctx.stroke()
      ctx.setLineDash([])
    }

    // Data line
    ctx.strokeStyle = color; ctx.lineWidth = 1.5
    ctx.beginPath()
    data.forEach((v, i) => {
      const x = toX(freqs[i]); const y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Axes labels
    ctx.fillStyle = "rgba(128,128,128,0.7)"; ctx.font = "11px sans-serif"
    yTicks.forEach(t => {
      const y = toY(t)
      if (y > PAD.top && y < PAD.top+plotH) {
        ctx.fillText(`${t}`, PAD.left-50, y+4)
        ctx.strokeStyle = "rgba(128,128,128,0.1)"; ctx.lineWidth=0.5
        ctx.beginPath(); ctx.moveTo(PAD.left,y); ctx.lineTo(PAD.left+plotW,y); ctx.stroke()
      }
    })
    for (let f = 0; f <= maxFreq; f += 50) {
      ctx.fillText(`${f}`, toX(f)-8, PAD.top+plotH+18)
    }
    ctx.fillText(yLabel, 8, PAD.top + plotH/2 + 4)
  }

  const magTicks   = [-40,-20,-10,0,10,20]
  const phaseTicks = [-360,-270,-180,-90,0]
  drawPlot(magCanvas,   mag,   "dB",  magTicks,   color, coh)
  drawPlot(phaseCanvas, phase, "°",   phaseTicks, color, coh)
}

// ── PIDF Balance panel ────────────────────────────────────────────────────────

function PIDFPanel({ metrics }) {
  if (metrics.length === 0) return <EmptyState msg="Run analysis to see PIDF balance." />

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:16 }}>
      {AXES.map(axis => {
        const terms = ["P","I","D","F","B","O"]
        const rows  = terms.map(t => {
          const rms  = metrics.find(m => m.metric_name === `${axis}_${t}_rms`)?.value_float ?? 0
          const pct  = metrics.find(m => m.metric_name === `${axis}_${t}_contribution`)?.value_float ?? 0
          return { term:t, rms, pct }
        }).filter(r => r.rms > 0)

        const dp = metrics.find(m => m.metric_name === `${axis}_D_P_ratio`)?.value_float
        const iw = metrics.find(m => m.metric_name === `${axis}_i_windup_flag`)?.value_float

        return (
          <div key={axis} style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:20 }}>
            <h3 style={{ fontSize:14, fontWeight:500, margin:"0 0 12px", color: AXIS_COLORS[axis] }}>
              {axis.charAt(0).toUpperCase() + axis.slice(1)}
            </h3>
            {rows.map(r => (
              <div key={r.term} style={{ marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                  <span style={{ color:"var(--color-text-secondary)" }}>{r.term}</span>
                  <span>{(r.pct*100).toFixed(1)}%</span>
                </div>
                <div style={{ height:6, background:"var(--color-background-secondary)", borderRadius:3 }}>
                  <div style={{ height:6, borderRadius:3, width:`${Math.min(r.pct*100,100)}%`, background: AXIS_COLORS[axis] }} />
                </div>
              </div>
            ))}
            {dp != null && (
              <div style={{ marginTop:10, fontSize:12, color: dp > 0.7 ? "var(--color-text-warning)" : "var(--color-text-secondary)" }}>
                D/P ratio: {dp.toFixed(2)} {dp > 0.7 ? "⚠ D-heavy" : ""}
              </div>
            )}
            {iw === 1 && (
              <div style={{ marginTop:4, fontSize:12, color:"var(--color-text-warning)" }}>⚠ I wind-up possible</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── AI panel ──────────────────────────────────────────────────────────────────

function AIPanel({ aiResults, segmentId, onRefresh }) {
  const [model,    setModel]    = useState("claude-sonnet-4-20250514")
  const [template, setTemplate] = useState("default")
  const [loading,  setLoading]  = useState(false)

  const latest = aiResults[0]

  async function handleRequest() {
    setLoading(true)
    await api.ai.analyze(segmentId, model, template)
    await new Promise(r => setTimeout(r, 4000))
    await onRefresh()
    setLoading(false)
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <select value={model} onChange={e => setModel(e.target.value)} style={smInput}>
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4.6</option>
          <option value="claude-opus-4-6">Claude Opus 4.6</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
        </select>
        <select value={template} onChange={e => setTemplate(e.target.value)} style={smInput}>
          <option value="default">General analysis</option>
          <option value="oscillation">Oscillation focus</option>
          <option value="governor">Governor focus</option>
        </select>
        <button onClick={handleRequest} disabled={loading} style={primaryBtn}>
          {loading ? "Analyzing…" : "Request AI analysis"}
        </button>
      </div>

      {!latest && (
        <div style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:24 }}>
          <p style={{ fontSize:14, color:"var(--color-text-secondary)", margin:0 }}>
            No AI analysis yet. Run analysis first, then request an AI review.
          </p>
        </div>
      )}

      {latest && (
        <div style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:24, display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:13, color:"var(--color-text-secondary)" }}>
              {latest.model_used} · {new Date(latest.requested_at).toLocaleString()}
            </span>
            <StatusBadge status={latest.status} />
          </div>

          {latest.narrative && (
            <p style={{ fontSize:14, lineHeight:1.7, margin:0 }}>{latest.narrative}</p>
          )}

          {latest.structured_output?.issues?.length > 0 && (
            <div>
              <h3 style={{ fontSize:14, fontWeight:500, margin:"0 0 10px" }}>Issues found</h3>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {latest.structured_output.issues.map((issue, i) => (
                  <div key={i} style={{
                    padding:"12px 16px", borderRadius:8,
                    background: issue.severity==="critical" ? "var(--color-background-danger)"
                               : issue.severity==="warning"  ? "var(--color-background-warning)"
                               : "var(--color-background-info)",
                    border: "1px solid",
                    borderColor: issue.severity==="critical" ? "var(--color-border-danger)"
                               : issue.severity==="warning"  ? "var(--color-border-warning)"
                               : "var(--color-border-info)",
                  }}>
                    <div style={{ fontSize:13, fontWeight:500, marginBottom:4 }}>
                      [{issue.axis}] {issue.category} — {issue.severity}
                    </div>
                    <div style={{ fontSize:13, marginBottom:4 }}>{issue.description}</div>
                    {issue.recommendation && (
                      <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontStyle:"italic" }}>
                        → {issue.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = { complete:"var(--color-text-success)", pending:"var(--color-text-secondary)", running:"var(--color-text-info)", error:"var(--color-text-danger)" }
  return <span style={{ fontSize:12, color: colors[status] ?? "var(--color-text-secondary)", fontWeight:500 }}>{status?.toUpperCase()}</span>
}

function EmptyState({ msg }) {
  return (
    <div style={{ background:"var(--color-background-primary)", border:"1px solid var(--color-border-tertiary)", borderRadius:12, padding:32, textAlign:"center" }}>
      <p style={{ fontSize:14, color:"var(--color-text-secondary)", margin:0 }}>{msg}</p>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const primaryBtn = { padding:"8px 16px", borderRadius:8, border:"none", background:"var(--color-text-primary)", color:"var(--color-background-primary)", fontSize:13, fontWeight:500, cursor:"pointer" }
const smInput = { padding:"6px 10px", borderRadius:6, border:"1px solid var(--color-border-secondary)", background:"var(--color-background-secondary)", color:"var(--color-text-primary)", fontSize:13, outline:"none" }
const smBtn   = { padding:"5px 12px", borderRadius:6, border:"1px solid var(--color-border-secondary)", fontSize:13, cursor:"pointer" }
const tabBtn  = { padding:"10px 16px", background:"none", border:"none", borderBottom:"2px solid transparent", fontSize:14, cursor:"pointer", marginBottom:-1 }
const linkBtn = { background:"none", border:"none", cursor:"pointer", color:"var(--color-text-secondary)", fontSize:13, padding:0 }
