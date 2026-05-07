import { useState } from 'react'
import { startSimulation } from '../services/api.js'

export default function ConfigStage({ onStart }) {
  // Simulation parameters
  const [duration,   setDuration]   = useState(48)
  const [dtMinutes,  setDtMinutes]  = useState(1)

  // Batch metadata
  const [batchId,      setBatchId]      = useState('')
  const [productName,  setProductName]  = useState('')
  const [orderNo,      setOrderNo]      = useState('')

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function handleStart() {
    setLoading(true)
    setError(null)
    try {
      await startSimulation({
        duration_hours: Number(duration),
        dt_minutes:     Number(dtMinutes),
        fault_ids:      [],
      })
      onStart({
        duration_hours: Number(duration),
        dt_minutes:     Number(dtMinutes),
        batch_id:       batchId.trim()     || `BTH-${Date.now().toString(36).toUpperCase()}`,
        product_name:   productName.trim() || 'Unknown Product',
        order_no:       orderNo.trim()     || '—',
        started_at:     new Date().toISOString(),
      })
    } catch {
      setError('Could not start simulation. Is the API server running?')
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.logo}>⚗</span>
          <div>
            <h1 style={s.title}>Bioreactor Simulation</h1>
            <p style={s.sub}>Configure batch parameters, then start</p>
          </div>
        </div>

        {error && <div style={s.error}>{error}</div>}

        {/* Section — Batch Information */}
        <section style={s.section}>
          <h2 style={s.sectionLabel}>Batch Information</h2>
          <div style={s.grid2}>
            <Field label="Batch ID"      placeholder="BTH-2024-001"     value={batchId}     onChange={setBatchId} />
            <Field label="Product Name"  placeholder="Recombinant mAb"  value={productName} onChange={setProductName} />
            <Field label="Order No"      placeholder="ORD-45821"        value={orderNo}     onChange={setOrderNo} />
          </div>
        </section>

        <div style={s.divider} />

        {/* Section — Run Parameters */}
        <section style={s.section}>
          <h2 style={s.sectionLabel}>Simulation Parameters</h2>
          <div style={s.grid2}>
            <Field
              label="Batch Duration"
              hint="hours"
              type="number" min={1} max={240} step={1}
              value={duration}
              onChange={setDuration}
            />
            <Field
              label="Step Frequency"
              hint="min / step  ·  lower = finer resolution"
              type="number" min={0.1} max={60} step={0.1}
              value={dtMinutes}
              onChange={setDtMinutes}
            />
          </div>
        </section>

        {/* Info note */}
        <div style={s.info}>
          <strong>Fault injection</strong> is available from the live dashboard —
          any of the 22 process / sensor / CPP faults can be triggered with a single click.
          Recovery window is <strong>40% of batch duration</strong> ({(Number(duration) * 0.4).toFixed(1)} h for this run).
        </div>

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={loading}
          style={{ ...s.startBtn, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Starting…' : '▶  Start Simulation'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, hint, type = 'text', min, max, step, placeholder, value, onChange }) {
  return (
    <label style={s.field}>
      <span style={s.label}>{label}</span>
      <div style={s.inputRow}>
        <input
          type={type}
          min={min} max={max} step={step}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ ...s.input, width: type === 'number' ? 100 : '100%' }}
        />
        {hint && <span style={s.hint}>{hint}</span>}
      </div>
    </label>
  )
}

const s = {
  page: {
    minHeight: '100vh', background: '#f8fafc',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
    padding: '36px 40px', width: '100%', maxWidth: 560,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 },
  logo: { fontSize: 44, lineHeight: 1 },
  title: { fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  sub: { fontSize: 13, color: '#64748b' },
  error: {
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
    padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 20,
  },
  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12,
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },
  divider: { height: 1, background: '#f1f5f9', margin: '4px 0 20px' },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: '#374151' },
  inputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6,
    fontSize: 13, color: '#111827', background: '#fff', outline: 'none',
  },
  hint: { fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' },
  info: {
    background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8,
    padding: '10px 14px', fontSize: 12, color: '#0369a1', lineHeight: 1.5,
    marginBottom: 24,
  },
  startBtn: {
    width: '100%', background: '#2563eb', color: '#fff',
    border: 'none', borderRadius: 8, padding: '13px 0',
    fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
}
