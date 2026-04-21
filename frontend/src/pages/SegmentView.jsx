// SegmentView.jsx — Full 10-tab analysis dashboard
// Tabs: Overview · Tracking · PID Terms · Noise · Dynamics · FFT · Governor · PIDF Balance · Advisor · Findings
import { useEffect, useRef, useState, useCallback } from "react";
import {
  getSegment, getFlight,
  runAnalysis, getAnalysisResults,
  getFFTResults, getBodeResults, getConfigForFlight,
  requestAIAnalysis, getAIResults,
} from "../api.js";

const Chart = window.Chart;

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  roll:"#00d4ff", pitch:"#a78bfa", yaw:"#fbbf24",
  P:"#00d4ff", I:"#10b981", D:"#f97316", F:"#a78bfa",
  green:"#10b981", orange:"#f97316", red:"#ef4444", accent:"#00c8ff",
  text2:"#94a3b8", text3:"#475569",
  bg:"#0a0e14", surface:"#111820", surface2:"#141820", surface3:"#1a1f2e",
  border:"#1e3a5f",
};
const AX   = [C.roll,  C.pitch, C.yaw];
const AN   = ["Roll",  "Pitch", "Yaw"];
const TCLR = {P:C.P, I:C.I, D:C.D, F:C.F};
const TABS = [
  {id:"overview", label:"Overview"}, {id:"tracking", label:"Tracking"},
  {id:"pid",      label:"PID Terms"},{id:"noise",    label:"Noise"},
  {id:"dynamics", label:"Dynamics"}, {id:"fft",      label:"FFT"},
  {id:"governor", label:"Governor"}, {id:"balance",  label:"PIDF Balance"},
  {id:"advisor",  label:"Advisor"},  {id:"findings", label:"Findings"},
  {id:"bandwidth",label:"PID BW"},   {id:"ai",       label:"AI"},
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const safeArr = v => Array.isArray(v) ? v.map(Number).filter(n=>!isNaN(n)) : [];
const mean    = a => { const s=safeArr(a); return s.length?s.reduce((x,v)=>x+v,0)/s.length:0; };
const noiseClr= n => n>30?C.red:n>15?C.orange:C.green;
const pmClr   = p => p>60?C.green:p>45?C.orange:C.red;
const pmLabel = p => p>75?"conservative":p>60?"healthy":p>45?"marginal":"unsafe";
const latClr  = l => l<30?C.green:l<50?C.orange:C.red;
const bwClr   = b => b>8?C.accent:b>4?C.green:b>2?C.orange:C.red;

const chartBase = (extra={}) => ({
  responsive:true, maintainAspectRatio:false, animation:{duration:0},
  interaction:{mode:"index",intersect:false},
  plugins:{
    legend:{display:false},
    tooltip:{
      backgroundColor:"rgba(10,12,16,0.95)", borderColor:C.border, borderWidth:1,
      titleColor:C.text2, bodyColor:"#e2e8f0",
      titleFont:{family:"JetBrains Mono",size:10}, bodyFont:{family:"JetBrains Mono",size:11},
    }
  },
  scales:{
    x:{grid:{color:C.border,drawTicks:false},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9},maxTicksLimit:8},border:{color:C.border}},
    y:{grid:{color:C.border,drawTicks:false},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9},maxTicksLimit:6},border:{color:C.border},...(extra.yScale||{})},
    ...(extra.extraScales||{}),
  },...extra,
});

// ── Bandwidth tab math helpers (module-level, no re-allocation per render) ───
const _BW_FREQS = (() => {
  const f = [];
  for (let i = 0; i <= 160; i++) f.push(+(Math.pow(10, -1 + 2.65 * i / 160).toFixed(5)));
  return f;
})();
const _lpfMagDB  = (f, fc) => 20 * Math.log10(1 / Math.sqrt(1 + (f/fc) ** 2));
const _difMagDB  = (f, fc) => { const r = f/fc; return 20 * Math.log10(r / Math.sqrt(1 + r*r)); };
const _lpfPhase  = (f, fc) => -Math.atan(f/fc) * 180 / Math.PI;
const _difPhase  = (f, fc) => (Math.PI/2 - Math.atan(f/fc)) * 180 / Math.PI;
// Shared scale configs for bandwidth Bode charts
const _BW_LOG_X = { type:"logarithmic", min:0.1, max:300,
  grid:{color:C.border,drawTicks:false}, border:{color:C.border},
  ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9},
    callback:v=>[0.1,0.2,0.5,1,2,5,10,20,50,100,200].some(n=>Math.abs(n-v)/v<0.05)?v:""},
  title:{display:true,text:"Frequency (Hz)",color:C.text3,font:{family:"JetBrains Mono",size:9}},
};
const _BW_LIN_X = lbl=>({type:"linear",grid:{color:C.border,drawTicks:false},border:{color:C.border},
  ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9}},
  title:{display:true,text:lbl,color:C.text3,font:{family:"JetBrains Mono",size:9}},
});
const _BW_LIN_Y = (min,max,lbl)=>({min,max,grid:{color:C.border,drawTicks:false},border:{color:C.border},
  ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9}},
  title:{display:true,text:lbl,color:C.text3,font:{family:"JetBrains Mono",size:9}},
});

// ── Stable module-level UI components (moved out of SegmentView to prevent
//    identity reset on every parent re-render, enabling persistent useState) ──

function Panel({title, badge, ctrl, children, style, info}) {
  const [open, setOpen] = React.useState(false);
  return <div className="sv-panel" style={style}>
    <div className="sv-panel-hdr">
      <span className="sv-panel-title">{title}</span>
      {badge && <span className="sv-panel-badge">{badge}</span>}
      <div style={{flex:1}}/>
      {info && (
        <button onClick={()=>setOpen(v=>!v)}
          title="What does this graph show?"
          style={{background:"none",border:`1px solid ${open?C.accent+"88":C.border}`,
            borderRadius:4,color:open?C.accent:C.text3,cursor:"pointer",
            fontSize:11,fontFamily:"JetBrains Mono,monospace",padding:"1px 7px",
            lineHeight:1.5,marginRight:6,transition:"all .15s",flexShrink:0}}>ⓘ</button>
      )}
      {ctrl}
    </div>
    {open && info && (
      <div style={{background:"rgba(0,200,255,.04)",border:`1px solid ${C.accent}22`,
        borderRadius:6,padding:"10px 14px",marginBottom:12,
        fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text2,lineHeight:1.75}}>
        {info.what && <div>{info.what}</div>}
        {info.trend && (
          <div style={{marginTop:7,paddingTop:7,borderTop:`1px solid ${C.border}44`,color:C.green}}>
            <span style={{color:C.text3}}>Optimal: </span>{info.trend}
          </div>
        )}
      </div>
    )}
    {children}
  </div>;
}

function ChartBox({id, h=220, onMount}) {
  const ref = React.useRef();
  React.useEffect(()=>{ if(ref.current && onMount) onMount(ref.current); }, [onMount]);
  return <div style={{height:h, position:"relative"}}><canvas ref={ref} id={id}/></div>;
}

function Legend({items}) {
  return <div className="sv-legend" style={{marginTop:6}}>
    {items.map((it,i)=><div key={i} className="sv-legend-item">
      <div className="sv-legend-dot" style={{background:it.color}}/>
      {it.label}
    </div>)}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
export default function SegmentView({ segmentId, onBack }) {
  const [seg,      setSeg]      = useState(null);
  const [flight,   setFlight]   = useState(null);
  const [results,  setResults]  = useState(null);
  const [fftData,  setFftData]  = useState(null);
  const [bodeData, setBodeData] = useState(null);
  const [configData,setConfigData] = useState(null);
  const [status,   setStatus]   = useState("idle");
  const [tab,      setTab]      = useState("overview");
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy,   setAiBusy]   = useState(false);

  // per-tab UI state
  const [ovAxis,   setOvAxis]   = useState("all");
  const [fftAxis,  setFftAxis]  = useState(0);
  const [fftLog,   setFftLog]   = useState(true);
  const [balAxis,  setBalAxis]  = useState(0);
  const [balMode,  setBalMode]  = useState("stacked");
  const [stepAxis, setStepAxis] = useState(0);
  const [advAxis,  setAdvAxis]  = useState(0);
  const [whatifAxis, setWhatifAxis] = useState(0);
  const [bwAxis,   setBwAxis]   = useState(0);
  const [mults,    setMults]    = useState({P:1,I:1,D:1,F:1,fc:1});

  const charts = useRef({});
  const pollRef = useRef(null);

  useEffect(() => {
    (async () => {
      const s = await getSegment(segmentId);
      setSeg(s);
      const f = await getFlight(s.flight_id);
      setFlight(f);
      fetchConfig(s.flight_id);
      if (s.analysis_status === "complete") {
        await fetchAll(segmentId);
        setStatus("done");
      }
    })();
    return () => clearInterval(pollRef.current);
  }, [segmentId]);

  async function fetchAll(sid) {
    const [r,f,b] = await Promise.all([
      getAnalysisResults(sid).catch(()=>null),
      getFFTResults(sid).catch(()=>null),
      getBodeResults(sid).catch(()=>null),
    ]);
    setResults(r); setFftData(f); setBodeData(b);
  }

  async function fetchConfig(flightId) {
    const cfg = await getConfigForFlight(flightId).catch(()=>null);
    if (cfg?.found) setConfigData(cfg);
  }

  async function handleRun() {
    setStatus("running");
    await runAnalysis(segmentId);
    pollRef.current = setInterval(async () => {
      const r = await getAnalysisResults(segmentId).catch(()=>null);
      if (r?.status === "complete") {
        clearInterval(pollRef.current);
        await fetchAll(segmentId);
        setStatus("done");
      } else if (r?.status === "error") {
        clearInterval(pollRef.current);
        setStatus("error");
      }
    }, 2000);
  }

  async function handleAI() {
    setAiBusy(true);
    await requestAIAnalysis(segmentId);
    const iv = setInterval(async () => {
      const r = await getAIResults(segmentId).catch(()=>null);
      if (r?.status === "complete" || r?.status === "error") {
        clearInterval(iv);
        setAiResult(r);
        setAiBusy(false);
      }
    }, 2000);
  }

  // ── Chart helpers ─────────────────────────────────────────────────────────
  function kill(key) { if(charts.current[key]){charts.current[key].destroy();delete charts.current[key];} }

  function timeLine(canvas, datasets, labels, extra={}) {
    if (!canvas||!labels?.length) return;
    kill(canvas.id);
    charts.current[canvas.id] = new Chart(canvas.getContext("2d"), {
      type:"line",
      data:{labels, datasets:datasets.map(d=>({borderWidth:1.5,pointRadius:0,tension:0.1,fill:false,...d}))},
      options:chartBase(extra),
    });
  }
  function mkScatterChart(canvas, datasets, xScale, yScale, legend) {
    if (!canvas) return;
    kill(canvas.id);
    charts.current[canvas.id] = new Chart(canvas.getContext("2d"), {
      type:"scatter", data:{ datasets },
      options:{ responsive:true, maintainAspectRatio:false, animation:{duration:0},
        plugins:{
          legend:legend?{display:true,position:"top",labels:{color:C.text2,font:{family:"JetBrains Mono",size:9},boxWidth:12,padding:8}}:{display:false},
          tooltip:{enabled:false},
        },
        scales:{ x:xScale, y:yScale },
      },
    });
  }
  function mkBarChart(canvas, labels, data, colors, xTitle) {
    if (!canvas) return;
    kill(canvas.id);
    charts.current[canvas.id] = new Chart(canvas.getContext("2d"), {
      type:"bar", data:{ labels, datasets:[{data, backgroundColor:colors.map(c=>c+"88"), borderColor:colors, borderWidth:1}]},
      options:{ indexAxis:"y", responsive:true, maintainAspectRatio:false, animation:{duration:0},
        plugins:{legend:{display:false},tooltip:{enabled:false}},
        scales:{
          x:{grid:{color:C.border},border:{color:C.border},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9}},title:{display:true,text:xTitle,color:C.text3,font:{family:"JetBrains Mono",size:9}}},
          y:{grid:{color:C.border},border:{color:C.border},ticks:{color:C.text2,font:{family:"JetBrains Mono",size:10}}},
        },
      },
    });
  }

  // ── Data accessors ────────────────────────────────────────────────────────
  const m      = (mod,name) => results?.metrics?.[`${mod}_${name}`] ?? null;
  const mf     = (mod,name,dec=1) => { const v=m(mod,name); return v!==null?Number(v).toFixed(dec):"—"; };
  const arr    = (key) => safeArr(results?.arrays?.[key]||[]);
  const times  = () => safeArr(results?.arrays?.["overview_time_s"]||[]);
  const axArr  = (prefix,i) => arr(`${prefix}_${["roll","pitch","yaw"][i]}`);

  // ════════════════════════════════════════════════════════════════════════
  // OVERVIEW
  // ════════════════════════════════════════════════════════════════════════
  function OverviewTab() {
    const labels = times();
    const buildChart = useCallback(canvas=>{
      if(!canvas||!labels.length) return;
      const ds=[];
      const show=i=>ovAxis==="all"||ovAxis===AN[i].toLowerCase();
      [0,1,2].forEach(i=>{
        if(!show(i)) return;
        ds.push({label:AN[i],data:axArr("overview_gyro_adc",i),borderColor:AX[i]});
        if(ovAxis==="all") ds.push({label:`${AN[i]} SP`,data:axArr("overview_setpoint",i),borderColor:AX[i]+"44",borderDash:[3,3]});
      });
      timeLine(canvas,ds,labels);
    },[ovAxis,results]);

    const hs    = mf("governor","headspeed_mean",0);
    const hsStd = mf("governor","headspeed_std",1);
    const vbat  = m("overview","vbat_mean");
    const ibat  = m("overview","ibat_mean");

    return <div className="sv-tab">
      <div className="sv-stats">
        <SC label="Duration"    value={seg?.duration_s?.toFixed(1)??"—"} unit="s" color={C.accent}/>
        <SC label="Headspeed"   value={hs} unit=" RPM" sub={`σ ±${hsStd} RPM`} color={C.accent}/>
        {[0,1,2].map(i=><SC key={i} label={`${AN[i]} Err RMS`} value={mf("tracking_error",`rms_${["roll","pitch","yaw"][i]}`)} unit=" °/s" color={AX[i]}/>)}
        {[0,1,2].map(i=><SC key={i+3} label={`${AN[i]} Noise σ`} value={mf("noise",`std_${["roll","pitch","yaw"][i]}`)} unit=" °/s"
          color={noiseClr(parseFloat(mf("noise",`std_${["roll","pitch","yaw"][i]}`)||"0"))}/>)}
        {vbat&&<SC label="Battery" value={Number(vbat).toFixed(1)} unit="V" color={C.orange} sub={ibat?`${Number(ibat).toFixed(0)}A avg`:""}/>}
      </div>
      <Panel title="Gyro Rate Overview" badge="All Axes"
        info={{what:"Shows gyro rate (°/s) for all three axes over the segment duration. Useful for spotting oscillations, mechanical vibrations, and how actively each axis is being commanded.",trend:"Lines should be smooth and track stick inputs cleanly. High-frequency hash without stick input = noise passing through filters. Symmetric waveforms on all axes = mechanically balanced setup."}}
        ctrl={
        <div className="sv-ctrl-row">
          {["all","roll","pitch","yaw"].map(ax=>(
            <button key={ax} className={`sv-btn ${ovAxis===ax?"active":""}`} onClick={()=>setOvAxis(ax)}>
              {ax[0].toUpperCase()+ax.slice(1)}
            </button>
          ))}
        </div>}>
        <ChartBox id="sv-ov" h={240} onMount={buildChart}/>
        <Legend items={[0,1,2].filter(i=>ovAxis==="all"||ovAxis===AN[i].toLowerCase()).map(i=>({color:AX[i],label:AN[i]}))}/>
      </Panel>
      <div className="sv-axis-grid">
        {[0,1,2].map(i=><AxisCard key={i} i={i} m={m} mf={mf}/>)}
      </div>
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // TRACKING
  // ════════════════════════════════════════════════════════════════════════
  function TrackingTab() {
    const labels = times();
    return <div className="sv-tab">
      <div className="sv-stats" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
        {[0,1,2].map(i=><SC key={i} label={`${AN[i]} RMS Err`} value={mf("tracking_error",`rms_${["roll","pitch","yaw"][i]}`)} unit=" °/s"
          sub={`Peak: ${mf("tracking_error",`peak_${["roll","pitch","yaw"][i]}`)} °/s`} color={AX[i]}/>)}
      </div>
      {[0,1,2].map(i=>(
        <Panel key={i} title={`${AN[i]} — Setpoint vs Gyro`} badge="deg/s"
          info={{what:"Compares the commanded rate (setpoint, dashed) against the measured rate (gyro, solid). The gap between them is tracking error — how well the PID loop makes the helicopter follow pilot commands.",trend:"Gyro should closely shadow setpoint with minimal lag and no overshoot. Wide persistent gap = increase P-gain or F-term. Gyro overshoots and rings after inputs = P too high or D too low."}}>
          <ChartBox id={`sv-trk-${i}`} h={180} onMount={c=>timeLine(c,[
            {label:"Setpoint",data:axArr("overview_setpoint",i),borderColor:"rgba(255,255,255,0.3)",borderDash:[4,3]},
            {label:"Gyro",    data:axArr("overview_gyro_adc",i),borderColor:AX[i]},
          ],labels)}/>
          <Legend items={[{color:"rgba(255,255,255,0.4)",label:"Setpoint"},{color:AX[i],label:"Gyro"}]}/>
        </Panel>
      ))}
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PID TERMS
  // ════════════════════════════════════════════════════════════════════════
  function PIDTab() {
    const labels = times();
    return <div className="sv-tab">
      {[0,1,2].map(i=>(
        <Panel key={i} title={`${AN[i]} — PID Terms`} badge="RF units"
          info={{what:"Shows the output magnitude of each PID term over time. P responds to current error, I integrates accumulated error, D damps the rate of change, F (feedforward) anticipates commands directly from setpoint without waiting for error.",trend:"P should be the largest active term. I should be small and slow-moving — large I indicates the loop is fighting a persistent bias. D should be smaller than P. F should pulse cleanly with stick inputs. If D is spiky and larger than P, dterm_cutoff is too high."}}>
          <ChartBox id={`sv-pid-${i}`} h={180} onMount={c=>timeLine(c,[
            {label:"P",data:axArr("overview_pid_p",i),borderColor:C.P},
            {label:"I",data:axArr("overview_pid_i",i),borderColor:C.I},
            {label:"D",data:axArr("overview_pid_d",i),borderColor:C.D},
            {label:"F",data:axArr("overview_pid_f",i),borderColor:C.F},
          ],labels)}/>
          <Legend items={["P","I","D","F"].map(t=>({color:TCLR[t],label:t}))}/>
        </Panel>
      ))}
      <Panel title="Axis Error (Gyro − Setpoint)" badge="deg/s"
        info={{what:"The difference between measured gyro rate and commanded setpoint across all three axes. This is the raw error signal the PID loop is continuously trying to drive to zero.",trend:"Should oscillate symmetrically near zero. Sustained non-zero offset = I-gain too low. Growing oscillation = P too high or phase margin too low. Large transient spikes on stick inputs = D-gain too low."}}>
        <ChartBox id="sv-err" h={180} onMount={c=>timeLine(c,[0,1,2].map(i=>({
          label:AN[i], data:axArr("overview_axis_error",i), borderColor:AX[i],
        })),times())}/>
        <Legend items={[0,1,2].map(i=>({color:AX[i],label:AN[i]}))}/>
      </Panel>
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // NOISE
  // ════════════════════════════════════════════════════════════════════════
  function NoiseTab() {
    const labels = times();
    return <div className="sv-tab">
      <div className="sv-stats">
        {[0,1,2].map(i=>{
          const ax=["roll","pitch","yaw"][i];
          const raw=mf("noise",`raw_std_${ax}`); const adc=mf("noise",`std_${ax}`);
          const n=parseFloat(adc)||0;
          return <div key={i} className="sv-stat-card">
            <div className="sv-stat-label">{AN[i]} — RAW σ</div>
            <div className="sv-stat-value" style={{color:AX[i]}}>{raw}<span className="sv-stat-unit"> °/s</span></div>
            <div className="sv-stat-sub">Filtered σ = {adc}</div>
            <div style={{marginTop:8}}>
              <div style={{fontSize:10,color:C.text3,fontFamily:"JetBrains Mono,monospace",marginBottom:3}}>
                Noise residual: <span style={{color:noiseClr(n)}}>{adc} °/s</span>
              </div>
              <div className="sv-noise-bar"><div style={{width:`${Math.min(100,n*2)}%`,background:noiseClr(n)}} className="sv-noise-fill"/></div>
            </div>
          </div>;
        })}
      </div>
      {[0,1,2].map(i=>(
        <Panel key={i} title={`${AN[i]} — RAW vs Filtered`} badge="gyroRAW / gyroADC"
          info={{what:"Compares the raw gyro sensor output (red, before any filtering) against the filtered signal the PID loop actually sees (colored). The amplitude difference is what the filter chain removes.",trend:"At low frequencies (0–10 Hz, stick inputs), both lines should track closely — over-filtering here slows PID response. At high frequencies filtered should be much smoother. If filtered is still noisy near rotor RPM, RPM notch filters may be misconfigured or missing."}}>
          <ChartBox id={`sv-noise-${i}`} h={180} onMount={c=>timeLine(c,[
            {label:"RAW",     data:axArr("overview_gyro_raw",i),borderColor:"rgba(239,68,68,0.6)",borderWidth:1},
            {label:"Filtered",data:axArr("overview_gyro_adc",i),borderColor:AX[i],borderWidth:1.5},
          ],labels)}/>
          <Legend items={[{color:"rgba(239,68,68,0.7)",label:"RAW"},{color:AX[i],label:"Filtered"}]}/>
        </Panel>
      ))}
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // DYNAMICS
  // ════════════════════════════════════════════════════════════════════════
  function DynamicsTab() {
    const buildBode = useCallback(canvas=>{
      if(!canvas||!bodeData) return;
      kill("sv-bode");
      const labels = safeArr(bodeData.freqs||[]);
      const ds=[];
      [0,1,2].forEach(i=>{
        ds.push({label:`${AN[i]} OL`,data:safeArr(bodeData[`ol_mag_${i}`]||bodeData[`ol_mag_db_${i}`]||[]),borderColor:AX[i],borderWidth:2,pointRadius:0,tension:0.2,fill:false});
        ds.push({label:`${AN[i]} CL`,data:safeArr(bodeData[`cl_mag_${i}`]||[]),borderColor:AX[i],borderWidth:1,borderDash:[4,3],pointRadius:0,tension:0.2,fill:false});
      });
      ds.push({label:"0 dB", data:labels.map(()=>0),  borderColor:"rgba(255,255,255,0.15)",borderDash:[5,5],borderWidth:1,pointRadius:0,fill:false});
      ds.push({label:"-3 dB",data:labels.map(()=>-3), borderColor:"rgba(255,255,255,0.08)",borderDash:[2,4],borderWidth:1,pointRadius:0,fill:false});
      charts.current["sv-bode"] = new Chart(canvas.getContext("2d"),{
        type:"line", data:{labels,datasets:ds},
        options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},
          plugins:{legend:{display:false},tooltip:{backgroundColor:"rgba(10,12,16,0.95)",borderColor:C.border,borderWidth:1,
            titleFont:{family:"JetBrains Mono",size:10},bodyFont:{family:"JetBrains Mono",size:11},titleColor:C.text2,bodyColor:"#e2e8f0",
            callbacks:{title:i=>`f = ${parseFloat(i[0].label).toFixed(3)} Hz`,label:i=>` ${i.dataset.label}: ${Number(i.raw).toFixed(1)} dB`}}},
          scales:{
            x:{type:"logarithmic",grid:{color:C.border},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9},maxTicksLimit:8,callback:v=>Number(v)>=0.1?Number(v).toFixed(Number(v)<1?1:0):""},border:{color:C.border},title:{display:true,text:"Frequency (Hz)",color:C.text3,font:{family:"JetBrains Mono",size:9}}},
            y:{grid:{color:C.border},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9},callback:v=>`${v} dB`},border:{color:C.border},min:-40,max:42,title:{display:true,text:"Magnitude (dB)",color:C.text3,font:{family:"JetBrains Mono",size:9}}},
          }
        }
      });
    },[bodeData]);

    const buildStep = useCallback(canvas=>{
      if(!canvas) return;
      const labels = times();
      if(!labels.length) return;
      timeLine(canvas,[
        {label:"Setpoint",data:axArr("overview_setpoint",stepAxis),borderColor:"rgba(255,255,255,0.35)",borderDash:[4,3],borderWidth:1.5},
        {label:"Gyro",    data:axArr("overview_gyro_adc",stepAxis),borderColor:AX[stepAxis],borderWidth:1.5},
      ],labels);
    },[stepAxis,results]);

    return <div className="sv-tab">
      <div className="sv-dyn-grid">
        {[0,1,2].map(i=>{
          const ax  = ["roll","pitch","yaw"][i];
          const pm  = parseFloat(m("dynamics",`phase_margin_${ax}`)??0);
          const fBw = parseFloat(m("dynamics",`bandwidth_${ax}`)??0);
          const fGc = parseFloat(m("dynamics",`gain_crossover_${ax}`)??0);
          const fc  = parseFloat(m("dynamics",`fc_gyro_${ax}`)??0);
          const kp  = parseFloat(m("dynamics",`kp_eff_${ax}`)??0);
          const pImp= parseInt(m("dynamics",`p_gain_implied_${ax}`)??0);
          const pCfg= m("dynamics",`cfg_p_${ax}`);
          const lat = parseFloat(m("control_latency",`median_${ax}`)??0);
          const nSt = parseInt(m("control_latency",`n_steps_${ax}`)??0);
          const std = parseFloat(m("control_latency",`std_${ax}`)??0);
          const pmPct = Math.min(100,(pm/90)*100);
          return <div key={i} className="sv-dyn-card">
            <div className="sv-dyn-hdr">
              <div className="sv-dyn-dot" style={{background:AX[i]}}/>
              <div className="sv-dyn-name" style={{color:AX[i]}}>{AN[i]}</div>
              <div style={{marginLeft:"auto",fontFamily:"JetBrains Mono,monospace",fontSize:9,
                color:C.accent,background:"rgba(0,200,255,0.07)",padding:"2px 7px",borderRadius:4}}>
                Kp={kp.toFixed(3)}
              </div>
            </div>
            <div className="sv-dyn-metrics">
              <div className="sv-dyn-block">
                <div className="sv-dyn-lbl">Control Latency (50% rise)</div>
                <div className="sv-dyn-primary">
                  <div className="sv-dyn-val" style={{color: lat>0?latClr(lat):C.text3}}>
                    {lat>0?lat.toFixed(1):"—"}
                  </div>
                  <div className="sv-dyn-unit">ms</div>
                </div>
                <div className="sv-dyn-sub">
                  {lat>0 ? `±${std.toFixed(1)} ms · n=${nSt} steps` : "no step inputs detected"}
                </div>
              </div>
              <div className="sv-dyn-block">
                <div className="sv-dyn-lbl">Phase Margin</div>
                <div className="sv-dyn-primary">
                  <div className="sv-dyn-val" style={{color:pmClr(pm)}}>{pm?pm.toFixed(1):"—"}</div>
                  <div className="sv-dyn-unit">°</div>
                </div>
                <div className="sv-dyn-sub">{pm?pmLabel(pm):""} · f_gc = {fGc?fGc.toFixed(2):"—"} Hz</div>
                <div className="sv-pm-gauge">
                  <div className="sv-pm-track"><div className="sv-pm-fill" style={{width:`${pmPct}%`,background:pmClr(pm)}}/></div>
                  <div className="sv-pm-zones"><span>0°</span><span>45°</span><span>90°</span></div>
                </div>
              </div>
              <div className="sv-dyn-block">
                <div className="sv-dyn-lbl">Closed-Loop Bandwidth</div>
                <div className="sv-dyn-primary">
                  <div className="sv-dyn-val" style={{color:bwClr(fBw)}}>{fBw?fBw.toFixed(2):"—"}</div>
                  <div className="sv-dyn-unit">Hz</div>
                </div>
                <div className="sv-dyn-sub" style={{fontSize:9}}>
                  P_gain ≈ {pImp}{pCfg?` (cfg: ${pCfg})`:""} · τ_mech = {i<2?"50":"15"} ms · fc_gyro = {fc?fc.toFixed(0):"—"} Hz
                </div>
              </div>
            </div>
          </div>;
        })}
      </div>
      <Panel title="Open/Closed Loop Bode" badge="magnitude (dB)"
        info={{what:"Frequency response of the PID loop. Open-loop (OL, solid) shows gain before feedback closes. Closed-loop (CL, dashed) shows the actual output frequency response. Where OL gain crosses 0 dB is the gain crossover frequency — the measure of loop aggressiveness.",trend:"OL should cross 0 dB with sufficient phase margin (>45°, ideally >60°). CL should be flat near 0 dB up to the bandwidth frequency, then roll off cleanly. A CL peak or hump before roll-off means the loop is approaching instability — reduce P-gain."}}>
        <ChartBox id="sv-bode" h={260} onMount={buildBode}/>
        <Legend items={[0,1,2].map(i=>({color:AX[i],label:`${AN[i]} OL/CL`}))}/>
      </Panel>
      <Panel title="Step Response" badge="setpoint vs gyro"
        info={{what:"Shows how the helicopter responds to a fast stick step input. Rise time (how quickly gyro reaches setpoint), overshoot, and settling time reveal the balance between P, D, and F gains.",trend:"Gyro should rise quickly to meet setpoint (<30 ms for F3C), with less than 20% overshoot, and settle without further oscillation. Slow rise = increase P or F. Overshoot and ringing = P too high, or D too low. No response at all = very low gains or mechanical issue."}}
        ctrl={
        <select className="sv-sel" value={stepAxis} onChange={e=>setStepAxis(+e.target.value)}>
          {AN.map((n,i)=><option key={i} value={i}>{n}</option>)}
        </select>}>
        <ChartBox id="sv-step" h={200} onMount={buildStep}/>
      </Panel>
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // FFT
  // ════════════════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════════════════
  // FFT — with shaded RPM notch + LPF + dynamic notch bands
  // Matches Rotorflight Blackbox Explorer visual style
  // ════════════════════════════════════════════════════════════════════════

  const [fftShowFilters, setFftShowFilters] = useState(true);
  const [fftHighlight,   setFftHighlight]   = useState(null); // index of highlighted band

  // ── RPM notch frequency calculator ─────────────────────────────────────────
  // Source encoding (confirmed from RFAnalyzerTool.html):
  //   tens digit = group:    1x = main rotor / motor,  2x = tail rotor
  //   units digit = harmonic: 0 = motor fundamental,   N = N× rotor frequency
  //
  //   src=10 → Motor Hz     = headspeed × (main_gear_denom / main_gear_numer) / 60
  //   src=11 → MR Fund.     = headspeed / 60
  //   src=12 → MR 2nd       = 2 × headspeed / 60
  //   src=13 → MR 3rd       = 3 × headspeed / 60
  //   src=14 → MR 4th       = 4 × headspeed / 60
  //   src=21 → TR Fund.     = headspeed × (tail_numer / tail_denom) / 60
  //   src=22 → TR 2nd       = 2 × tail_hz
  //
  // Gear ratio stored as [numer, denom]:
  //   main_rotor_hz = headspeed / 60   (direct)
  //   motor_hz      = headspeed × denom / numer / 60
  //   tail_rotor_hz = headspeed × tail_numer / tail_denom / 60

  function rpmSourceHz(src, headspeedRpm, mainGear, tailGear) {
    if (!headspeedRpm || headspeedRpm < 100 || !src) return 0;
    const [mn, md] = mainGear || [1, 1];
    const [tn, td] = tailGear || [1, 1];
    const group    = Math.floor(src / 10);
    const harmonic = src % 10;

    if (group === 1) {
      if (harmonic === 0) {
        // Motor fundamental: headspeed × (denom/numer) / 60
        const motorHz = (md > 0 && mn > 0) ? headspeedRpm * (md / mn) / 60 : headspeedRpm * 7 / 60;
        return motorHz;
      } else {
        // Main rotor harmonic: harmonic × headspeed / 60
        return harmonic * headspeedRpm / 60;
      }
    } else if (group === 2) {
      // Tail rotor harmonic: uses denom/numer like motor (confirmed at 1750RPM = 149.9Hz)
      const tailHz = (tn > 0 && td > 0) ? headspeedRpm * (td / tn) / 60 : headspeedRpm * 5.14 / 60;
      return harmonic * tailHz;
    }
    return 0;
  }

  function rpmSourceLabel(src) {
    const group    = Math.floor(src / 10);
    const harmonic = src % 10;
    const ordinals = ["", "Fund.", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
    if (group === 1) {
      if (harmonic === 0) return "Motor";
      return `MR ${ordinals[harmonic] || harmonic + "×"}`;
    } else if (group === 2) {
      return `TR ${ordinals[harmonic] || harmonic + "×"}`;
    }
    return `Src${src}`;
  }

  // Build all filter band descriptors from configData + current headspeed
  function buildAllFilterBands(axisIdx) {
    const bands = [];
    if (!configData?.found) return bands;

    const flt      = configData.filters || {};
    const mainGear = configData.main_gear_ratio || [1, 1];
    const tailGear = configData.tail_gear_ratio || [1, 1];
    const avgHs    = parseFloat(m("governor", "headspeed_mean") ?? 0);
    const axKey    = ["roll", "pitch", "yaw"][axisIdx];
    const rpmMin   = flt.rpm_notch_min_hz || 20;

    // ── LPF1 ─────────────────────────────────────────────────────────────
    if (flt.lpf1_hz > 0) {
      bands.push({
        id: "lpf1",
        label: `LPF1 · ${flt.lpf1_type || "PT1"} · ${flt.lpf1_hz} Hz`,
        style: "lpf", hz: flt.lpf1_hz,
        color: "rgba(0,212,255,1)", fill: "rgba(0,212,255,0.07)",
      });
    }

    // ── LPF2 ─────────────────────────────────────────────────────────────
    if (flt.lpf2_hz > 0 && flt.lpf2_type && flt.lpf2_type !== "NONE") {
      bands.push({
        id: "lpf2",
        label: `LPF2 · ${flt.lpf2_type} · ${flt.lpf2_hz} Hz`,
        style: "lpf", hz: flt.lpf2_hz,
        color: "rgba(100,180,255,0.9)", fill: "rgba(100,180,255,0.05)",
      });
    }

    // ── Per-axis gyro cutoff from matched PID profile ─────────────────────
    if (avgHs > 0 && configData.pid_profiles?.length) {
      let best = null, bestD = Infinity;
      for (const p of configData.pid_profiles) {
        if (!p.target_rpm) continue;
        const d = Math.abs(p.target_rpm - avgHs);
        if (d < bestD) { bestD = d; best = p; }
      }
      const cutoff = best?.[`${axKey}_gyro_cutoff`];
      if (cutoff > 0) {
        bands.push({
          id: "gyro_fc",
          label: `${AN[axisIdx]} gyro fc · P${best.profile_index} · ${cutoff} Hz`,
          style: "lpf", hz: cutoff, dashed: true,
          color: "rgba(0,212,255,0.85)", fill: "rgba(0,212,255,0.06)",
        });
      }
    }

    // ── Dynamic notch range ───────────────────────────────────────────────
    if (flt.dyn_notch_min_hz > 0 && flt.dyn_notch_max_hz > flt.dyn_notch_min_hz) {
      const q = flt.dyn_notch_q ? (flt.dyn_notch_q / 10).toFixed(1) : "—";
      bands.push({
        id: "dyn_notch",
        label: `Dynamic Notch · ×${flt.dyn_notch_count || 1} · Q${q}`,
        style: "range",
        x0: flt.dyn_notch_min_hz, x1: flt.dyn_notch_max_hz,
        color: "rgba(245,158,11,0.8)", fill: "rgba(245,158,11,0.12)",
      });
    }

    // ── RPM notch filters ─────────────────────────────────────────────────
    // Key names: rpm_source_roll/pitch/yaw (from gyro_rpm_notch_source_* in dump)
    const srcRaw = flt[`rpm_source_${axKey}`] || "";
    const qRaw   = flt[`rpm_q_${axKey}`]      || "";
    const ctrRaw = flt[`rpm_center_${axKey}`]  || "";

    // Show RPM bands if: sources are defined OR rpm_filter_enabled flag is set
    // (some configs set sources without the harmonics count flag)
    const hasRpmSources = srcRaw.replace(/[0, ]/g, "").length > 0;
    if ((hasRpmSources || flt.rpm_filter_enabled) && avgHs > 100) {
      const srcArr = srcRaw.split(",").map(Number).filter(v => v > 0);
      const qArr   = qRaw.split(",").map(Number);
      const ctrArr = ctrRaw.split(",").map(Number);

      // Colors cycle through purple shades for different sources
      const notchColors = {
        "MR": ["rgba(167,139,250,0.9)", "rgba(196,100,255,0.9)", "rgba(140,110,255,0.9)", "rgba(180,120,255,0.9)"],
        "TR": ["rgba(251,191,36,0.9)",  "rgba(245,200,80,0.9)"],
        "Motor": ["rgba(251,191,36,0.9)"],
      };

      srcArr.forEach((src, i) => {
        const baseHz = rpmSourceHz(src, avgHs, mainGear, tailGear);
        if (baseHz < 1) return;

        const centerOffset = (ctrArr[i] || 0) * 0.1;  // 0.1 Hz per unit
        const centerHz     = baseHz + centerOffset;
        if (centerHz < rpmMin || centerHz > 500) return;

        // Q stored as Q×10 in firmware (e.g. 70 = Q 7.0)
        const qVal   = (qArr[i] || 50) / 10;
        const halfBW = centerHz / (2 * qVal);

        const lbl  = rpmSourceLabel(src);
        const group = lbl.startsWith("MR") ? "MR" : lbl.startsWith("TR") ? "TR" : "Motor";
        // Pick color based on source group and harmonic index within that group
        const groupSrcs = srcArr.slice(0, i + 1).filter(s => rpmSourceLabel(s).startsWith(group));
        const colorIdx  = (groupSrcs.length - 1) % (notchColors[group]?.length || 1);
        const color     = (notchColors[group] || notchColors["MR"])[colorIdx];

        const ctrStr = centerOffset !== 0
          ? ` (${centerOffset > 0 ? "+" : ""}${centerOffset.toFixed(1)}Hz)` : "";
        const label = `${lbl}${ctrStr} · ${centerHz.toFixed(1)} Hz · Q${qVal.toFixed(1)}`;

        bands.push({
          id:     `rpm_${src}_${i}`,
          label,
          style:  "notch",
          x0:     centerHz - halfBW,
          x1:     centerHz + halfBW,
          center: centerHz,
          q:      qVal,
          color,
          fill:   color.replace("0.9", "0.18"),
        });
      });
    } else if (avgHs > 100 && flt.rpm_filter_enabled) {
      // No per-axis sources configured — show estimated motor harmonic from gear ratio
      const [mn, md] = mainGear;
      const motorHz = (mn > 0 && md > 0) ? avgHs * (md / mn) / 60 : avgHs * 7 / 60;
      if (motorHz > rpmMin && motorHz < 495) {
        const q = 9.0;
        bands.push({
          id: "motor_est",
          label: `Motor · ${motorHz.toFixed(1)} Hz · Q${q.toFixed(1)} (est)`,
          style: "notch",
          x0: motorHz - motorHz / (2 * q),
          x1: motorHz + motorHz / (2 * q),
          center: motorHz, q,
          color: "rgba(251,191,36,0.85)",
          fill:  "rgba(251,191,36,0.16)",
        });
      }
    }

    return bands;
  }

  // ── Chart.js plugin: draws bands BEFORE data lines ──────────────────────
  function makeFilterPlugin(bands, maxHz, highlightIdx, showFilters) {
    return {
      id: "rfFilterBands",
      beforeDatasetsDraw(chart) {
        if (!showFilters || !bands.length) return;
        const {ctx, chartArea:{left,right,top,bottom}, scales:{x,y}} = chart;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();

        bands.forEach((band, bi) => {
          const isHL = highlightIdx === null || highlightIdx === bi;
          const alpha = isHL ? 1.0 : 0.2;

          if (band.style === "lpf" || band.style === "lpf_dashed") {
            const xp = x.getPixelForValue(band.hz);
            if (xp < left || xp > right) return;
            // Fade fill from cutoff to right
            const grad = ctx.createLinearGradient(xp, 0, right, 0);
            const fillRgba = band.fill.replace(/[\d.]+\)$/, `${0.15 * alpha})`);
            grad.addColorStop(0, fillRgba);
            grad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(xp, top, right - xp, bottom - top);
            // Vertical cutoff line
            ctx.strokeStyle = band.color.replace(/[\d.]+\)$/, `${alpha})`);
            ctx.lineWidth = 1.5;
            ctx.setLineDash(band.dashed ? [6,3] : [4,2]);
            ctx.globalAlpha = alpha;
            ctx.beginPath(); ctx.moveTo(xp, top); ctx.lineTo(xp, bottom); ctx.stroke();
            ctx.setLineDash([]); ctx.globalAlpha = 1;

          } else if (band.style === "range") {
            const xL = x.getPixelForValue(Math.max(0, band.x0));
            const xR = x.getPixelForValue(Math.min(maxHz, band.x1));
            if (xR <= xL) return;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = band.fill;
            ctx.fillRect(xL, top, xR - xL, bottom - top);
            ctx.strokeStyle = band.color;
            ctx.lineWidth = 1;
            ctx.setLineDash([4,3]);
            ctx.beginPath(); ctx.moveTo(xL,top); ctx.lineTo(xL,bottom); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(xR,top); ctx.lineTo(xR,bottom); ctx.stroke();
            ctx.setLineDash([]); ctx.globalAlpha = 1;

          } else if (band.style === "notch") {
            const xL = x.getPixelForValue(Math.max(0, band.x0));
            const xR = x.getPixelForValue(Math.min(maxHz, band.x1));
            const xC = x.getPixelForValue(band.center);
            if (xC < left || xC > right) return;
            ctx.globalAlpha = alpha;
            // Filled band
            ctx.fillStyle = band.fill;
            ctx.fillRect(Math.max(left,xL), top, Math.min(right,xR) - Math.max(left,xL), bottom - top);
            // Center line
            ctx.strokeStyle = band.color;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(xC, top); ctx.lineTo(xC, bottom); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        });
        ctx.restore();
      },

      // Draw vertical labels inside each band
      afterDatasetsDraw(chart) {
        if (!showFilters || !bands.length) return;
        const {ctx, chartArea:{left,right,top}, scales:{x}} = chart;
        ctx.save();
        ctx.font = "bold 9px 'JetBrains Mono', monospace";
        ctx.textBaseline = "top";

        const usedX = [];
        bands.forEach((band, bi) => {
          const isHL = highlightIdx === null || highlightIdx === bi;
          if (!isHL) return;

          let xPos;
          if (band.style === "lpf") xPos = x.getPixelForValue(band.hz) + 3;
          else if (band.style === "range") xPos = x.getPixelForValue((band.x0 + band.x1) / 2) - 3;
          else if (band.style === "notch") xPos = x.getPixelForValue(band.center) + 3;
          else return;

          if (xPos < left || xPos > right - 5) return;
          if (usedX.some(u => Math.abs(u - xPos) < 30)) return;
          usedX.push(xPos);

          ctx.fillStyle = band.color;
          ctx.save();
          ctx.translate(xPos, top + 4);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(band.label, 0, 0);
          ctx.restore();
        });
        ctx.restore();
      }
    };
  }

  function FFTTab() {
    const axColor  = AX[fftAxis];
    const allBands = buildAllFilterBands(fftAxis);

    const buildFFT = useCallback(canvas => {
      if (!canvas || !fftData) return;
      kill("sv-fft");
      const freqs  = safeArr(fftData.freqs || []);
      const psdRaw = safeArr(fftData[`psd_raw_${["roll","pitch","yaw"][fftAxis]}`] || []);
      const psdAdc = safeArr(fftData[`psd_adc_${["roll","pitch","yaw"][fftAxis]}`] || []);
      const maxHz  = fftData.max_hz ?? 500;
      const yMin   = fftLog ? -80 : 0;
      const tx     = v => fftLog ? (v > 1e-9 ? 20 * Math.log10(v) : -80) : v;
      const rawPts = freqs.map((f,k) => ({x:f, y:tx(psdRaw[k]??0)})).filter(p => p.x <= maxHz);
      const adcPts = freqs.map((f,k) => ({x:f, y:tx(psdAdc[k]??0)})).filter(p => p.x <= maxHz);
      const curBands = buildAllFilterBands(fftAxis);

      charts.current["sv-fft"] = new Chart(canvas.getContext("2d"), {
        type: "scatter",
        data: { datasets: [
          { label:"RAW gyro",       data:rawPts, borderColor:"rgba(239,68,68,0.65)",  borderWidth:1,   pointRadius:0, showLine:true, tension:0.1, fill:false },
          { label:"Filtered (ADC)", data:adcPts, borderColor:axColor,                 borderWidth:1.5, pointRadius:0, showLine:true, tension:0.1, fill:false },
        ]},
        options: {
          responsive:true, maintainAspectRatio:false, animation:{duration:0},
          plugins: {
            legend: {display:false},
            tooltip: {
              backgroundColor:"rgba(10,12,16,0.95)", borderColor:C.border, borderWidth:1,
              titleFont:{family:"JetBrains Mono",size:10}, bodyFont:{family:"JetBrains Mono",size:11},
              titleColor:C.text2, bodyColor:"#e2e8f0",
              callbacks: {
                title: i => `${Number(i[0].raw.x).toFixed(1)} Hz`,
                label: i => ` ${i.dataset.label}: ${Number(i.raw.y).toFixed(1)} ${fftLog?"dB":"°/s/√Hz"}`,
              }
            },
          },
          scales: {
            x: { type:"linear", min:0, max:maxHz, grid:{color:C.border}, border:{color:C.border},
                 ticks:{color:C.text3, font:{family:"JetBrains Mono",size:9}, maxTicksLimit:20},
                 title:{display:true, text:"Frequency (Hz)", color:C.text3, font:{family:"JetBrains Mono",size:9}} },
            y: { grid:{color:C.border}, border:{color:C.border}, min:yMin,
                 ticks:{color:C.text3, font:{family:"JetBrains Mono",size:9}},
                 title:{display:true, text:fftLog?"dB (rel)":"°/s/√Hz", color:C.text3, font:{family:"JetBrains Mono",size:9}} },
          }
        },
        plugins: [makeFilterPlugin(curBands, maxHz, fftHighlight, fftShowFilters)],
      });
    }, [fftAxis, fftLog, fftData, configData, fftShowFilters, fftHighlight]);

    const buildAtten = useCallback(canvas => {
      if (!canvas || !fftData) return;
      kill("sv-atten");
      const ax     = ["roll","pitch","yaw"][fftAxis];
      const freqs  = safeArr(fftData.freqs || []);
      const psdRaw = safeArr(fftData[`psd_raw_${ax}`] || []);
      const psdAdc = safeArr(fftData[`psd_adc_${ax}`] || []);
      const maxHz  = fftData.max_hz ?? 500;
      const pts    = freqs.map((f,k) => {
        const r = psdRaw[k] ?? 0;
        return {x:f, y: r > 0.01 ? 20*Math.log10(Math.max(1e-9, psdAdc[k]??0) / r) : null};
      }).filter(p => p.x > 0 && p.x <= maxHz && p.y !== null);
      const curBands = buildAllFilterBands(fftAxis);

      charts.current["sv-atten"] = new Chart(canvas.getContext("2d"), {
        type: "scatter",
        data: { datasets: [
          { label:"Attenuation", data:pts, borderColor:axColor, borderWidth:1.5, pointRadius:0, showLine:true, tension:0.2, fill:true, backgroundColor:axColor+"18" },
          { label:"0 dB ref", data:[{x:0,y:0},{x:maxHz,y:0}], borderColor:"rgba(255,255,255,0.15)", borderDash:[4,3], borderWidth:1, pointRadius:0, showLine:true, fill:false },
        ]},
        options: {
          responsive:true, maintainAspectRatio:false, animation:{duration:0},
          plugins: { legend:{display:false} },
          scales: {
            x: { type:"linear", min:0, max:maxHz, grid:{color:C.border}, border:{color:C.border},
                 ticks:{color:C.text3, font:{family:"JetBrains Mono",size:9}, maxTicksLimit:20},
                 title:{display:true, text:"Frequency (Hz)", color:C.text3, font:{family:"JetBrains Mono",size:9}} },
            y: { grid:{color:C.border}, border:{color:C.border}, max:6,
                 ticks:{color:C.text3, font:{family:"JetBrains Mono",size:9}, callback:v=>`${v}dB`},
                 title:{display:true, text:"Attenuation (dB)", color:C.text3, font:{family:"JetBrains Mono",size:9}} },
          }
        },
        plugins: [makeFilterPlugin(curBands, maxHz, fftHighlight, fftShowFilters)],
      });
    }, [fftAxis, fftData, configData, fftShowFilters, fftHighlight]);

    // ── Per-axis FFT stats ──────────────────────────────────────────────────
    const axisStats = [0,1,2].map(i => {
      const ax = ["roll","pitch","yaw"][i];
      return {
        rmsRaw: mf("fft", `rms_raw_${ax}`),
        rmsAdc: mf("fft", `rms_adc_${ax}`),
        atten:  mf("fft", `attenuation_db_${ax}`),
      };
    });

    return <div className="sv-tab">
      <Panel
        title="Gyro FFT Spectrum"
        badge={fftData ? `Welch · ${fftData.nfft??1024}-pt Hann · ${fftData.frames??0} frames · Δf=${((fftData.fs??1000)/(fftData.nfft??1024)).toFixed(2)} Hz · fs=${(fftData.fs??0).toFixed(0)} Hz` : "no data"}
        ctrl={
          <div className="sv-ctrl-row">
            <select className="sv-sel" value={fftAxis} onChange={e=>{ setFftAxis(+e.target.value); setFftHighlight(null); }}>
              {AN.map((n,i)=><option key={i} value={i}>{n}</option>)}
            </select>
            <button className={`sv-btn ${fftLog?"active":""}`} onClick={()=>setFftLog(v=>!v)}>
              Log Y
            </button>
            <button className={`sv-btn ${fftShowFilters?"active":""}`} onClick={()=>{ setFftShowFilters(v=>!v); setFftHighlight(null); }}>
              Filters
            </button>
          </div>
        }>

        {/* Signal legend */}
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:8,flexWrap:"wrap"}}>
          <div className="sv-legend-item"><div className="sv-legend-dot" style={{background:"rgba(239,68,68,0.7)"}}/>RAW gyro</div>
          <div className="sv-legend-item"><div className="sv-legend-dot" style={{background:axColor}}/>Filtered (ADC)</div>
          {allBands.length > 0 && fftShowFilters && (
            <span style={{fontSize:10,color:C.text3,fontFamily:"JetBrains Mono,monospace"}}>
              {allBands.length} filters overlaid
            </span>
          )}
          {!configData?.found && (
            <span style={{fontSize:10,color:C.text3,fontFamily:"JetBrains Mono,monospace",fontStyle:"italic"}}>
              · upload config dump to show filter bands
            </span>
          )}
        </div>

        <ChartBox id="sv-fft" h={310} onMount={buildFFT}/>

        {/* Filter badge pills — click to highlight/unhighlight */}
        {fftShowFilters && allBands.length > 0 && (
          <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:5}}>
            {allBands.map((band, bi) => {
              const isHL = fftHighlight === null || fftHighlight === bi;
              const isDimmed = fftHighlight !== null && fftHighlight !== bi;
              return (
                <button key={band.id}
                  onClick={() => setFftHighlight(fftHighlight === bi ? null : bi)}
                  style={{
                    display:"inline-flex", alignItems:"center", gap:6,
                    padding:"3px 10px", borderRadius:4, cursor:"pointer",
                    fontFamily:"JetBrains Mono,monospace", fontSize:10,
                    border:`1px solid ${band.color.replace("0.9","0.4").replace("0.85","0.4").replace("0.8","0.4")}`,
                    background: isHL ? band.color.replace(/[\d.]+\)$/,"0.10)") : "rgba(0,0,0,0)",
                    color: isDimmed ? C.text3 : "#e2e8f0",
                    opacity: isDimmed ? 0.35 : 1,
                    transition:"all 0.15s",
                  }}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:band.color,flexShrink:0}}/>
                  {band.label}
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Per-axis stats */}
      <div className="sv-axis-grid">
        {axisStats.map((s,i)=>(
          <div key={i} className="sv-axis-card">
            <div className="sv-axis-hdr">
              <div className="sv-axis-dot" style={{background:AX[i]}}/>
              <div className="sv-axis-name" style={{color:AX[i]}}>{AN[i]}</div>
            </div>
            <AM label="RAW noise RMS" value={`${s.rmsRaw} °/s`} color="rgba(239,68,68,0.9)"/>
            <AM label="Filtered RMS"  value={`${s.rmsAdc} °/s`} color={AX[i]}/>
            <AM label="Attenuation"   value={`${s.atten} dB`}
              color={parseFloat(s.atten)<-15?C.green:parseFloat(s.atten)<-6?C.orange:C.red}/>
          </div>
        ))}
      </div>

      <Panel title="Filter Attenuation vs Frequency" badge="RAW/ADC ratio — measured from log"
        info={{what:"Measured ratio of the raw to filtered gyro signal across frequency bands, derived from the actual flight log. Shows how much noise reduction the filter chain achieves at each frequency. Near 0 dB = filter is fully transparent. More negative dB = more attenuation.",trend:"Should be near 0 dB in the control band (0–20 Hz) — filters must not attenuate actual control signals. Should show strong attenuation (≤−15 dB) at rotor harmonics (1P, 2P, motor electrical). Deep notches at specific frequencies confirm RPM filters are active at the correct positions."}}>
        <ChartBox id="sv-atten" h={200} onMount={buildAtten}/>
      </Panel>
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // GOVERNOR
  // ════════════════════════════════════════════════════════════════════════
  function GovernorTab() {
    const buildHS = useCallback(canvas=>{
      if(!canvas) return;
      const labels = times();
      if(!labels.length) return;
      timeLine(canvas,[
        {label:"Headspeed",data:axArr("overview_headspeed",0),borderColor:C.accent,borderWidth:2},
        {label:"Target",   data:axArr("overview_gov_target",0),borderColor:"rgba(255,255,255,0.3)",borderDash:[4,3]},
      ],labels);
    },[results]);

    const hsMean  = mf("governor","headspeed_mean",0);
    const hsStd   = mf("governor","headspeed_std",1);
    const hsSag   = mf("governor","headspeed_sag",1);
    const hsDroop = mf("governor","headspeed_droop",1);

    return <div className="sv-tab">
      <div className="sv-stats" style={{gridTemplateColumns:"repeat(4,1fr)"}}>
        <SC label="Avg Headspeed" value={hsMean} unit=" RPM" color={C.accent}/>
        <SC label="HS Stability" value={`±${hsStd}`} unit=" RPM"
          sub={parseFloat(hsStd)<5?"🟢 solid":parseFloat(hsStd)<15?"🟡 acceptable":"🔴 issue"}
          color={parseFloat(hsStd)<5?C.green:parseFloat(hsStd)<15?C.orange:C.red}/>
        <SC label="HS Sag"   value={hsSag}   unit=" RPM" color={C.orange}/>
        <SC label="HS Droop" value={hsDroop} unit=" RPM" color={C.orange}/>
      </div>
      <Panel title="Headspeed Over Time" badge="RPM"
        info={{what:"Main rotor headspeed in RPM throughout the segment, compared against the governor's target RPM. Shows how effectively the governor maintains constant headspeed under varying collective load.",trend:"Should be a flat line at target RPM with minimal variation. Sag during collective pulls = governor P-gain too low or ESC throttle limit reached. Oscillation above/below target = governor P or I too high. Gradual drift = governor I-gain too low."}}>
        <ChartBox id="sv-hs" h={220} onMount={buildHS}/>
        <Legend items={[{color:C.accent,label:"Headspeed"},{color:"rgba(255,255,255,0.3)",label:"Target"}]}/>
      </Panel>
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PIDF BALANCE
  // ════════════════════════════════════════════════════════════════════════
  function BalanceTab() {
    const labels = times();
    const buildBal = useCallback(canvas=>{
      if(!canvas||!labels.length) return;
      kill("sv-bal");
      const terms=["P","I","D","F"];
      const ds=terms.map(t=>({
        label:t, data:axArr(`overview_pid_${t.toLowerCase()}`,balAxis).map(Math.abs),
        borderColor:TCLR[t], backgroundColor:TCLR[t]+(balMode==="lines"?"18":"44"),
        borderWidth:1.5, pointRadius:0, tension:0.2,
        fill:balMode!=="lines"?"stack":false,
      }));
      charts.current["sv-bal"] = new Chart(canvas.getContext("2d"),{
        type:"line", data:{labels,datasets:ds},
        options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},
          plugins:{legend:{display:false},tooltip:{mode:"index",intersect:false,backgroundColor:"rgba(10,12,16,0.95)",borderColor:C.border,borderWidth:1,
            titleFont:{family:"JetBrains Mono",size:10},bodyFont:{family:"JetBrains Mono",size:11},titleColor:C.text2,bodyColor:"#e2e8f0",
            callbacks:{title:i=>`t = ${i[0].label}s`,label:i=>` ${i.dataset.label}: ${Number(i.raw).toFixed(0)}`}}},
          scales:{
            x:{stacked:balMode!=="lines",grid:{color:C.border},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9},maxTicksLimit:12},border:{color:C.border}},
            y:{stacked:balMode!=="lines",grid:{color:C.border},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9}},border:{color:C.border}},
          }
        }
      });
    },[balAxis,balMode,results]);

    // Per-axis balance stats
    const axStats = [0,1,2].map(i=>{
      const terms=["P","I","D","F"];
      const means=terms.map(t=>{ const d=axArr(`overview_pid_${t.toLowerCase()}`,i).map(Math.abs); return d.length?d.reduce((a,b)=>a+b,0)/d.length:0; });
      const total=means.reduce((a,b)=>a+b,0)||1;
      return {means,pcts:means.map(v=>v/total*100)};
    });

    return <div className="sv-tab">
      <Panel title="PIDF Term Contribution Over Time" badge="stacked |term| area"
        info={{what:"Shows the absolute magnitude of P, I, D, and F terms stacked over time. Stacked view shows total PID output; Pct view shows each term's share of the total. Reveals which terms are working hardest and whether any term is dominating unexpectedly.",trend:"For F3C: F-term should contribute ~30–50% (setpoint feedforward carries most of the load), P ~30–40%, D ~10–20%, I <10%. If I is large, the loop is fighting a persistent bias. If D is dominant and spiky, dterm_cutoff is too high or D-gain is excessive."}}
        ctrl={
        <div className="sv-ctrl-row">
          <select className="sv-sel" value={balAxis} onChange={e=>setBalAxis(+e.target.value)}>
            {AN.map((n,i)=><option key={i} value={i}>{n}</option>)}
          </select>
          {["stacked","lines","pct"].map(mode=>(
            <button key={mode} className={`sv-btn ${balMode===mode?"active":""}`} onClick={()=>setBalMode(mode)}>
              {mode[0].toUpperCase()+mode.slice(1)}
            </button>
          ))}
        </div>}>
        <ChartBox id="sv-bal" h={280} onMount={buildBal}/>
        <Legend items={["P","I","D","F"].map(t=>({color:TCLR[t],label:t}))}/>
      </Panel>
      <div className="sv-axis-grid">
        {[0,1,2].map(i=>{
          const {means,pcts}=axStats[i];
          const terms=["P","I","D","F"];
          return <div key={i} className="sv-axis-card">
            <div className="sv-axis-hdr">
              <div className="sv-axis-dot" style={{background:AX[i],borderRadius:2}}/>
              <div className="sv-axis-name" style={{color:AX[i]}}>{AN[i]}</div>
              <div style={{marginLeft:"auto",fontSize:9,color:C.text3,fontFamily:"JetBrains Mono,monospace"}}>mean · RF units</div>
            </div>
            {terms.map((t,ti)=>(
              <div key={t} className="sv-bal-row">
                <div className="sv-bal-lbl" style={{color:TCLR[t]}}>{t}</div>
                <div className="sv-bal-track"><div className="sv-bal-fill" style={{width:`${Math.min(100,pcts[ti]).toFixed(1)}%`,background:TCLR[t]+"80",borderRight:`2px solid ${TCLR[t]}`}}/></div>
                <div className="sv-bal-pct">{pcts[ti].toFixed(1)}%</div>
                <div className="sv-bal-mean">{means[ti].toFixed(0)}</div>
              </div>
            ))}
          </div>;
        })}
      </div>
      <BalRecs axStats={axStats}/>
    </div>;
  }

  function BalRecs({axStats}) {
    const recs=[];
    axStats.forEach(({pcts},i)=>{
      const [pP,,pD,pF]=pcts;
      if(i<2&&pF<10&&pP>35) recs.push({type:"warn",icon:"⚠️",title:`${AN[i]}: FF-starved`,detail:`FF is ${pF.toFixed(1)}% while P carries ${pP.toFixed(1)}%.`,action:`Raise ${["roll","pitch","yaw"][i]}_F toward 120–150.`});
      if(pcts[1]>40) recs.push({type:"warn",icon:"⚠️",title:`${AN[i]}: I-term heavy (${pcts[1].toFixed(1)}%)`,detail:"Possible I-windup.",action:`Reduce ${["roll","pitch","yaw"][i]}_I by 10–15%.`});
      if(pD>35) recs.push({type:"warn",icon:"⚠️",title:`${AN[i]}: D-term dominant (${pD.toFixed(1)}%)`,detail:"High D increases noise sensitivity.",action:"Verify D-cutoff filter is set appropriately."});
    });
    if(!recs.length) recs.push({type:"good",icon:"✅",title:"PIDF Balance looks reasonable",detail:"No obvious term imbalances detected."});
    return <div className="sv-findings">{recs.map((r,i)=><FindCard key={i} {...r}/>)}</div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ADVISOR
  // ════════════════════════════════════════════════════════════════════════
  function AdvisorTab() {
    const ax    = ["roll","pitch","yaw"][whatifAxis];
    const pm    = parseFloat(m("dynamics",`phase_margin_${ax}`)??60);
    const fBw   = parseFloat(m("dynamics",`bandwidth_${ax}`)??5);
    const fc    = parseFloat(m("dynamics",`fc_gyro_${ax}`)??65);
    const latBase = parseFloat(m("control_latency",`median_${ax}`)??0)||0;
    const Kp_new  = ((mults.P||1)*1.0);
    const fc_new  = fc*(mults.fc||1);
    const pmProj  = Math.max(0,Math.min(180, pm*(2-mults.P*0.5)*(2-Math.max(0.5,mults.fc)*0.3)));
    const latProj = latBase + (1000/(2*Math.PI*fc_new) - 1000/(2*Math.PI*fc));
    const bwProj  = fBw*(mults.P||1)*0.9;

    const whatifRecs=[];
    if(pmProj<45) whatifRecs.push({type:"crit",icon:"🔴",title:`Unsafe phase margin (${pmProj.toFixed(1)}°)`,detail:"PM below 45° risks oscillation.",action:"Reduce P multiplier."});
    else if(pmProj>65) whatifRecs.push({type:"good",icon:"✅",title:`Healthy phase margin (${pmProj.toFixed(1)}°)`,detail:`CL bandwidth: ${bwProj.toFixed(2)} Hz`,action:`f_gc projected stable.`});
    if(latProj>60) whatifRecs.push({type:"warn",icon:"⚠️",title:`High estimated latency (${latProj.toFixed(1)} ms)`,detail:"fc reduction increases filter group delay.",action:"Raise fc toward ×1.0."});

    const dSpan=(base,proj,higher)=>{
      const diff=proj-base; const cls=(higher?diff>0:diff<0)?"delta-pos":Math.abs(diff)<0.05?"delta-neu":"delta-neg";
      return <span className={`sv-delta ${cls}`}>{diff>0?"+":""}{diff.toFixed(1)}</span>;
    };

    // ── Build filter chain rows from config dump (falls back to analysis estimates) ──
    const flt      = configData?.filters || {};
    const hasConfig = configData?.found;

    // LPF1 — group delay scales with filter order: PT2/BIQUAD = 2× PT1
    const lpf1Hz    = flt.lpf1_hz  || fc;
    const lpf1Type  = flt.lpf1_type || "PT1";
    const lpf1Order = /PT2|BIQUAD|BUTTER/i.test(lpf1Type) ? 2 : /NONE/i.test(lpf1Type) ? 0 : 1;
    const lpf1DelayN = lpf1Order > 0 ? lpf1Order * 1000 / (2 * Math.PI * lpf1Hz) : 0;
    const lpf1Delay  = lpf1DelayN.toFixed(2);
    const lpf1Src    = hasConfig ? `${lpf1Type} @ ${lpf1Hz} Hz` : `est. ${lpf1Hz} Hz from analysis`;

    // LPF2
    const lpf2Hz      = flt.lpf2_hz || 0;
    const lpf2Type    = flt.lpf2_type || "PT1";
    const lpf2Enabled = lpf2Hz > 0;
    const lpf2Order   = /PT2|BIQUAD|BUTTER/i.test(lpf2Type) ? 2 : 1;
    const lpf2DelayN  = lpf2Enabled ? lpf2Order * 1000 / (2 * Math.PI * lpf2Hz) : 0;
    const lpf2Delay   = lpf2Enabled ? lpf2DelayN.toFixed(2) : null;

    // Dynamic Notch
    const dynCount   = flt.dyn_notch_count ?? null;
    const dynEnabled = dynCount === null ? true : dynCount > 0;
    const dynCountVal = dynCount ?? 1;
    const dynQ       = flt.dyn_notch_q;
    const dynMin     = flt.dyn_notch_min_hz;
    const dynMax     = flt.dyn_notch_max_hz;
    const dynDetail  = hasConfig
      ? (dynEnabled
          ? `×${dynCountVal} notches · Q=${dynQ ?? "—"} · ${dynMin ?? "—"}–${dynMax ?? "—"} Hz`
          : "dyn_notch_count = 0")
      : "Tracks variable resonances — ~1–2 ms group delay each";
    const dynDelay = dynEnabled ? (dynCountVal * 1.5).toFixed(2) : null;

    // RPM filters — per-source breakdown for the selected axis
    const rpmEnabled = flt.rpm_filter_enabled ?? false;
    const rpmMin     = flt.rpm_notch_min_hz || 0;
    const _advAxKey  = ["roll","pitch","yaw"][advAxis];
    const _hs        = parseFloat(m("governor","headspeed_mean") ?? 0) || 0;
    const _mainGear  = configData?.main_gear_ratio || [1,1];
    const _tailGear  = configData?.tail_gear_ratio || [1,1];

    const _harmNames = ["","Fundamental","2nd Harmonic","3rd Harmonic","4th Harmonic","5th Harmonic","6th Harmonic","7th Harmonic","8th Harmonic"];
    function _rpmNotchName(src) {
      const group = Math.floor(src / 10), h = src % 10;
      if (group === 1 && h === 0) return "Motor (electrical)";
      if (group === 1) return `Main Rotor · ${_harmNames[h] || h+"×"}`;
      if (group === 2) return `Tail Rotor · ${_harmNames[h] || h+"×"}`;
      return `Source ${src}`;
    }

    const rpmNotchRows = [];
    if (rpmEnabled && hasConfig) {
      const srcArr = (flt[`rpm_source_${_advAxKey}`] || "").split(",").map(Number).filter(v => v > 0);
      const qArr   = (flt[`rpm_q_${_advAxKey}`]      || "").split(",").map(Number);
      srcArr.forEach((src, i) => {
        const qVal    = (qArr[i] || 50) / 10;
        const freqHz  = _hs > 0 ? rpmSourceHz(src, _hs, _mainGear, _tailGear) : 0;
        const group   = Math.floor(src / 10);
        const color   = group === 2 ? C.orange : group === 1 && src % 10 === 0 ? C.yaw : AX[advAxis];
        rpmNotchRows.push({
          name:   _rpmNotchName(src),
          freq:   freqHz > 0 ? freqHz.toFixed(1) : null,
          qVal:   qVal.toFixed(1),
          color,
          delay:  0.15,   // biquad notch group delay in control band (~0.15 ms each)
        });
      });
    }

    // Total filter chain delay
    const rpmTotalDelay = !hasConfig ? 0.20
      : !rpmEnabled ? 0
      : rpmNotchRows.length === 0 ? 0.20
      : rpmNotchRows.length * 0.15;

    // Breakdown items — used for both the total and the visual bar chart
    const breakdownItems = [
      { label:`LPF1 (${lpf1Type})`,              delay: lpf1DelayN,                         color: C.accent,  show: true,         formula: `${lpf1Order}×1/(2π×${lpf1Hz}Hz)` },
      { label:`LPF2 (${lpf2Type})`,              delay: lpf2DelayN,                         color: C.I,       show: lpf2Enabled,  formula: lpf2Enabled?`${lpf2Order}×1/(2π×${lpf2Hz}Hz)`:"disabled" },
      { label:`Dyn Notch${dynCountVal>1?` ×${dynCountVal}`:""}`,delay: dynEnabled?parseFloat(dynDelay):0, color: C.orange, show: dynEnabled, formula: dynEnabled?`~1.5ms × ${dynCountVal}`:"disabled" },
      { label:"RPM Notch",                       delay: rpmTotalDelay,                      color: C.green,   show: rpmEnabled || !hasConfig, formula: `~0.2ms per axis` },
    ];
    const totalDelayNum = breakdownItems.reduce((s, i) => s + i.delay, 0);
    const totalDelay = totalDelayNum.toFixed(2);

    return <div className="sv-tab">
      <Panel title="Filter Advisor" badge="filter chain · latency cost"
        ctrl={<select className="sv-sel" value={advAxis} onChange={e=>setAdvAxis(+e.target.value)}>{AN.map((n,i)=><option key={i} value={i}>{n}</option>)}</select>}>
        {!hasConfig && (
          <div className="sv-adv-nocfg">No config dump attached — RPM filter details unavailable. Latency estimates based on analysis.</div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:hasConfig?10:6}}>

          {/* LPF1 */}
          <div className="sv-adv-row">
            <div className="sv-adv-name">Gyro LPF1</div>
            <div className="sv-adv-detail">{lpf1Src} — dominant latency source</div>
            <div className="sv-adv-lat">+{lpf1Delay} ms</div>
          </div>

          {/* LPF2 */}
          <div className={`sv-adv-row${lpf2Enabled?"":" disabled"}`}>
            <div className="sv-adv-name">Gyro LPF2</div>
            <div className="sv-adv-detail">
              {!hasConfig ? "Cascaded LPF — adds group delay at fc" :
               lpf2Enabled ? `${lpf2Type} @ ${lpf2Hz} Hz — cascaded stage doubles group delay` :
               "Not configured in dump"}
            </div>
            {lpf2Enabled
              ? <div className="sv-adv-lat">+{lpf2Delay} ms</div>
              : <div className="sv-adv-disabled">disabled</div>}
          </div>

          {/* Dynamic Notch */}
          <div className={`sv-adv-row${dynEnabled?"":" disabled"}`}>
            <div className="sv-adv-name">
              Dynamic Notch{hasConfig && dynEnabled && dynCountVal > 1 ? ` ×${dynCountVal}` : ""}
            </div>
            <div className="sv-adv-detail">{dynDetail}</div>
            {dynEnabled
              ? <div className="sv-adv-lat">+{dynDelay} ms</div>
              : <div className="sv-adv-disabled">disabled</div>}
          </div>

          {/* RPM Notch Filters — per-source breakdown */}
          {!hasConfig ? (
            <div className="sv-adv-row">
              <div className="sv-adv-name">RPM Notch Filters</div>
              <div className="sv-adv-detail">Sharp harmonics notch at rotor Hz — ~0.15 ms each</div>
              <div className="sv-adv-lat">+0.15 ms</div>
            </div>
          ) : !rpmEnabled ? (
            <div className="sv-adv-row disabled">
              <div className="sv-adv-name">RPM Notch Filters</div>
              <div className="sv-adv-detail">Not configured in dump</div>
              <div className="sv-adv-disabled">disabled</div>
            </div>
          ) : rpmNotchRows.length === 0 ? (
            <div className="sv-adv-row">
              <div className="sv-adv-name">RPM Notch Filters</div>
              <div className="sv-adv-detail">Enabled but no per-axis sources configured{rpmMin > 0 ? ` · min ${rpmMin} Hz` : ""}</div>
              <div className="sv-adv-lat">+0.15 ms</div>
            </div>
          ) : (<>
            {/* Header row */}
            <div style={{display:"flex",alignItems:"center",padding:"6px 0 4px",borderTop:`1px solid ${C.border}22`}}>
              <div style={{flex:1,fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3,textTransform:"uppercase",letterSpacing:"1px"}}>
                RPM Notch Filters — {AN[advAxis]}{rpmMin > 0 ? ` · min ${rpmMin} Hz` : ""}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"80px 52px 55px 52px",gap:0,fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3,textAlign:"right"}}>
                <span>Frequency</span><span>Q</span><span>Type</span><span>Latency</span>
              </div>
            </div>
            {rpmNotchRows.map((row, i) => (
              <div key={i} style={{display:"flex",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${C.border}18`}}>
                <div style={{display:"flex",alignItems:"center",gap:7,flex:1,minWidth:0}}>
                  <div style={{width:3,height:22,borderRadius:2,background:row.color,flexShrink:0}}/>
                  <div style={{fontSize:11,fontFamily:"JetBrains Mono,monospace",color:C.text2}}>{row.name}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"80px 52px 55px 52px",gap:0,fontSize:10,fontFamily:"JetBrains Mono,monospace",textAlign:"right",flexShrink:0}}>
                  <span style={{color:row.color}}>{row.freq ? `${row.freq} Hz` : "—"}</span>
                  <span style={{color:C.text2}}>Q {row.qVal}</span>
                  <span style={{color:C.text3}}>Biquad</span>
                  <span style={{color:C.accent}}>+{row.delay.toFixed(2)} ms</span>
                </div>
              </div>
            ))}
            {/* RPM subtotal */}
            <div style={{display:"flex",justifyContent:"flex-end",padding:"5px 0 2px"}}>
              <span style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text3}}>
                RPM subtotal ({rpmNotchRows.length} notches):&nbsp;
              </span>
              <span style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.accent,fontWeight:700}}>
                +{(rpmNotchRows.length * 0.15).toFixed(2)} ms
              </span>
            </div>
          </>)}

          {/* Total delay */}
          <div className="sv-adv-total">
            <div className="sv-adv-total-label">Total filter chain delay</div>
            <div className="sv-adv-total-val">{totalDelay} ms</div>
          </div>

          {/* ── Latency breakdown visualization ─────────────────────────── */}
          <div style={{marginTop:18,paddingTop:14,borderTop:`1px solid ${C.border}33`}}>
            <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3,textTransform:"uppercase",letterSpacing:"1.5px",marginBottom:10}}>Latency breakdown per filter</div>

            {/* Stacked proportional bar */}
            <div style={{display:"flex",height:22,borderRadius:4,overflow:"hidden",marginBottom:14,border:`1px solid ${C.border}33`}}>
              {breakdownItems.filter(i=>i.show && i.delay > 0).map((item,i)=>(
                <div key={i} style={{flex:item.delay/totalDelayNum,background:item.color+"99",borderRight:`1px solid #0a0e1440`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"JetBrains Mono,monospace",color:"#fff",overflow:"hidden",whiteSpace:"nowrap",padding:"0 4px",minWidth:0}}>
                  {item.delay/totalDelayNum > 0.12 ? item.label : ""}
                </div>
              ))}
            </div>

            {/* Per-filter rows with bar */}
            {breakdownItems.map((item,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:item.show&&item.delay>0?item.color:C.border,flexShrink:0}}/>
                <div style={{width:138,fontSize:10,fontFamily:"JetBrains Mono,monospace",color:item.show&&item.delay>0?C.text2:C.text3,flexShrink:0}}>{item.label}</div>
                <div style={{flex:1,height:6,background:C.surface3,borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${totalDelayNum>0&&item.delay>0?item.delay/totalDelayNum*100:0}%`,background:item.color+(item.delay>0?"cc":"44"),borderRadius:3}}/>
                </div>
                <div style={{width:52,fontSize:10,fontFamily:"JetBrains Mono,monospace",color:item.show&&item.delay>0?item.color:C.text3,textAlign:"right",flexShrink:0}}>
                  {item.show && item.delay > 0 ? `${item.delay.toFixed(2)} ms` : "—"}
                </div>
                <div style={{width:32,fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3,textAlign:"right",flexShrink:0}}>
                  {item.show && item.delay > 0 && totalDelayNum > 0 ? `${(item.delay/totalDelayNum*100).toFixed(0)}%` : ""}
                </div>
              </div>
            ))}

            {/* Measured vs calculated */}
            {latBase > 0 && (
              <div style={{marginTop:12,padding:"10px 14px",background:C.surface3,borderRadius:6,border:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:16}}>
                <div>
                  <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3,textTransform:"uppercase",letterSpacing:"1px",marginBottom:3}}>Measured loop latency (segment)</div>
                  <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3}}>Filter chain accounts for {totalDelayNum>0?`${Math.min(100,(totalDelayNum/latBase*100)).toFixed(0)}%`:"—"} of measured latency</div>
                </div>
                <div style={{display:"flex",gap:20,alignItems:"baseline",flexShrink:0}}>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3}}>filters</div>
                    <div style={{fontSize:13,fontWeight:700,fontFamily:"JetBrains Mono,monospace",color:C.text2}}>{totalDelayNum.toFixed(2)} ms</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:C.text3}}>measured</div>
                    <div style={{fontSize:16,fontWeight:800,fontFamily:"JetBrains Mono,monospace",color:latBase<totalDelayNum*1.5?C.green:C.orange}}>{latBase.toFixed(2)} ms</div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </Panel>

      <Panel title="PID What-If Projector" badge="project changes to PM · BW · latency"
        ctrl={<select className="sv-sel" value={whatifAxis} onChange={e=>setWhatifAxis(+e.target.value)}>{AN.map((n,i)=><option key={i} value={i}>{n}</option>)}</select>}>
        <div className="sv-whatif-grid">
          <div>
            <div className="sv-section-title" style={{marginBottom:12}}>Gain Multipliers (× baseline)</div>
            {[{k:"P",c:C.P},{k:"I",c:C.I},{k:"D",c:C.D},{k:"F",c:C.F},{k:"fc",c:C.text2}].map(({k,c})=>(
              <div key={k} className="sv-whatif-row">
                <div className="sv-whatif-term" style={{color:c}}>{k}</div>
                <input type="range" className="sv-whatif-slider" min="0.5" max="2.0" step="0.01"
                  value={mults[k]||1} onChange={e=>setMults(v=>({...v,[k]:parseFloat(e.target.value)}))}
                  style={{"--thumb-color":c}}/>
                <div className="sv-whatif-val" style={{color:c,opacity:Math.abs((mults[k]||1)-1)<0.005?0.4:1}}>
                  ×{(mults[k]||1).toFixed(2)}
                </div>
              </div>
            ))}
            <button className="sv-btn sv-btn-ghost" style={{marginTop:10}} onClick={()=>setMults({P:1,I:1,D:1,F:1,fc:1})}>Reset ×1.00</button>
          </div>
          <div>
            <div className="sv-section-title" style={{marginBottom:12}}>Projected Outcome</div>
            <div style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
              {[
                ["Phase Margin",  pm,      pmProj,         "°",  true ],
                ["CL Bandwidth",  fBw,     bwProj,         "Hz", true, 2],
                ["Filter Delay",  +(1000/(2*Math.PI*fc)).toFixed(2), +(1000/(2*Math.PI*fc_new)).toFixed(2), "ms", false, 2],
                ["Est. Latency",  latBase, latProj,         "ms", false],
              ].map(([lbl,base,proj,unit,higher,dec=1])=>(
                <div key={lbl} className="sv-whatif-result-row">
                  <div style={{fontSize:10,color:C.text3,fontFamily:"JetBrains Mono,monospace"}}>{lbl}</div>
                  <div style={{display:"flex",gap:10,alignItems:"baseline"}}>
                    <div style={{fontSize:12,color:C.text3}}>{typeof base==="number"?base.toFixed(dec):"—"} {unit}</div>
                    <div style={{fontSize:14,fontWeight:800}}>{typeof proj==="number"?proj.toFixed(dec):"—"} {unit}</div>
                    {typeof base==="number"&&typeof proj==="number"&&dSpan(base,proj,higher)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {whatifRecs.length>0&&<div className="sv-findings" style={{marginTop:14}}>{whatifRecs.map((r,i)=><FindCard key={i} {...r}/>)}</div>}
      </Panel>
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // FINDINGS
  // ════════════════════════════════════════════════════════════════════════
  function FindingsTab() {
    const findings=[];
    const hsStdV=parseFloat(m("governor","headspeed_std")??0);
    if(hsStdV>15)     findings.push({type:"crit",icon:"🔴",title:"Governor instability detected",detail:`Headspeed σ = ±${hsStdV.toFixed(1)} RPM — far above ±5 RPM target.`,action:"Check governor P/I. Verify headspeed sensor."});
    else if(hsStdV>5) findings.push({type:"warn",icon:"⚠️",title:"Governor slightly unstable",detail:`Headspeed σ = ±${hsStdV.toFixed(1)} RPM.`,action:"Fine-tune governor P gain."});
    else if(hsStdV>0) findings.push({type:"good",icon:"✅",title:"Governor rock-solid",detail:`Headspeed σ = ±${hsStdV.toFixed(1)} RPM.`});

    ["roll","pitch","yaw"].forEach((ax,i)=>{
      const n=parseFloat(m("noise",`std_${ax}`)??0);
      if(n>30)      findings.push({type:"crit",icon:"🔴",title:`CRITICAL: ${AN[i]} gyro noise (${n.toFixed(1)} °/s)`,detail:"Motor vibration or filters too aggressive.",action:"Review filter chain. Check hardware."});
      else if(n>15) findings.push({type:"warn",icon:"⚠️",title:`Elevated ${AN[i]} noise (${n.toFixed(1)} °/s)`,detail:"Some vibration passing filters.",action:"Raise dynamic notch count or add RPM notch."});
    });

    ["roll","pitch","yaw"].forEach((ax,i)=>{
      const pm=parseFloat(m("dynamics",`phase_margin_${ax}`)??0);
      if(pm&&pm<45) findings.push({type:"crit",icon:"🔴",title:`${AN[i]}: unsafe PM (${pm.toFixed(1)}°)`,detail:"Risk of oscillation divergence.",action:"Reduce P gain or lower gyro cutoff."});
      else if(pm&&pm<55) findings.push({type:"warn",icon:"⚠️",title:`${AN[i]}: marginal PM (${pm.toFixed(1)}°)`,detail:"Target PM > 55° on cyclic axes.",action:"Lower P slightly or raise fc."});
    });

    ["roll","pitch","yaw"].forEach((ax,i)=>{
      const err=parseFloat(m("tracking_error",`rms_${ax}`)??0);
      if(err>20) findings.push({type:"warn",icon:"⚠️",title:`${AN[i]}: high tracking error (${err.toFixed(1)} °/s RMS)`,detail:"Setpoint-gyro difference elevated.",action:`Increase ${ax}_P or check FF/setpoint weight.`});
    });

    ["roll","pitch","yaw"].forEach((ax,i)=>{
      const lat=parseFloat(m("control_latency",`median_${ax}`)??0)||0;
      if(lat>60) findings.push({type:"warn",icon:"⚠️",title:`${AN[i]}: high latency (${lat.toFixed(1)} ms)`,detail:"Filter chain delaying the loop significantly.",action:"Raise gyro cutoff or switch to FIRST_ORDER LPF."});
    });

    if(!findings.length) findings.push({type:"info",icon:"ℹ️",title:"Analysis complete — no issues found",detail:"All metrics within acceptable ranges.",action:"Review individual tabs for charts."});
    return <div className="sv-tab"><div className="sv-findings">{findings.map((r,i)=><FindCard key={i} {...r}/>)}</div></div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // AI TAB
  // ════════════════════════════════════════════════════════════════════════
  function AITab() {
    return <div className="sv-tab">
      <Panel title="AI Analysis" badge="claude-sonnet-4-6">
        <div style={{marginBottom:14}}>
          <button className="sv-btn sv-btn-primary" onClick={handleAI} disabled={aiBusy||!results}>
            {aiBusy?"⟳ Analyzing…":"✨ Run AI Analysis"}
          </button>
          {!results&&<span style={{marginLeft:10,fontSize:11,color:C.text3,fontFamily:"JetBrains Mono,monospace"}}>Run analysis first</span>}
        </div>
        {aiResult?.status==="complete"&&<>
          <div style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:16,marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.text3,fontFamily:"JetBrains Mono,monospace",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Narrative</div>
            <div style={{fontSize:13,lineHeight:1.7,color:"#e2e8f0"}}>{aiResult.narrative}</div>
          </div>
          {aiResult.structured?.recommendations?.map((r,i)=>(
            <div key={i} className="sv-finding sv-finding-info" style={{marginBottom:8}}>
              <div className="sv-finding-icon" style={{color:C.accent,fontWeight:800,minWidth:20}}>#{r.priority}</div>
              <div>
                <div className="sv-finding-title">{r.title}</div>
                <div className="sv-finding-detail">{r.detail}</div>
                {r.action&&<div className="sv-finding-action">→ {r.action}</div>}
              </div>
            </div>
          ))}
        </>}
        {aiResult?.status==="error"&&<div className="sv-finding sv-finding-crit"><div className="sv-finding-icon">✗</div><div><div className="sv-finding-title">AI Analysis Error</div><div className="sv-finding-detail">{aiResult.narrative}</div></div></div>}
      </Panel>
    </div>;
  }

  // ── Sub-components ────────────────────────────────────────────────────────
  function SC({label,value,unit,sub,color}) {
    return <div className="sv-stat-card">
      <div className="sv-stat-label">{label}</div>
      <div className="sv-stat-value" style={{color:color||C.accent}}>{value}<span className="sv-stat-unit">{unit}</span></div>
      {sub&&<div className="sv-stat-sub">{sub}</div>}
    </div>;
  }
  function AM({label,value,color}) {
    return <div className="sv-axis-metric">
      <span className="sv-axis-metric-label">{label}</span>
      <span className="sv-axis-metric-val" style={{color:color||C.text2}}>{value}</span>
    </div>;
  }
  function AxisCard({i,m,mf}) {
    const ax=["roll","pitch","yaw"][i];
    return <div className="sv-axis-card">
      <div className="sv-axis-hdr"><div className="sv-axis-dot" style={{background:AX[i]}}/><div className="sv-axis-name" style={{color:AX[i]}}>{AN[i]}</div></div>
      <AM label="Noise σ"     value={`${mf("noise",`std_${ax}`)} °/s`} color={noiseClr(parseFloat(mf("noise",`std_${ax}`))||0)}/>
      <AM label="Track Err"   value={`${mf("tracking_error",`rms_${ax}`)} °/s`}/>
      <AM label="I-term mean" value={mf("pidf_balance",`i_mean_${ax}`)}
        color={Math.abs(parseFloat(mf("pidf_balance",`i_mean_${ax}`))||0)>200?C.orange:C.text2}/>
      <AM label="|P| mean"    value={mf("pidf_balance",`p_mean_${ax}`)}/>
      <AM label="|F| mean"    value={mf("pidf_balance",`f_mean_${ax}`)}/>
    </div>;
  }
  function DynBlock({label,val,unit,color}) {
    return <div className="sv-dyn-block">
      <div className="sv-dyn-lbl">{label}</div>
      <div className="sv-dyn-primary">
        <div className="sv-dyn-val" style={{color:color||C.text2}}>{val}</div>
        <div className="sv-dyn-unit">{unit}</div>
      </div>
    </div>;
  }
  function FindCard({type,icon,title,detail,action}) {
    return <div className={`sv-finding sv-finding-${type}`}>
      <div className="sv-finding-icon">{icon}</div>
      <div>
        <div className="sv-finding-title">{title}</div>
        <div className="sv-finding-detail">{detail}</div>
        {action&&<div className="sv-finding-action">→ {action}</div>}
      </div>
    </div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════════════════
  // PID BANDWIDTH — 6-tab explorer
  // ════════════════════════════════════════════════════════════════════════
  function BandwidthTab() {
    const axName = ["roll","pitch","yaw"][bwAxis];

    // ── Real segment data ──────────────────────────────────────────────
    const fcGyro    = parseFloat(m("dynamics",`fc_gyro_${axName}`) ?? 0) || null;
    const pmMeas    = parseFloat(m("dynamics",`phase_margin_${axName}`) ?? 0) || null;
    const bwMeas    = parseFloat(m("dynamics",`bandwidth_${axName}`) ?? 0) || null;
    const latMs     = parseFloat(m("control_latency",`median_${axName}`) ?? 0) || 0;
    const hs        = parseFloat(m("governor","headspeed_mean") ?? 0) || 0;
    const oneP      = hs > 0 ? hs / 60 : null;
    const profiles  = configData?.pid_profiles || [];
    const bestProf  = (hs > 0 && profiles.find(p => p.target_rpm && Math.abs(p.target_rpm - hs) < 300)) || profiles[0] || {};
    const gyroCutCfg = bestProf[`${axName}_gyro_cutoff`] || null;
    const dCutoffCfg = bestProf[`${axName}_d_cutoff`] || null;
    const bCutoffCfg = bestProf[`${axName}_b_cutoff`] || null;
    const bGainCfg   = bestProf[`${axName}_b_gain`] ?? 0;
    const fcReal     = gyroCutCfg || fcGyro || 65;
    const hasConfig  = configData?.found;
    const bwRef      = bwMeas || 8;

    // ── Slider / sub-tab state ─────────────────────────────────────────
    const [bwSub,    setBwSub]    = useState(0);
    const [gyroSl,   setGyroSl]   = useState(fcReal);
    const [dtermSl,  setDtermSl]  = useState(dCutoffCfg || 15);
    const [btermSl,  setBtermSl]  = useState(bCutoffCfg || 15);
    const [btermGSl, setBtermGSl] = useState(bGainCfg || 10);
    const [btermSpd, setBtermSpd] = useState(2);
    const [cGSl,     setCGSl]     = useState(fcReal);
    const [cDSl,     setCDSl]     = useState(dCutoffCfg || 15);
    const [cBSl,     setCBSl]     = useState(bCutoffCfg || 15);
    const [bwPMult,  setBwPMult]  = useState(1.0);
    const [bwDelSl,  setBwDelSl]  = useState(Math.max(latMs, 1));

    // ── Shared dataset factory ─────────────────────────────────────────
    const ds = (lbl, data, clr, dash, w=2) => ({
      label:lbl, data, borderColor:clr, borderWidth:w,
      ...(dash ? {borderDash:dash} : {}), pointRadius:0, showLine:true, fill:false,
    });

    // ── Tab 2: Gyro Bandwidth ──────────────────────────────────────────
    const buildGyroMag = useCallback(canvas => {
      const sets = [
        ds(`Gyro LPF (${gyroSl} Hz)`, _BW_FREQS.map(f=>({x:f,y:_lpfMagDB(f,gyroSl)})), AX[bwAxis], null, 2.5),
        ds(`Ref (50 Hz)`,              _BW_FREQS.map(f=>({x:f,y:_lpfMagDB(f,50)})),      C.text3,    [4,3], 1.5),
      ];
      if (bwMeas) sets.push(ds(`BW ${bwMeas.toFixed(1)} Hz`,[{x:bwMeas,y:-40},{x:bwMeas,y:5}],C.green+"99",[3,2],1));
      if (oneP)   sets.push(ds(`1P ${oneP.toFixed(1)} Hz`,  [{x:oneP,  y:-40},{x:oneP,  y:5}],C.orange+"99",[2,3],1));
      mkScatterChart(canvas, sets, _BW_LOG_X, _BW_LIN_Y(-40,5,"Gain (dB)"), true);
    }, [bwAxis, gyroSl, bwMeas, oneP]);

    const buildGyroPhase = useCallback(canvas => {
      const sets = [ds("Phase delay", _BW_FREQS.map(f=>({x:f,y:_lpfPhase(f,gyroSl)})), C.orange, null, 2.5)];
      if (bwMeas) sets.push(ds(`BW ${bwMeas.toFixed(1)} Hz`,[{x:bwMeas,y:-90},{x:bwMeas,y:5}],C.green+"99",[3,2],1));
      mkScatterChart(canvas, sets, _BW_LOG_X, _BW_LIN_Y(-90,5,"Phase (°)"), bwMeas!=null);
    }, [gyroSl, bwMeas]);

    const buildGyroStep = useCallback(canvas => {
      const DT=0.4, t=Array.from({length:200},(_,i)=>i*DT);
      const tau=1000/(2*Math.PI*gyroSl), tau50=1000/(2*Math.PI*50);
      let y=0, y50=0;
      const filt   = t.map(ti=>{ if(ti>=5) y  +=(1-y)  *(DT/tau);   return {x:ti,y:Math.min(y,1)}; });
      const filt50 = t.map(ti=>{ if(ti>=5) y50+=(1-y50)*(DT/tau50); return {x:ti,y:Math.min(y50,1)}; });
      mkScatterChart(canvas,[
        ds("Raw impulse",  t.map(ti=>({x:ti,y:ti>=5?1:0})), C.border,   [4,3], 1.5),
        ds(`${gyroSl} Hz`, filt,                             AX[bwAxis], null,  2.5),
        ds("Ref (50 Hz)",  filt50,                           C.text3,    [4,3], 1.5),
      ], _BW_LIN_X("Time (ms)"), _BW_LIN_Y(-0.05,1.1,"Normalised Amplitude"), true);
    }, [bwAxis, gyroSl]);

    // ── Tab 3: D-Term Cutoff ───────────────────────────────────────────
    const buildDtermMag = useCallback(canvas => {
      const freqs = _BW_FREQS.filter(f=>f<=150);
      const sets = [
        ds(`D-term (${dtermSl} Hz)`, freqs.map(f=>({x:f,y:_difMagDB(f,dtermSl)})), AX[bwAxis], null,  2.5),
        ds("Ref (15 Hz)",             freqs.map(f=>({x:f,y:_difMagDB(f,15)})),      C.text3,    [4,3], 1.5),
      ];
      if (oneP)   sets.push(ds(`1P ${oneP.toFixed(1)} Hz`,  [{x:oneP,  y:-30},{x:oneP,  y:5}],C.orange+"99",[2,3],1));
      if (bwMeas) sets.push(ds(`BW ${bwMeas.toFixed(1)} Hz`,[{x:bwMeas,y:-30},{x:bwMeas,y:5}],C.green+"99", [2,3],1));
      mkScatterChart(canvas, sets, _BW_LOG_X, _BW_LIN_Y(-30,5,"Gain (dB)"), true);
    }, [bwAxis, dtermSl, oneP, bwMeas]);

    const buildDtermPhase = useCallback(canvas => {
      const freqs = _BW_FREQS.filter(f=>f<=150);
      mkScatterChart(canvas,[
        ds("Phase lead", freqs.map(f=>({x:f,y:_difPhase(f,dtermSl)})), C.green, null, 2.5),
      ], _BW_LOG_X, _BW_LIN_Y(0,92,"Phase Lead (°)"), false);
    }, [dtermSl]);

    const buildDtermStep = useCallback(canvas => {
      const DT=0.2, t=Array.from({length:500},(_,i)=>i*DT);
      const gyro=t.map(ti=>ti<10?0:ti<30?(ti-10)/20*50:ti<60?50:ti<80?50-(ti-60)/20*50:0);
      const simDif=fc=>{ const tau=1000/(2*Math.PI*fc); let prev=0;
        return gyro.map(g=>{ const a=DT/(DT+tau),f=prev+a*(g-prev); prev=f; return g-f; }); };
      mkScatterChart(canvas,[
        ds("gyroRate",              t.map((ti,i)=>({x:ti,y:gyro[i]})),           C.text3,    [4,3], 1.5),
        ds(`D-term (${dtermSl} Hz)`,t.map((ti,i)=>({x:ti,y:simDif(dtermSl)[i]})),AX[bwAxis], null,  2.5),
        ds("D-term (15 Hz ref)",    t.map((ti,i)=>({x:ti,y:simDif(15)[i]})),     C.text2,    [4,3], 1.5),
        ds("D-term (30 Hz)",        t.map((ti,i)=>({x:ti,y:simDif(30)[i]})),     C.orange,   [3,2], 1.5),
      ], _BW_LIN_X("Time (ms)"), _BW_LIN_Y(-15,60,"Amplitude"), true);
    }, [bwAxis, dtermSl]);

    // ── Tab 4: B-Term Cutoff ───────────────────────────────────────────
    const buildBtermTime = useCallback(canvas => {
      const DT=0.5, t=Array.from({length:300},(_,i)=>i*DT);
      const dur=30/btermSpd, ir=btermSpd*3;
      const sp=t.map(ti=>ti<10?0:ti<10+dur?(ti-10)*ir:ti<90?Math.min(dur*ir,50):ti<90+dur?Math.max(Math.min(dur*ir,50)-(ti-90)*ir,0):0);
      const mx=Math.max(...sp)||1, spN=sp.map(v=>v/mx), fT=spN.map(v=>v*0.8);
      const tau=1000/(2*Math.PI*btermSl); let prev=0;
      const bOut=spN.map(v=>{ const a=DT/(DT+tau),f=prev+a*(v-prev); prev=f; return (v-f)*btermGSl/3; });
      mkScatterChart(canvas,[
        ds("Setpoint",      t.map((ti,i)=>({x:ti,y:spN[i]})),          C.text3,    [4,3], 1.5),
        ds("F-term only",   t.map((ti,i)=>({x:ti,y:fT[i]})),           C.text2,    [3,2], 1.5),
        ds("B-term boost",  t.map((ti,i)=>({x:ti,y:bOut[i]})),         AX[bwAxis], null,  2.5),
        ds("F + B combined",t.map((ti,i)=>({x:ti,y:fT[i]+bOut[i]})),   C.green,    null,  2.5),
      ], _BW_LIN_X("Time (ms)"), _BW_LIN_Y(null,null,"Normalised Output"), true);
    }, [bwAxis, btermSl, btermGSl, btermSpd]);

    const buildBtermBode = useCallback(canvas => {
      const freqs=_BW_FREQS.filter(f=>f>=0.3);
      mkScatterChart(canvas,[
        ds("B-term gain",         freqs.map(f=>({x:f,y:_difMagDB(f,btermSl)})),       AX[bwAxis], null,  2.5),
        ds("Phase lead (scaled)", freqs.map(f=>({x:f,y:_difPhase(f,btermSl)/5-18})), C.green,    [3,2], 1.5),
      ], _BW_LOG_X, _BW_LIN_Y(-30,5,"Gain (dB)"), true);
    }, [bwAxis, btermSl]);

    const buildBtermCmp = useCallback(canvas => {
      const DT=0.5, t=Array.from({length:400},(_,i)=>i*DT);
      const tau=1000/(2*Math.PI*btermSl);
      const simB=spd=>{ const ir=spd*3,dur=30/spd;
        const sp=t.map(ti=>ti<10?0:ti<10+dur?(ti-10)*ir:ti<120?Math.min(dur*ir,50):ti<120+dur?Math.max(Math.min(dur*ir,50)-(ti-120)*ir,0):0);
        const mx=Math.max(...sp)||1; let prev=0;
        return t.map((_,i)=>{ const vn=sp[i]/mx,a=DT/(DT+tau),f=prev+a*(vn-prev); prev=f; return {x:t[i],y:vn-f}; }); };
      mkScatterChart(canvas,[
        ds("F3C slow (1×)", simB(1), C.green,    null, 2.5),
        ds("Moderate (3×)", simB(3), AX[bwAxis], null, 2),
        ds("Fast (8×)",     simB(8), C.orange,   null, 1.5),
      ], _BW_LIN_X("Time (ms)"), _BW_LIN_Y(null,null,"B-Term Output (norm.)"), true);
    }, [bwAxis, btermSl]);

    // ── Tab 5: Combined Effect ─────────────────────────────────────────
    const buildCombined = useCallback(canvas => {
      const DT=0.5, t=Array.from({length:400},(_,i)=>i*DT);
      const tauG=1000/(2*Math.PI*cGSl), tauB=1000/(2*Math.PI*cBSl);
      const sp=t.map(ti=>ti<20?0:ti<60?(ti-20)/40*40:ti<120?40:ti<160?40-(ti-120)/40*40:0);
      let gyroFilt=0,bPrev=0,omega=0,domega=0;
      const spArr=[],gyroArr=[],bArr=[],pidArr=[];
      const Kp=0.06*cGSl/50, Kf=0.7, Kb=0.02;
      t.forEach((ti,i)=>{
        const aG=DT/(DT+tauG),aB=DT/(DT+tauB);
        gyroFilt+=aG*(omega-gyroFilt);
        const spF=bPrev+aB*(sp[i]-bPrev); bPrev=spF;
        const bOut=(sp[i]-spF)*Kb,pOut=Kp*(sp[i]-gyroFilt),fOut=Kf*sp[i]/50,total=pOut+fOut+bOut;
        domega+=(total-0.003*omega)*DT*2; omega+=domega*DT*0.3;
        spArr.push({x:ti,y:sp[i]}); gyroArr.push({x:ti,y:gyroFilt});
        bArr.push({x:ti,y:bOut*20}); pidArr.push({x:ti,y:total});
      });
      mkScatterChart(canvas,[
        ds("Setpoint",        spArr,   C.text3,    [4,3], 1.5),
        ds("Gyro (filtered)", gyroArr, AX[bwAxis], null,  2.5),
        ds("B-term (×20)",    bArr,    C.green,    [3,2], 1.5),
        ds("PID Output",      pidArr,  C.orange,   null,  2),
      ], _BW_LIN_X("Time (ms)"), _BW_LIN_Y(null,null,"Amplitude"), true);
    }, [bwAxis, cGSl, cBSl]);

    const buildCombPhase = useCallback(canvas => {
      mkBarChart(canvas,
        [`Gyro LPF (${cGSl} Hz)`,`D-term (${cDSl} Hz)`,`Loop delay (${(latMs||0.5).toFixed(1)} ms)`],
        [+Math.abs(_lpfPhase(bwRef,cGSl)).toFixed(1), +Math.abs(_lpfPhase(bwRef,cDSl)).toFixed(1), +Math.abs(360*bwRef*(latMs||0.5)/1000).toFixed(1)],
        [AX[bwAxis], C.D, C.text2],
        `Phase loss at ${bwRef.toFixed(1)} Hz (°)`
      );
    }, [bwAxis, cGSl, cDSl, bwRef, latMs]);

    // ── Tab 6: PID Bandwidth ───────────────────────────────────────────
    const buildBWChart = useCallback(canvas => {
      const freqs=_BW_FREQS.filter(f=>f>=0.3&&f<=50);
      const tau=bwDelSl/1000, Kp=1.2*(hs>0?hs/1280:1)*bwPMult;
      const clMag=(f,kp)=>{ const w=2*Math.PI*f,Gre=kp*Math.cos(w*tau)/w,Gim=-kp*Math.sin(w*tau)/w,m2=Gre*Gre+Gim*Gim; return 20*Math.log10(Math.sqrt(m2/((1+Gre)**2+Gim**2))); };
      mkScatterChart(canvas,[
        ds(`0.5× P`,                   freqs.map(f=>({x:f,y:clMag(f,Kp*0.5)})), C.text3,    [4,3], 1.5),
        ds(`${bwPMult.toFixed(1)}× P`, freqs.map(f=>({x:f,y:clMag(f,Kp)})),     AX[bwAxis], null,  2.5),
        ds(`1.5× P`,                   freqs.map(f=>({x:f,y:clMag(f,Kp*1.5)})), C.orange,   [3,2], 1.5),
      ], {type:"logarithmic",min:0.3,max:50,
        grid:{color:C.border,drawTicks:false},border:{color:C.border},
        ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9},callback:v=>[0.5,1,2,5,10,20,50].some(n=>Math.abs(n-v)/v<0.05)?v:""},
        title:{display:true,text:"Frequency (Hz)",color:C.text3,font:{family:"JetBrains Mono",size:9}},
      }, _BW_LIN_Y(-20,10,"Closed-loop gain (dB)"), true);
    }, [bwAxis, bwPMult, bwDelSl, hs]);

    const buildPMChart = useCallback(canvas => {
      const pGs=Array.from({length:50},(_,i)=>0.2+i*2.8/49);
      const dels=[5,Math.max(latMs,1),25], clrs=[C.green,AX[bwAxis],C.red];
      const nms=[`5 ms`,`${Math.max(latMs,1).toFixed(0)} ms (measured)`,`25 ms`];
      const calcPM=(p,d)=>Math.max(0,180-(90+Math.sqrt(p/(d/1000))/(2*Math.PI)*d*360/1000));
      if (!canvas) return;
      kill(canvas.id);
      charts.current[canvas.id] = new Chart(canvas.getContext("2d"),{
        type:"scatter", data:{ datasets:dels.map((d,idx)=>({
          label:nms[idx], data:pGs.map(p=>({x:p,y:calcPM(p,d)})),
          borderColor:clrs[idx], borderWidth:2, pointRadius:0, showLine:true, fill:false,
        }))},
        options:{ responsive:true, maintainAspectRatio:false, animation:{duration:0},
          plugins:{ legend:{display:true,position:"top",labels:{color:C.text2,font:{family:"JetBrains Mono",size:9},boxWidth:12,padding:8}}, tooltip:{enabled:false}},
          scales:{
            x:{type:"linear",min:0.2,max:3,grid:{color:C.border},border:{color:C.border},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9}},title:{display:true,text:"P Gain Multiplier",color:C.text3,font:{family:"JetBrains Mono",size:9}}},
            y:{type:"linear",min:0,max:80,grid:{color:C.border},border:{color:C.border},ticks:{color:C.text3,font:{family:"JetBrains Mono",size:9}},title:{display:true,text:"Phase Margin (°)",color:C.text3,font:{family:"JetBrains Mono",size:9}}},
          },
        },
      });
    }, [bwAxis, latMs]);

    // ── Inline style helpers (functions not components — no identity issues) ─
    const ibox = ch => <div style={{background:"rgba(0,200,255,.06)",borderLeft:`3px solid ${C.accent}55`,borderRadius:"0 6px 6px 0",padding:"10px 14px",fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text2,lineHeight:1.75,marginBottom:10}}>{ch}</div>;
    const wbox = ch => <div style={{background:"rgba(249,115,22,.06)",borderLeft:`3px solid ${C.orange}55`,borderRadius:"0 6px 6px 0",padding:"10px 14px",fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text2,lineHeight:1.75,marginBottom:10}}>{ch}</div>;
    const gbox = ch => <div style={{background:"rgba(16,185,129,.06)",borderLeft:`3px solid ${C.green}55`,borderRadius:"0 6px 6px 0",padding:"10px 14px",fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text2,lineHeight:1.75,marginBottom:10}}>{ch}</div>;
    const met  = (v,u,l,c)=><div style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px",textAlign:"center"}}><div style={{fontSize:22,fontWeight:700,color:c||C.accent}}>{v}</div><div style={{fontSize:10,color:C.text3,fontFamily:"JetBrains Mono,monospace"}}>{u}</div><div style={{fontSize:10,color:C.text2,marginTop:4}}>{l}</div></div>;
    const th   = t=><th style={{padding:"6px 10px",textAlign:"left",color:C.text3,fontWeight:600,fontSize:9,textTransform:"uppercase",letterSpacing:"1px",borderBottom:`1px solid ${C.border}`}}>{t}</th>;
    const td   = (v,c)=><td style={{padding:"7px 10px",color:c||C.text2,borderBottom:`1px solid ${C.border}22`,fontSize:11,fontFamily:"JetBrains Mono,monospace"}}>{v}</td>;
    // Inline slider — avoids nested component unmount/remount on each state change
    const sl   = (lbl,val,set,min,max,step=1,unit="")=>(
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
        <span style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text3,minWidth:155}}>{lbl}: <strong style={{color:C.text2}}>{val}{unit}</strong></span>
        <input type="range" min={min} max={max} step={step} value={val} onChange={e=>set(+e.target.value)} style={{flex:1,accentColor:C.accent,height:3,cursor:"pointer"}}/>
        <span style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.accent,minWidth:45,textAlign:"right"}}>{val}{unit}</span>
      </div>
    );

    const SUB = ["① Signal Chain","② Gyro BW","③ D-Term","④ B-Term","⑤ Combined","⑥ PID BW"];

    return <div className="sv-tab">

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:8}}>
        <select className="sv-sel" value={bwAxis} onChange={e=>setBwAxis(+e.target.value)}>
          {AN.map((n,i)=><option key={i} value={i}>{n}</option>)}
        </select>
        {SUB.map((lbl,i)=>(
          <button key={i} onClick={()=>setBwSub(i)}
            style={{padding:"5px 11px",fontSize:9,fontFamily:"JetBrains Mono,monospace",
              background:bwSub===i?C.accent+"18":"transparent",
              border:`1px solid ${bwSub===i?C.accent+"88":C.border}`,
              color:bwSub===i?C.accent:C.text3,borderRadius:4,cursor:"pointer"}}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ══ TAB 1: SIGNAL CHAIN ═══════════════════════════════════════════ */}
      {bwSub===0 && <>
        <Panel title="Complete PID Signal Flow" badge="where each filter acts in the control loop">
          <div style={{overflowX:"auto",paddingBottom:4}}>
            {/* Setpoint path */}
            <div style={{display:"flex",alignItems:"center",flexWrap:"nowrap",marginBottom:10,gap:0}}>
              {[
                {t:"Pilot Stick",   v:"RC Input",   s:"Raw command"},  null,
                {t:"RC Filter",     v:"Setpoint",   s:"Desired rate °/s"}, null,
                {t:"B-Term Filter", v:"difFilter",  s:`fc = ${bCutoffCfg||"—"} Hz`, hl:"acc"}, null,
                {t:"B-Term Output", v:"Kb × ∂(SP)", s:"FF Boost"}, null,
                {t:"PID Sum",       v:"P+I+D+F+B",  s:"Mixer input", bg:C.green+"18"},
              ].map((n,i)=>n===null
                ? <div key={i} style={{color:C.border,padding:"0 3px",fontSize:16,flexShrink:0}}>→</div>
                : <div key={i} style={{background:n.bg||C.surface2,border:`1px solid ${n.hl?C.accent+"55":C.border}`,borderRadius:8,padding:"9px 12px",textAlign:"center",minWidth:95,flexShrink:0}}>
                    <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",textTransform:"uppercase",letterSpacing:"1px",color:n.hl?C.accent:C.text3}}>{n.t}</div>
                    <div style={{fontSize:13,fontWeight:700,color:n.hl?C.accent:C.text2,marginTop:4}}>{n.v}</div>
                    <div style={{fontSize:9,color:C.text3,marginTop:2}}>{n.s}</div>
                  </div>
              )}
            </div>
            {/* Gyro path */}
            <div style={{display:"flex",alignItems:"center",flexWrap:"nowrap",gap:0}}>
              {[
                {t:"Gyro Raw",       v:"ω (°/s)",   s:"IMU sensor"}, null,
                {t:"Gyro BW Filter", v:"LPF (PT1)", s:`fc = ${gyroCutCfg||fcGyro?.toFixed(0)||"—"} Hz`, hl:"ax"}, null,
                {t:"gyroRate",       v:"Filtered ω",s:"→ P, I, D"}, null,
                {t:"D-Term Filter",  v:"difFilter", s:`fc = ${dCutoffCfg||"—"} Hz`, hl:"ax"}, null,
                {t:"D-Term Output",  v:"Kd × ∂(ω)", s:"Damping force"},
              ].map((n,i)=>n===null
                ? <div key={i} style={{color:C.border,padding:"0 3px",fontSize:16,flexShrink:0}}>→</div>
                : <div key={i} style={{background:C.surface2,border:`1px solid ${n.hl?AX[bwAxis]+"55":C.border}`,borderRadius:8,padding:"9px 12px",textAlign:"center",minWidth:95,flexShrink:0}}>
                    <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",textTransform:"uppercase",letterSpacing:"1px",color:n.hl?AX[bwAxis]:C.text3}}>{n.t}</div>
                    <div style={{fontSize:13,fontWeight:700,color:n.hl?AX[bwAxis]:C.text2,marginTop:4}}>{n.v}</div>
                    <div style={{fontSize:9,color:C.text3,marginTop:2}}>{n.s}</div>
                  </div>
              )}
            </div>
          </div>
        </Panel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Panel title="Three Bandwidth Parameters">
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Parameter","Filter Type","Applied To","Effect"].map(th)}</tr></thead>
              <tbody>
                <tr><td style={{padding:"7px 10px",color:AX[bwAxis],fontFamily:"JetBrains Mono,monospace",fontSize:11}}>gyro_cutoff</td>{td("Lowpass PT1")}{td("Raw gyro → all PID")}{td("Controls what P, I, D all see")}</tr>
                <tr style={{background:C.surface2+"66"}}><td style={{padding:"7px 10px",color:C.D,fontFamily:"JetBrains Mono,monospace",fontSize:11}}>dterm_cutoff</td>{td("difFilter HPF")}{td("∂gyroRate → D-term")}{td("Bandwidth of D damping")}</tr>
                <tr><td style={{padding:"7px 10px",color:C.F,fontFamily:"JetBrains Mono,monospace",fontSize:11}}>bterm_cutoff</td>{td("difFilter HPF")}{td("Setpoint → B-term")}{td("Bandwidth of FF boost")}</tr>
              </tbody>
            </table>
          </Panel>
          <Panel title="Profile Settings">
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Axis","gyro_fc","dterm_fc","bterm_fc","B gain"].map(th)}</tr></thead>
              <tbody>{["roll","pitch","yaw"].map((ax,i)=>{
                const p=profiles[0]||{},gc=p[`${ax}_gyro_cutoff`]||"—",dc=p[`${ax}_d_cutoff`]||"—",bc=p[`${ax}_b_cutoff`]||"—",bg=p[`${ax}_b_gain`]??0;
                return <tr key={ax} style={{background:i%2===0?"transparent":C.surface2+"66"}}>
                  <td style={{padding:"7px 10px",color:AX[i],fontFamily:"JetBrains Mono,monospace",fontSize:11,fontWeight:700}}>{AN[i]}</td>
                  {td(gc!=="—"?gc+" Hz":gc)}{td(dc!=="—"?dc+" Hz":dc)}{td(bc!=="—"?bc+" Hz":bc)}{td(String(bg),bg>0?C.green:C.text3)}
                </tr>;
              })}</tbody>
            </table>
            {!hasConfig && <div style={{marginTop:8,fontSize:10,color:C.text3,fontFamily:"JetBrains Mono,monospace"}}>No config dump attached — values unavailable.</div>}
          </Panel>
        </div>
        <Panel title="difFilter — Bandlimited Differentiation">
          {ibox(<><strong>H(s) = (s/ωc) / (1 + s/ωc)</strong> where ωc = 2π × cutoff_Hz<br/>
            <strong>Below fc:</strong> true differentiator — output ∝ d(input)/dt, +90° phase lead. D provides angular-acceleration braking.<br/>
            <strong>At fc:</strong> −3 dB gain, +45° phase lead. Transition point.<br/>
            <strong>Above fc:</strong> gain levels to 1 — output proportional to input. D becomes a second rate-proportional P-term.<br/>
            Key insight: gyro_cutoff runs <em>before</em> D-term filter. Effective D bandwidth = min(gyro_cutoff, dterm_cutoff).</>)}
        </Panel>
      </>}

      {/* ══ TAB 2: GYRO BANDWIDTH ═════════════════════════════════════════ */}
      {bwSub===1 && <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
          {met(fcReal||"—","Hz",`${AN[bwAxis]} gyro_cutoff`,AX[bwAxis])}
          {met(bwMeas?bwMeas.toFixed(1):"—","Hz","Measured BW",bwMeas?bwClr(bwMeas):C.text3)}
          {met(latMs?latMs.toFixed(1):"—","ms","Loop latency",latMs?latClr(latMs):C.text3)}
          {met(bwRef?(Math.atan(bwRef/gyroSl)/(2*Math.PI*bwRef)*1000).toFixed(2):"—","ms",`Phase delay @ ${bwRef.toFixed(1)} Hz`)}
        </div>
        <Panel title="Gyro LPF — Frequency Response (Magnitude)"
          info={{what:"Magnitude response of the gyro lowpass filter (PT1). Shows how much the filter attenuates signals at each frequency. The −3 dB point is the cutoff frequency where gain drops to 70% of input.",trend:"The cutoff should be well above the closed-loop bandwidth (at least 3×) so it doesn't limit PID response. Lower cutoff = less noise but more lag. The reference 50 Hz line shows a typical setting — most F3C tuners use 50–100 Hz."}}>
          {sl("Gyro cutoff",gyroSl,setGyroSl,10,200,1," Hz")}
          <ChartBox id="bw-gyro-mag" h={220} onMount={buildGyroMag}/>
        </Panel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Panel title="Phase Delay vs Frequency"
            info={{what:"Phase delay introduced by the gyro LPF at each frequency. A lowpass filter delays higher frequencies more than lower ones, which reduces phase margin and limits achievable PID bandwidth.",trend:"At the closed-loop bandwidth frequency (typically 5–15 Hz for F3C), phase delay should be <20°. Lower gyro cutoff → more phase delay at the bandwidth frequency → reduced stability margin."}}><ChartBox id="bw-gyro-phase" h={200} onMount={buildGyroPhase}/></Panel>
          <Panel title="Step Response — PID Sees After Gyro Impulse"
            info={{what:"Time-domain simulation of a gyro impulse propagating through the LPF. Shows how a sharp mechanical disturbance (e.g. blade strike, turbulence) is shaped before the PID loop sees it.",trend:"Rise time (10→90%) should be fast enough for the PID to react before the disturbance propagates further. Faster cutoff = sharper response but more noise. The 50 Hz reference shows typical F3C behavior."}}><ChartBox id="bw-gyro-step" h={200} onMount={buildGyroStep}/></Panel>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {ibox(<><strong>Increasing gyro_cutoff:</strong> PID reacts faster to gyro changes — better tracking, more noise sensitivity for P, I, D simultaneously. Raising cutoff doesn't help if dterm_cutoff is the limiting factor.</>)}
          {wbox(<><strong>Decreasing gyro_cutoff:</strong> Smoother, more delayed gyro signal — less noise, more lag in all terms. Below ~20 Hz the P-term becomes sluggish as it reacts to an overly-smoothed picture of actual motion.</>)}
        </div>
      </>}

      {/* ══ TAB 3: D-TERM CUTOFF ══════════════════════════════════════════ */}
      {bwSub===2 && <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
          {met(dCutoffCfg||"—","Hz","dterm_cutoff (cfg)",C.D)}
          {met(dCutoffCfg?`+${_difPhase(2,dCutoffCfg).toFixed(0)}°`:"—","at 2 Hz","Phase lead (F3C range)",C.green)}
          {met(oneP?oneP.toFixed(1):"—","Hz","1P rotor freq",C.orange)}
          {met(dCutoffCfg&&oneP?(dCutoffCfg<oneP?"✓ Below 1P":"⚠ Above 1P"):"—","","Cutoff vs 1P",dCutoffCfg&&oneP?dCutoffCfg<oneP?C.green:C.orange:C.text3)}
        </div>
        <Panel title="difFilter Bode — Magnitude"
          info={{what:"Magnitude response of the D-term difFilter (bandlimited differentiator). Below the cutoff, gain rises with frequency (true derivative). Above the cutoff, gain levels off — the filter becomes proportional to input rather than its derivative.",trend:"Cutoff should be below 1P rotor frequency to prevent vibration amplification. For F3C at 1750 RPM (1P ≈ 29 Hz), set below 29 Hz. Lower cutoff → better noise rejection, less differentiation bandwidth. Typical optimal: 10–20 Hz."}}>
          {sl("D-term cutoff",dtermSl,setDtermSl,5,80,1," Hz")}
          <ChartBox id="bw-dterm-mag" h={220} onMount={buildDtermMag}/>
        </Panel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Panel title="Phase Lead vs Frequency"
            info={{what:"Phase lead provided by the D-term difFilter. Below the cutoff, the filter acts as a true differentiator giving +90° of phase lead. At the cutoff it gives +45°. Above the cutoff it returns to 0° — purely proportional.",trend:"At F3C control frequencies (0.5–3 Hz), phase lead should be near +90° (pure derivative). This phase lead is what makes D-term a stabilizing damping force. If cutoff is too low, phase lead is lost before it matters."}}><ChartBox id="bw-dterm-phase" h={200} onMount={buildDtermPhase}/></Panel>
          <Panel title="D-Term Output on gyroRate Ramp"
            info={{what:"Time-domain simulation: D-term response to a gyroRate ramp (simulated rapid body rotation). Shows how the D-term boosts at the start and end of motion, providing damping braking.",trend:"D-term output should peak sharply at the beginning and end of the ramp (angular acceleration events), then return to zero during constant-rate motion. Higher cutoff → D-term active longer into sustained motion → more of a rate-proportional P-like effect."}}><ChartBox id="bw-dterm-step" h={200} onMount={buildDtermStep}/></Panel>
        </div>
        <Panel title="Frequency Zone Analysis">
          <div style={{display:"flex",height:26,borderRadius:4,overflow:"hidden",marginBottom:12}}>
            {[["F3C 0.5–3 Hz","#1a7f37",2],[`BW ${bwRef.toFixed(1)} Hz`,"#0071e3",1],[`fc ${dtermSl} Hz`,"#d07000",1],["Above fc = rate gain","#c00",2],[`Gyro LPF ${gyroSl} Hz`,"#555",2]].map(([lbl,clr,flex],i)=>(
              <div key={i} style={{flex,background:clr,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"JetBrains Mono,monospace",color:"#fff",textAlign:"center",padding:"0 2px"}}>{lbl}</div>
            ))}
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Zone","Frequency","D-Term Behavior","Impact"].map(th)}</tr></thead>
            <tbody>{[
              ["F3C inputs","0.5–3 Hz","Pure differentiator — reacts to angular acceleration. Genuine damping braking at position stops.","✓ Correct damping"],
              [`Control BW`,`${bwRef.toFixed(1)} Hz`,`Gain ${_difMagDB(bwRef,dtermSl).toFixed(1)} dB, +${_difPhase(bwRef,dtermSl).toFixed(0)}°. ${bwRef<dtermSl?"Below fc — full damping.":"Above fc — rate-gain mode."}`,bwRef<dtermSl?"✓ Damping active":"⚠ Rate-gain mode"],
              ["D-term fc",`${dtermSl} Hz`,"−3 dB, +45° phase lead. Transition between derivative and proportional behaviour.","↔ Transition point"],
              ...(oneP?[["1P rotor",`${oneP.toFixed(1)} Hz`,`Gain ${_difMagDB(oneP,dtermSl).toFixed(1)} dB. ${oneP>dtermSl?"Above fc — D is rate gain. RPM notch essential.":"Below fc — within derivative range."}`,oneP>dtermSl?"⚠ RPM notch required":"✓ Below cutoff"]]:[]),
            ].map(([zone,freq,beh,imp],i)=>(
              <tr key={i} style={{background:i%2===0?"transparent":C.surface2+"66"}}>
                <td style={{padding:"7px 10px",fontWeight:700,color:AX[bwAxis],fontSize:11,fontFamily:"JetBrains Mono,monospace"}}>{zone}</td>
                {td(freq,C.accent)}{td(beh)}{td(imp,imp.startsWith("✓")?C.green:imp.startsWith("⚠")?C.orange:C.text2)}
              </tr>
            ))}</tbody>
          </table>
        </Panel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {ibox(<><strong>Why D-term cutoff below 1P:</strong> 1P vibration = {oneP?oneP.toFixed(1)+" Hz":"headspeed/60"}. Setting cutoff below 1P means D's gain rolls off before that mechanical frequency — preventing vibration amplification into servo commands.</>)}
          {wbox(<><strong>Above cutoff, D acts like P:</strong> Above fc, D outputs Kd × gyroRate — a rate-proportional term, not a derivative. If dterm_cutoff is too high, this unintended term can drive oscillation above the mechanical vibration band.</>)}
        </div>
      </>}

      {/* ══ TAB 4: B-TERM CUTOFF ══════════════════════════════════════════ */}
      {bwSub===3 && <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
          {met(bGainCfg||"—","gain",`${AN[bwAxis]} B-gain`,bGainCfg>0?C.F:C.text3)}
          {met(bCutoffCfg||"—","Hz","bterm_cutoff (cfg)",C.F)}
          {met(bwMeas?bwMeas.toFixed(1):"—","Hz","Measured BW",bwMeas?bwClr(bwMeas):C.text3)}
          {met(bGainCfg>0?"Active":"Inactive","","B-term status",bGainCfg>0?C.green:C.text3)}
        </div>
        {ibox(<><strong>B-term vs F-term:</strong> F = Kf × setpoint — proportional to current commanded rate (sustained). B = Kb × difFilter(setpoint) — proportional to <em>how fast the setpoint is changing</em>. B fires an anticipatory kick at the start and end of each stick move.</>)}
        <Panel title="B-Term vs F-Term on Stick Input"
          info={{what:"Simulates F-term (proportional to setpoint) and B-term (difFilter of setpoint) on a modeled stick input. B-term fires an anticipatory boost at the leading and trailing edges of each stick movement — before the gyro detects any error.",trend:"F + B combined should rise faster and more decisively than F alone, especially at stick initiation. B-term boost should return to zero during held stick position. If B-term never decays, cutoff is too high. If it barely fires, cutoff is too low or B-gain is too low."}}>
          {sl("B-term fc",btermSl,setBtermSl,3,60,1," Hz")}
          {sl("B gain",btermGSl,setBtermGSl,0,50,1)}
          {sl("Input speed",btermSpd,setBtermSpd,1,10,1)}
          <ChartBox id="bw-bterm-time" h={260} onMount={buildBtermTime}/>
        </Panel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Panel title="difFilter Frequency Response (B-Term)"
            info={{what:"Frequency response of the B-term difFilter showing gain (magnitude) and phase lead. At low frequencies B-term differentiates setpoint — it detects how fast the stick is moving, not where it is. Above the cutoff it reverts to a proportional boost.",trend:"Gain should be rising (differentiating) in the F3C stick-input range (0.5–5 Hz) and rolling off well before the 1P rotor frequency. A cutoff of 10–20 Hz provides the best anticipation-to-noise tradeoff for F3C precision flying."}}><ChartBox id="bw-bterm-bode" h={220} onMount={buildBtermBode}/></Panel>
          <Panel title="Slow vs Moderate vs Fast Inputs"
            info={{what:"Compares B-term output across three different stick input speeds. Slow inputs (F3C precision) produce a small, narrow boost. Fast inputs produce a larger, sharper boost proportional to stick acceleration.",trend:"B-term should scale naturally with input speed — slow inputs get a gentle boost, fast inputs get a strong burst. If slow inputs produce no visible B-term, lower the B-gain or reduce the cutoff. If B-term stays high during fast inputs, the cutoff is too high."}}><ChartBox id="bw-bterm-cmp" h={220} onMount={buildBtermCmp}/></Panel>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {gbox(<><strong>Why B-term helps F3C:</strong> During a precision hover position change, the stick accelerates from zero. B-term fires a boost proportional to that acceleration — immediate command anticipation before the gyro detects any error. Tightens the link between pilot intent and helicopter response.</>)}
          {wbox(<><strong>B-term cutoff too high:</strong> Above ~35 Hz, B-term reacts to high-frequency setpoint noise (RC jitter, glitches). Can cause servo chatter. Starting point: keep bterm_cutoff ≤ dterm_cutoff.</>)}
        </div>
        <Panel title="B-Term Cutoff Guide">
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Cutoff","Behavior","F3C Suitability"].map(th)}</tr></thead>
            <tbody>{[
              ["< 5 Hz",    "Only boosts very slow inputs. Minimal effect in practice.",    "✗ Too low",      C.red],
              ["5–10 Hz",   "Boosts slow F3C precision inputs well. Minimal noise.",        "✓ Conservative", C.green],
              ["10–20 Hz",  "Good balance of anticipation and noise rejection.",            "✓ Optimal",      C.green],
              ["20–35 Hz",  "More punchy initial response. Some noise pickup.",             "⚠ Borderline",   C.orange],
              ["> 35 Hz",   "Reacts to RC signal noise. Risk of servo chatter.",           "✗ Too high",     C.red],
            ].map(([fc,beh,suit,clr],i)=>(
              <tr key={i} style={{background:i%2===0?"transparent":C.surface2+"66"}}>
                {td(fc,C.accent)}{td(beh)}{td(suit,clr)}
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      </>}

      {/* ══ TAB 5: COMBINED EFFECT ════════════════════════════════════════ */}
      {bwSub===4 && <>
        <Panel title="Combined PID Output — F3C Hover Position Change"
          info={{what:"Full closed-loop simulation of a hover position change. Shows setpoint (pilot input), filtered gyro (what PID sees), B-term boost (anticipation), and total PID output, all interacting together through the filter chain.",trend:"Gyro should rise quickly to meet setpoint with minimal lag. B-term should fire a brief boost at the start of motion then decay. PID output should be decisive at stick initiation and settle smoothly — not oscillate. If gyro lags severely, reduce gyro_cutoff or increase P/F."}}>
          {sl("Gyro cutoff",cGSl,setCGSl,10,150,1," Hz")}
          {sl("D-term cutoff",cDSl,setCDSl,5,50,1," Hz")}
          {sl("B-term cutoff",cBSl,setCBSl,3,50,1," Hz")}
          <ChartBox id="bw-comb" h={260} onMount={buildCombined}/>
        </Panel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Panel title={`Phase Budget at ${bwRef.toFixed(1)} Hz`}
            info={{what:"Shows how much phase margin each filter stage consumes at the closed-loop bandwidth frequency. Each bar is degrees of phase delay introduced by that filter. The sum is the total phase loss — what's left before 180° is your phase margin.",trend:"Total phase consumed should leave at least 45° of margin (180° − consumed > 45°). Gyro LPF is typically the largest contributor. Reducing cutoff frequencies lowers each bar but also reduces bandwidth. B-term (not shown) partially offsets D-term loss via phase lead."}}>
            <ChartBox id="bw-comb-phase" h={190} onMount={buildCombPhase}/>
          </Panel>
          <Panel title="Filter Cascade Summary">
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Stage","Type","Cutoff",`Phase @ ${bwRef.toFixed(1)} Hz`].map(th)}</tr></thead>
              <tbody>{[
                ["Gyro LPF",        "PT1 Lowpass",      `${cGSl} Hz`,  `−${Math.abs(_lpfPhase(bwRef,cGSl)).toFixed(1)}°`],
                ["D-term difFilter","HPF Diff.",         `${cDSl} Hz`,  `−${Math.abs(_lpfPhase(bwRef,cDSl)).toFixed(1)}°`],
                ["B-term difFilter","HPF Diff. (lead)",  `${cBSl} Hz`,  `+${_difPhase(bwRef,cBSl).toFixed(1)}° lead`],
                ["PID loop delay",  "Pure delay",        `${(latMs||0.5).toFixed(1)} ms`,`−${Math.abs(360*bwRef*(latMs||0.5)/1000).toFixed(1)}°`],
                ["Net (D-path)",    "—",                 "—",            `−${(Math.abs(_lpfPhase(bwRef,cGSl))+Math.abs(_lpfPhase(bwRef,cDSl))+Math.abs(360*bwRef*(latMs||0.5)/1000)).toFixed(1)}°`],
              ].map(([stage,type,cut,pl],i)=>(
                <tr key={i} style={{background:i===4?C.surface3:i%2===0?"transparent":C.surface2+"66"}}>
                  {td(stage,i===4?C.text2:C.text3)}{td(type)}{td(cut,C.accent)}{td(pl,i===2?C.green:i===4?C.orange:C.text2)}
                </tr>
              ))}</tbody>
            </table>
          </Panel>
        </div>
        <Panel title="F3C Optimal Zone — Current Settings Assessment">
          <div style={{display:"flex",height:28,borderRadius:4,overflow:"hidden",marginBottom:12}}>
            {[["< 5 Hz","#c00",1],["5–10 Hz","#d07000",1],["✓ F3C Optimal 10–20 Hz","#1a7f37",2],["20–35 Hz","#d07000",1],["> 35 Hz","#c00",1]].map(([lbl,clr,flex],i)=>(
              <div key={i} style={{flex,background:clr,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"JetBrains Mono,monospace",color:"#fff",textAlign:"center",padding:"0 2px"}}>{lbl}</div>
            ))}
          </div>
          <div style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text3,lineHeight:2.2}}>
            D-term ({cDSl} Hz): <span style={{color:cDSl>=10&&cDSl<=20?C.green:cDSl>=5&&cDSl<=35?C.orange:C.red}}>{cDSl>=10&&cDSl<=20?"✓ Optimal":cDSl>=5?"⚠ Borderline":"✗ Outside range"}</span>
            {"  ·  "}B-term ({cBSl} Hz): <span style={{color:cBSl>=10&&cBSl<=20?C.green:cBSl>=5&&cBSl<=35?C.orange:C.red}}>{cBSl>=10&&cBSl<=20?"✓ Optimal":cBSl>=5?"⚠ Borderline":"✗ Outside range"}</span>
            {"  ·  "}Gyro ({cGSl} Hz): <span style={{color:cGSl>=bwRef*3?C.green:C.orange}}>{cGSl>=bwRef*3?"✓ Well above BW":"⚠ Close to BW"}</span>
          </div>
        </Panel>
      </>}

      {/* ══ TAB 6: PID BANDWIDTH ══════════════════════════════════════════ */}
      {bwSub===5 && <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
          {met(bwMeas?bwMeas.toFixed(1):"—","Hz",`${AN[bwAxis]} bandwidth`,bwMeas?bwClr(bwMeas):C.text3)}
          {met(pmMeas?pmMeas.toFixed(0)+"°":"—","","Phase margin",pmMeas?pmClr(pmMeas):C.text3)}
          {met(latMs?latMs.toFixed(1):"—","ms","Loop latency",latMs?latClr(latMs):C.text3)}
          {met(oneP?oneP.toFixed(1):"—","Hz","1P frequency",C.orange)}
        </div>
        <Panel title="Closed-Loop Frequency Response — Interactive"
          info={{what:"Simplified closed-loop frequency response model showing how the helicopter's actual output tracks commands at each frequency. Computed from P-gain and loop delay — a 2nd-order approximation useful for understanding bandwidth vs stability tradeoffs.",trend:"Gain should be near 0 dB (flat, perfect tracking) from DC up to the bandwidth frequency, then roll off smoothly. A gain peak (hump above 0 dB) before rolloff indicates the loop is near instability. Increasing P raises bandwidth but also raises the peak — watch for peaking before lowering delay."}}>
          {sl("P gain multiplier",bwPMult,setBwPMult,0.2,3.0,0.1,"×")}
          {sl("Loop delay",bwDelSl,setBwDelSl,0.5,25,0.5," ms")}
          <ChartBox id="bw-bw" h={260} onMount={buildBWChart}/>
        </Panel>
        <Panel title="Phase Margin Waterfall — P-Gain vs Filter Delay"
          info={{what:"Shows how phase margin changes as P-gain increases, for three different loop delays. Each curve is a different delay scenario (low/measured/high). The x-axis is P-gain multiplier, y-axis is resulting phase margin.",trend:"Phase margin should stay above 45° across your P-gain range (green zone). The measured delay curve shows your actual safety envelope. If the measured curve drops below 45° before reaching P×1.0, your filter latency is too high — reduce filter cutoffs or remove unnecessary filters."}}>
          <ChartBox id="bw-pm" h={220} onMount={buildPMChart}/>
          <div style={{marginTop:8,fontSize:10,fontFamily:"JetBrains Mono,monospace",color:C.text3,lineHeight:1.7}}>
            PM degrades as P-gain increases and/or loop delay increases. Target PM &gt; 45° (safe), &gt; 60° (healthy). Measured latency: {latMs?latMs.toFixed(0)+" ms":"—"}.
          </div>
        </Panel>
        <Panel title="Bandwidth vs F3C Requirements">
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Maneuver","Required BW","Available BW","Margin"].map(th)}</tr></thead>
            <tbody>{[
              ["Slow hover position change","1–3 Hz",  bwMeas?`${bwMeas.toFixed(1)} Hz`:"—",bwMeas&&bwMeas>3?`✓ ${(bwMeas/3).toFixed(1)}× margin`:"⚠ Marginal"],
              ["Wind gust rejection",       "5–10 Hz", bwMeas?`${bwMeas.toFixed(1)} Hz`:"—",bwMeas&&bwMeas>=5?"✓ Adequate":"⚠ Insufficient"],
              ["1P vibration rejection",    "Must reject","Notch + LPF",                    "✓ Filtered"],
              ["Servo update rate",        "> 50 Hz",  "2000 Hz PID",                       "✓ Headroom"],
            ].map(([man,req,avail,margin],i)=>(
              <tr key={i} style={{background:i%2===0?"transparent":C.surface2+"66"}}>
                {td(man)}{td(req,C.text3)}{td(avail,C.accent)}{td(margin,margin.startsWith("✓")?C.green:margin.startsWith("⚠")?C.orange:C.text2)}
              </tr>
            ))}</tbody>
          </table>
        </Panel>
        {pmMeas!==null&&pmMeas<45  && wbox(<><strong>Phase margin {pmMeas.toFixed(0)}° — below 45°:</strong> Oscillation risk. Lower P gain or reduce gyro cutoff frequency.</>)}
        {pmMeas!==null&&pmMeas>65  && gbox(<><strong>Phase margin {pmMeas.toFixed(0)}° — healthy:</strong> Headroom to raise P gain or increase gyro cutoff without stability risk.</>)}
      </>}

    </div>;
  }

  const tabMap = {
    overview:<OverviewTab/>, tracking:<TrackingTab/>, pid:<PIDTab/>,
    noise:<NoiseTab/>, dynamics:<DynamicsTab/>, fft:<FFTTab/>,
    governor:<GovernorTab/>, balance:<BalanceTab/>, advisor:<AdvisorTab/>,
    findings:<FindingsTab/>, bandwidth:<BandwidthTab/>, ai:<AITab/>,
  };

  // ════════════════════════════════════════════════════════════════════════
  // CSS
  // ════════════════════════════════════════════════════════════════════════
  const CSS=`
.sv-root{display:flex;flex-direction:column;gap:16px;padding:24px;min-height:100vh;font-family:'Barlow Condensed',sans-serif;background:#0a0e14;color:#e2e8f0;}
.sv-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.sv-back{background:none;border:1px solid #1e3a5f;color:#94a3b8;padding:6px 14px;border-radius:5px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:11px;transition:all .15s;}
.sv-back:hover{border-color:#00c8ff;color:#00c8ff;}
.sv-hdr-title{font-size:18px;font-weight:800;}
.sv-hdr-sub{font-size:11px;color:#475569;font-family:'JetBrains Mono',monospace;}
.sv-status{font-family:'JetBrains Mono',monospace;font-size:11px;padding:5px 13px;border-radius:5px;border:1px solid #1e3a5f;color:#475569;}
.sv-status.running{border-color:rgba(0,200,255,.3);color:#00c8ff;background:rgba(0,200,255,.05);}
.sv-status.done{border-color:rgba(57,255,138,.3);color:#39ff8a;background:rgba(57,255,138,.05);}
.sv-status.error{border-color:rgba(239,68,68,.3);color:#ef4444;background:rgba(239,68,68,.05);}
.sv-run-btn{margin-left:auto;padding:7px 20px;border-radius:5px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;transition:all .2s;background:rgba(57,255,138,.08);border:1px solid #39ff8a;color:#39ff8a;}
.sv-run-btn:disabled{opacity:.5;cursor:not-allowed;}
.sv-run-btn.running{background:rgba(0,200,255,.08);border-color:#00c8ff;color:#00c8ff;}
.sv-tab-nav{display:flex;gap:2px;flex-wrap:wrap;background:#111820;border:1px solid #1e3a5f;border-radius:10px;padding:4px;}
.sv-tab-btn{padding:7px 12px;border:none;background:none;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:12px;color:#475569;border-radius:7px;transition:all .2s;white-space:nowrap;}
.sv-tab-btn.active{background:#1a2535;color:#00c8ff;box-shadow:0 0 10px rgba(0,200,255,.1);}
.sv-tab-btn:hover:not(.active){color:#94a3b8;background:rgba(255,255,255,.03);}
.sv-tab{display:flex;flex-direction:column;gap:20px;}
.sv-panel{background:#111820;border:1px solid #1e3a5f;border-radius:10px;padding:16px 20px;}
.sv-panel-hdr{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.sv-panel-title{font-size:13px;font-weight:700;}
.sv-panel-badge{font-family:'JetBrains Mono',monospace;font-size:9px;color:#475569;border:1px solid #252d40;padding:2px 6px;border-radius:3px;letter-spacing:1px;}
.sv-btn{background:#141820;border:1px solid #252d40;color:#94a3b8;padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer;font-family:'JetBrains Mono',monospace;transition:all .15s;}
.sv-btn:hover{background:#1a2535;color:#e2e8f0;}
.sv-btn.active{background:rgba(0,200,255,.1);color:#00c8ff;border-color:rgba(0,200,255,.3);}
.sv-btn-primary{background:rgba(0,200,255,.08);border:1px solid #00c8ff;color:#00c8ff;padding:7px 18px;border-radius:5px;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s;}
.sv-btn-primary:hover:not(:disabled){background:rgba(0,200,255,.15);box-shadow:0 0 14px rgba(0,200,255,.25);}
.sv-btn-primary:disabled{opacity:.4;cursor:not-allowed;}
.sv-btn-ghost{background:none;border:1px solid #1e3a5f;color:#475569;padding:5px 12px;border-radius:5px;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:12px;cursor:pointer;}
.sv-btn-ghost:hover{border-color:#475569;color:#94a3b8;}
.sv-sel{background:#141820;border:1px solid #252d40;color:#94a3b8;padding:4px 8px;border-radius:5px;font-size:11px;font-family:'JetBrains Mono',monospace;outline:none;cursor:pointer;}
.sv-ctrl-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.sv-section-title{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#475569;font-family:'JetBrains Mono',monospace;padding-bottom:8px;border-bottom:1px solid #1e3a5f;}
.sv-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px;}
.sv-stat-card{background:#111820;border:1px solid #1e3a5f;border-radius:10px;padding:12px 14px;}
.sv-stat-label{font-size:10px;color:#475569;font-family:'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;}
.sv-stat-value{font-size:22px;font-weight:800;line-height:1;}
.sv-stat-unit{font-size:11px;color:#475569;margin-left:2px;font-weight:400;}
.sv-stat-sub{font-size:10px;color:#475569;margin-top:3px;font-family:'JetBrains Mono',monospace;}
.sv-legend{display:flex;gap:14px;flex-wrap:wrap;}
.sv-legend-item{display:flex;align-items:center;gap:6px;font-size:11px;color:#94a3b8;font-family:'JetBrains Mono',monospace;}
.sv-legend-dot{width:10px;height:3px;border-radius:2px;}
.sv-axis-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.sv-axis-card{background:#141820;border:1px solid #1e3a5f;border-radius:8px;padding:14px;}
.sv-axis-hdr{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.sv-axis-dot{width:10px;height:10px;border-radius:2px;}
.sv-axis-name{font-size:12px;font-weight:700;}
.sv-axis-metric{display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid #1e3a5f;}
.sv-axis-metric:last-child{border-bottom:none;}
.sv-axis-metric-label{font-size:10px;color:#475569;font-family:'JetBrains Mono',monospace;}
.sv-axis-metric-val{font-size:12px;font-weight:700;font-family:'JetBrains Mono',monospace;}
.sv-noise-bar{height:6px;border-radius:3px;background:#1e3a5f;overflow:hidden;}
.sv-noise-fill{height:100%;border-radius:3px;transition:width .5s;}
.sv-dyn-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.sv-dyn-card{background:#111820;border:1px solid #1e3a5f;border-radius:10px;overflow:hidden;}
.sv-dyn-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #1e3a5f;background:#141820;}
.sv-dyn-dot{width:10px;height:10px;border-radius:2px;flex-shrink:0;}
.sv-dyn-name{font-size:13px;font-weight:800;}
.sv-dyn-metrics{padding:12px 14px;display:flex;flex-direction:column;gap:10px;}
.sv-dyn-block{background:#141820;border:1px solid #1e3a5f;border-radius:6px;padding:9px 11px;}
.sv-dyn-lbl{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#475569;font-family:'JetBrains Mono',monospace;margin-bottom:4px;}
.sv-dyn-primary{display:flex;align-items:baseline;gap:5px;}
.sv-dyn-val{font-size:24px;font-weight:800;line-height:1;}
.sv-dyn-unit{font-size:12px;color:#475569;}
.sv-dyn-sub{font-size:10px;color:#475569;font-family:'JetBrains Mono',monospace;margin-top:3px;}
.sv-pm-gauge{margin-top:6px;}
.sv-pm-track{height:5px;background:#1e3a5f;border-radius:3px;overflow:hidden;}
.sv-pm-fill{height:100%;border-radius:3px;transition:width .4s;}
.sv-pm-zones{display:flex;justify-content:space-between;font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;margin-top:2px;}
.sv-bal-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;}
.sv-bal-lbl{font-family:'JetBrains Mono',monospace;font-size:10px;width:16px;text-align:center;font-weight:700;}
.sv-bal-track{flex:1;height:7px;background:#1e3a5f;border-radius:4px;overflow:hidden;}
.sv-bal-fill{height:100%;border-radius:4px;transition:width .4s;}
.sv-bal-pct{font-family:'JetBrains Mono',monospace;font-size:10px;color:#94a3b8;width:36px;text-align:right;}
.sv-bal-mean{font-family:'JetBrains Mono',monospace;font-size:10px;color:#475569;width:44px;text-align:right;}
.sv-adv-row{display:flex;align-items:center;gap:10px;background:#1a1f2e;border:1px solid #1e3a5f;border-radius:6px;padding:8px 12px;}
.sv-adv-row.disabled{opacity:0.4;}
.sv-adv-name{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;width:160px;flex-shrink:0;display:flex;align-items:center;gap:6px;}
.sv-adv-detail{font-family:'JetBrains Mono',monospace;font-size:10px;color:#94a3b8;flex:1;}
.sv-adv-lat{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;flex-shrink:0;background:rgba(249,115,22,.12);color:#f97316;border:1px solid rgba(249,115,22,.25);}
.sv-adv-disabled{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:1px;padding:2px 7px;border-radius:3px;flex-shrink:0;background:#0f1219;color:#475569;border:1px solid #1e3a5f;text-transform:uppercase;}
.sv-adv-dot{width:7px;height:7px;border-radius:2px;flex-shrink:0;}
.sv-adv-nocfg{font-size:10px;color:#475569;font-family:'JetBrains Mono',monospace;padding:8px 4px;font-style:italic;}
.sv-adv-total{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #1e3a5f;margin-top:4px;padding-top:10px;}
.sv-adv-total-label{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#475569;}
.sv-adv-total-val{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:800;color:#f97316;}
.sv-whatif-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px;}
.sv-whatif-row{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.sv-whatif-term{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;width:16px;flex-shrink:0;}
.sv-whatif-slider{flex:1;height:4px;appearance:none;background:#252d40;border-radius:2px;outline:none;cursor:pointer;}
.sv-whatif-slider::-webkit-slider-thumb{appearance:none;width:13px;height:13px;border-radius:50%;background:var(--thumb-color,#00c8ff);cursor:pointer;border:2px solid #0a0e14;}
.sv-whatif-val{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;width:48px;text-align:right;flex-shrink:0;}
.sv-whatif-result-row{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #1e3a5f;}
.sv-whatif-result-row:last-child{border-bottom:none;}
.sv-findings{display:flex;flex-direction:column;gap:8px;}
.sv-finding{display:flex;gap:12px;align-items:flex-start;background:#141820;border:1px solid #1e3a5f;border-radius:8px;padding:12px 14px;}
.sv-finding-warn{border-color:rgba(249,115,22,.3);}
.sv-finding-good{border-color:rgba(16,185,129,.3);}
.sv-finding-crit{border-color:rgba(239,68,68,.3);}
.sv-finding-info{border-color:rgba(0,200,255,.2);}
.sv-finding-icon{font-size:16px;flex-shrink:0;margin-top:1px;}
.sv-finding-title{font-size:12px;font-weight:700;margin-bottom:3px;}
.sv-finding-detail{font-size:11px;color:#94a3b8;font-family:'JetBrains Mono',monospace;line-height:1.5;}
.sv-finding-action{margin-top:5px;font-size:11px;color:#00c8ff;font-family:'JetBrains Mono',monospace;}
.sv-delta{font-size:10px;padding:1px 6px;border-radius:3px;font-family:'JetBrains Mono',monospace;}
.delta-pos{background:rgba(16,185,129,.12);color:#10b981;}
.delta-neg{background:rgba(239,68,68,.12);color:#ef4444;}
.delta-neu{background:#1a2535;color:#475569;}
.sv-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:280px;color:#475569;text-align:center;gap:10px;}
.sv-empty-icon{font-size:40px;opacity:.3;}
.sv-empty-title{font-size:16px;font-weight:700;color:#94a3b8;}
.sv-empty-sub{font-size:12px;max-width:280px;line-height:1.6;}
@media(max-width:860px){.sv-axis-grid,.sv-dyn-grid{grid-template-columns:1fr;}.sv-whatif-grid{grid-template-columns:1fr;}}
`;

  return (
    <>
      <style>{CSS}</style>
      <div className="sv-root">
        <div className="sv-header">
          <button className="sv-back" onClick={onBack}>← Back</button>
          <div>
            <div className="sv-hdr-title">{seg?.label??"Segment"}</div>
            <div className="sv-hdr-sub">{flight?.name??"—"} · {seg?.row_count?.toLocaleString()??"—"} samples · {seg?.duration_loops?.toLocaleString()??"—"} loops</div>
          </div>
          <div className={`sv-status ${status}`}>
            {status==="idle"&&"Ready to analyze"}
            {status==="running"&&"⟳ Analysis running…"}
            {status==="done"&&"✓ Analysis complete"}
            {status==="error"&&"✗ Analysis failed"}
          </div>
          <button className={`sv-run-btn ${status==="running"?"running":""}`}
            disabled={status==="running"} onClick={handleRun}>
            {status==="running"?"Running…":status==="done"?"↻ Re-run":"▶ Run Analysis"}
          </button>
        </div>

        <div className="sv-tab-nav">
          {TABS.map(t=>(
            <button key={t.id} className={`sv-tab-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {status!=="done"&&!results ? (
          <div className="sv-empty">
            <div className="sv-empty-icon">📊</div>
            <div className="sv-empty-title">No analysis data yet</div>
            <div className="sv-empty-sub">Click "Run Analysis" to compute metrics for this segment.</div>
          </div>
        ) : (
          <div key={tab}>{tabMap[tab]}</div>
        )}
      </div>
    </>
  );
}
