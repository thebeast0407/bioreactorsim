import { useState } from 'react'
import { startSimulation } from '../services/api.js'

export default function ConfigStage({ onStart }) {
  const [duration, setDuration]   = useState(48)
  const [dtMinutes, setDtMinutes] = useState(1)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  async function handleStart() {
    setLoading(true)
    setError(null)
    try {
      await startSimulation({
        duration_hours: Number(duration),
        dt_minutes:     Number(dtMinutes),
        fault_ids:      [],
      })
      onStart({ duration_hours: Number(duration), dt_minutes: Number(dtMinutes) })
    } catch (e) {
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
            <p style={s.sub}>Configure run parameters, then start</p>
          </div>
        </div>

        {error && <div style={s.error}>{error}</div>}

        {/* Parameters */}
        <div style={s.fields}>
          <Field
            label="Batch Duration"
            hint="hours"
            min={1} max={240} step={1}
            value={duration}
            onChange={setDuration}
          />
          <Field
            label="Step Frequency"
            hint="minutes per step  ·  lower = finer resolution"
            min={0.1} max={60} step={0.1}
            value={dtMinutes}
            onChange={setDtMinutes}
          />
        </div>

        {/* Info box */}
        <div style={s.info}>
          <strong>Fault injection</strong> is available from the live dashboard after the
          simulation starts — any of the 22 process / sensor / CPP faults can be triggered
          at any time with a single click.
        </div>

        {/* Start */}
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

function Field({ label, hint, value, onChange, min, max, step }) {
  return (
    <label style={s.field}>
      <span style={s.label}>{label}</span>
      <div style={s.inputRow}>
        <input
          type="number"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={s.input}
        />
        <span style={s.hint}>{hint}</span>
      </div>
    </label>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 40,
    width: '100%',
    maxWidth: 520,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  logo: { fontSize: 44, lineHeight: 1 },
  title: { fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  sub: { fontSize: 13, color: '#64748b' },
  error: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#b91c1c',
    fontSize: 13,
    marginBottom: 20,
  },
  fields: { display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  inputRow: { display: 'flex', alignItems: 'center', gap: 10 },
  input: {
    width: 120,
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 15,
    color: '#111827',
    background: '#fff',
    outline: 'none',
  },
  hint: { fontSize: 12, color: '#9ca3af' },
  info: {
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 13,
    color: '#0369a1',
    lineHeight: 1.5,
    marginBottom: 28,
  },
  startBtn: {
    width: '100%',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '13px 0',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
}
