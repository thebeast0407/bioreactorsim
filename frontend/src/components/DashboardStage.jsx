import { useState, useEffect, useRef } from 'react'
import { stopSimulation, createSSEStream } from '../services/api.js'
import BioreactorModel from './BioreactorModel.jsx'
import ChartPanel from './ChartPanel.jsx'
import FaultList from './FaultList.jsx'
import RecoveryBar from './RecoveryBar.jsx'

// ── Downsampling ──────────────────────────────────────────────────────────────
// Keep the FULL timeline visible: never drop early points (that leaves gaps
// when the x-axis is fixed). Instead, thin uniformly once we exceed the cap.
const DATA_CAP = 3000

function mergePoint(data, point) {
  const next = [...data, point]
  if (next.length <= DATA_CAP) return next
  // Thin by keeping every other point, always preserve first and last
  const thinned = next.filter((_, i) => i === 0 || i % 2 === 0)
  const last = next[next.length - 1]
  if (thinned[thinned.length - 1].time_h !== last.time_h) thinned.push(last)
  return thinned
}

// ── Chart configs ─────────────────────────────────────────────────────────────

const CHART_CONFIGS = [
  {
    id: 'cells',
    title: 'Cell Density & Viability',
    series: [
      { key: 'viable_cell_density_m', label: 'VCD ×10⁶/mL', color: '#16a34a' },
      { key: 'dead_cell_density_m',   label: 'DCD ×10⁶/mL', color: '#dc2626', dashed: true },
      { key: 'viability_pct',         label: 'Viability %',  color: '#7c3aed' },
    ],
  },
  {
    id: 'ph',
    title: 'pH',
    series: [{ key: 'pH', label: 'pH', color: '#3b82f6' }],
    yDomain: [5.5, 8.5],
    setpoint: 7.2,
    bands: [
      { y1: 5.5, y2: 6.5, fill: '#fee2e2', opacity: 0.45 },
      { y1: 6.5, y2: 6.9, fill: '#fef3c7', opacity: 0.55 },
      { y1: 7.5, y2: 7.8, fill: '#fef3c7', opacity: 0.55 },
      { y1: 7.8, y2: 8.5, fill: '#fee2e2', opacity: 0.45 },
    ],
    referenceLines: [
      { y: 7.8, label: 'Limit Hi', color: '#ef4444' },
      { y: 7.5, label: 'Alert Hi', color: '#f59e0b' },
      { y: 6.9, label: 'Alert Lo', color: '#f59e0b' },
      { y: 6.5, label: 'Limit Lo', color: '#ef4444' },
    ],
  },
  {
    id: 'temp',
    title: 'Temperature (°C)',
    series: [{ key: 'temperature_C', label: 'Temp °C', color: '#f97316' }],
    yDomain: [26, 46],
    setpoint: 37.0,
    bands: [
      { y1: 26, y2: 34,   fill: '#fee2e2', opacity: 0.45 },
      { y1: 34, y2: 36,   fill: '#fef3c7', opacity: 0.55 },
      { y1: 38.5, y2: 40, fill: '#fef3c7', opacity: 0.55 },
      { y1: 40, y2: 46,   fill: '#fee2e2', opacity: 0.45 },
    ],
    referenceLines: [
      { y: 40,   label: 'Limit Hi', color: '#ef4444' },
      { y: 38.5, label: 'Alert Hi', color: '#f59e0b' },
      { y: 36,   label: 'Alert Lo', color: '#f59e0b' },
      { y: 34,   label: 'Limit Lo', color: '#ef4444' },
    ],
  },
  {
    id: 'do',
    title: 'Dissolved Oxygen (%)',
    series: [{ key: 'dissolved_oxygen_pct', label: 'DO %', color: '#06b6d4' }],
    yDomain: [0, 115],
    setpoint: 40,
    bands: [
      { y1: 0,   y2: 10,  fill: '#fee2e2', opacity: 0.45 },
      { y1: 10,  y2: 20,  fill: '#fef3c7', opacity: 0.55 },
      { y1: 90,  y2: 100, fill: '#fef3c7', opacity: 0.55 },
      { y1: 100, y2: 115, fill: '#fee2e2', opacity: 0.45 },
    ],
    referenceLines: [
      { y: 100, label: 'Limit Hi', color: '#ef4444' },
      { y: 90,  label: 'Alert Hi', color: '#f59e0b' },
      { y: 20,  label: 'Alert Lo', color: '#f59e0b' },
      { y: 10,  label: 'Limit Lo', color: '#ef4444' },
    ],
  },
  {
    id: 'substrate',
    title: 'Substrate & Lactate (g/L)',
    series: [
      { key: 'substrate_g_L', label: 'Glucose g/L', color: '#eab308' },
      { key: 'lactate_g_L',   label: 'Lactate g/L', color: '#ec4899', dashed: true },
    ],
  },
  {
    id: 'rates',
    title: 'Cell Growth Rate (h⁻¹)',
    series: [
      { key: 'growth_rate_h', label: 'μ growth h⁻¹', color: '#16a34a' },
    ],
  },
]

function transformPoint(raw) {
  return {
    ...raw,
    viable_cell_density_m: raw.viable_cell_density / 1e6,
    dead_cell_density_m:   raw.dead_cell_density   / 1e6,
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardStage({ params, onBack }) {
  const [chartData,      setChartData]      = useState([])
  const [latestState,    setLatestState]    = useState(null)
  const [simFinished,    setSimFinished]    = useState(false)
  const [connected,      setConnected]      = useState(false)
  const [sseError,       setSseError]       = useState(null)
  const [allFaults,      setAllFaults]      = useState([])
  const [faultEvents,    setFaultEvents]    = useState([])    // { time_h, name, category }
  const [recoveryEvents, setRecoveryEvents] = useState([])   // { time_h, name, category }
  const seenFaultIds    = useRef(new Set())
  const seenRecoveryIds = useRef(new Set())
  const esRef = useRef(null)

  useEffect(() => {
    fetch('/api/faults').then(r => r.json()).then(setAllFaults).catch(() => {})
  }, [])

  useEffect(() => {
    setSseError(null)
    setConnected(false)

    const es = createSSEStream(
      (data) => {
        setConnected(true)
        setSseError(null)
        setLatestState(data)
        if (data.finished) setSimFinished(true)

        // Collect new fault trigger events
        const allTriggered = [...(data.active_faults || []), ...(data.recovered_faults || [])]
        const newFaults = []
        for (const f of allTriggered) {
          if (!seenFaultIds.current.has(f.id)) {
            seenFaultIds.current.add(f.id)
            newFaults.push({ time_h: f.triggered_at_h, name: f.name, category: f.category })
          }
        }
        if (newFaults.length) setFaultEvents(prev => [...prev, ...newFaults])

        // Collect new recovery events
        const newRecoveries = []
        for (const f of (data.recovered_faults || [])) {
          const rkey = f.id + '_rec'
          if (!seenRecoveryIds.current.has(rkey) && f.recovered_at_h != null) {
            seenRecoveryIds.current.add(rkey)
            newRecoveries.push({ time_h: f.recovered_at_h, name: f.name, category: f.category })
          }
        }
        if (newRecoveries.length) setRecoveryEvents(prev => [...prev, ...newRecoveries])

        setChartData(prev => mergePoint(prev, transformPoint(data)))
      },
      () => {
        setConnected(false)
        setSseError('Stream disconnected — simulation may have stopped.')
      },
    )
    esRef.current = es
    return () => es.close()
  }, [])

  async function handleStop() {
    esRef.current?.close()
    await stopSimulation().catch(() => {})
    onBack()
  }

  const activeFaults    = latestState?.active_faults    || []
  const recoveredFaults = latestState?.recovered_faults || []
  const recoveryPrompt  = latestState?.recovery_prompt  || null
  const duration        = latestState?.duration_hours   || params?.duration_hours || 48
  const progress        = latestState ? Math.min(100, (latestState.time_h / duration) * 100) : 0

  return (
    <div style={s.page}>

      {/* Top bar */}
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <span style={s.appTitle}>⚗ Bioreactor Dashboard</span>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#22c55e' : '#d1d5db',
            boxShadow: connected ? '0 0 6px #22c55e88' : 'none',
          }} />
          {simFinished && <span style={s.doneTag}>Complete</span>}
        </div>

        <div style={s.progressWrap}>
          <div style={s.track}>
            <div style={{ ...s.fill, width: `${progress}%` }} />
          </div>
          <span style={s.progLabel}>
            {latestState ? `t = ${latestState.time_h.toFixed(1)} / ${duration} h` : '—'}
          </span>
        </div>

        <button onClick={handleStop} style={s.stopBtn}>■ Stop</button>
      </div>

      {sseError && <div style={s.errBanner}>{sseError}</div>}

      {/* Recovery bar */}
      <div style={s.recovRow}>
        <RecoveryBar prompt={recoveryPrompt} />
      </div>

      {/* Main grid: 2D model | charts */}
      <div style={s.mainGrid}>
        <div style={s.modelCol}>
          <BioreactorModel state={latestState} activeFaults={activeFaults} />
        </div>
        <div style={s.chartsGrid}>
          {CHART_CONFIGS.map(cfg => (
            <div key={cfg.id} style={s.chartCell}>
              <ChartPanel
                title={cfg.title}
                data={chartData}
                series={cfg.series}
                duration={duration}
                yDomain={cfg.yDomain}
                setpoint={cfg.setpoint}
                bands={cfg.bands}
                referenceLines={cfg.referenceLines}
                faultEvents={faultEvents}
                recoveryEvents={recoveryEvents}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Fault panel */}
      <div style={s.faultRow}>
        <FaultList
          allFaults={allFaults}
          activeFaults={activeFaults}
          recoveredFaults={recoveredFaults}
          simRunning={connected && !simFinished}
        />
      </div>
    </div>
  )
}

const s = {
  page: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc', overflow: 'hidden' },
  topBar: { display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', flexShrink: 0 },
  topLeft: { display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' },
  appTitle: { fontSize: 15, fontWeight: 700, color: '#0f172a' },
  doneTag: { fontSize: 11, color: '#15803d', background: '#dcfce7', border: '1px solid #86efac', padding: '1px 8px', borderRadius: 99 },
  progressWrap: { flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 6, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', background: 'linear-gradient(90deg,#3b82f6,#22c55e)', borderRadius: 99, transition: 'width 0.5s ease' },
  progLabel: { fontSize: 12, color: '#64748b', fontFamily: 'monospace', whiteSpace: 'nowrap' },
  stopBtn: { background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  errBanner: { background: '#fef2f2', padding: '5px 16px', fontSize: 12, color: '#b91c1c', flexShrink: 0, borderBottom: '1px solid #fecaca' },
  recovRow: { padding: '5px 12px', flexShrink: 0 },
  mainGrid: { flex: 1, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, padding: '0 12px', minHeight: 0 },
  modelCol: { minHeight: 0, overflow: 'hidden', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  chartsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr 1fr', gap: 6, minHeight: 0 },
  chartCell: { minHeight: 0, overflow: 'hidden' },
  faultRow: { height: 190, flexShrink: 0, padding: '5px 12px 8px' },
}
