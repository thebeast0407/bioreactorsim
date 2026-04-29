import { useState } from 'react'
import { triggerFault } from '../services/api.js'

const CAT_COLOR = { process: '#ef4444', sensor: '#f97316', excursion: '#a855f7' }
const CAT_LABEL = { process: 'Process Faults', sensor: 'Sensor / Actuator', excursion: 'CPP Excursions' }

export default function FaultList({ allFaults, activeFaults, recoveredFaults, simRunning }) {
  const [selectedId, setSelectedId] = useState('')
  const [triggering,  setTriggering]  = useState(false)
  const [error,       setError]       = useState(null)
  const [lastOk,      setLastOk]      = useState(null)

  const activeIds    = new Set((activeFaults    || []).map(f => f.id))
  const recoveredIds = new Set((recoveredFaults || []).map(f => f.id))

  // Faults still available to trigger (not yet active or recovered)
  const available = (allFaults || []).filter(f => !activeIds.has(f.id) && !recoveredIds.has(f.id))
  const selectedFault = available.find(f => f.id === selectedId) ?? null

  async function handleTrigger() {
    if (!selectedId) return
    setError(null)
    setLastOk(null)
    setTriggering(true)
    try {
      await triggerFault(selectedId)
      setLastOk(selectedFault?.name ?? selectedId)
      setSelectedId('')
    } catch (e) {
      setError(e.message)
    } finally {
      setTriggering(false)
    }
  }

  const groups = ['process', 'sensor', 'excursion'].map(cat => ({
    cat,
    items: available.filter(f => f.category === cat),
  })).filter(g => g.items.length > 0)

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerTitle}>⚠ Fault Injection</span>
        {!simRunning && <span style={s.offTag}>simulation not running</span>}
      </div>

      <div style={s.body}>
        {/* Left: selector + trigger */}
        <div style={s.left}>
          <div style={s.selectWrap}>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              disabled={!simRunning}
              style={{ ...s.select, opacity: simRunning ? 1 : 0.5 }}
            >
              <option value="">— Select a fault —</option>
              {groups.map(({ cat, items }) => (
                <optgroup key={cat} label={`◆ ${CAT_LABEL[cat]}`}>
                  {items.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <button
            onClick={handleTrigger}
            disabled={!simRunning || !selectedId || triggering}
            style={{
              ...s.triggerBtn,
              opacity: (!simRunning || !selectedId || triggering) ? 0.4 : 1,
              cursor: (!simRunning || !selectedId) ? 'not-allowed' : 'pointer',
            }}
          >
            {triggering ? 'Triggering…' : '▶  Trigger Fault'}
          </button>

          {/* Fault description */}
          {selectedFault && (
            <div style={s.desc}>
              <span style={{ ...s.catDot, background: CAT_COLOR[selectedFault.category] }} />
              <span style={{ color: '#475569' }}>{selectedFault.desc}</span>
              <span style={s.defaultTime}> Default: t = {selectedFault.trigger_default_h} h</span>
            </div>
          )}

          {error   && <div style={s.errMsg}>⚠ {error}</div>}
          {lastOk  && <div style={s.okMsg}>✓ {lastOk} triggered</div>}
        </div>

        {/* Right: active + recovered status */}
        <div style={s.right}>
          <div style={s.statusTitle}>Fault Status</div>

          {(activeFaults || []).length === 0 && (recoveredFaults || []).length === 0 && (
            <div style={s.emptyStatus}>No faults triggered yet</div>
          )}

          {(activeFaults || []).map(f => (
            <div key={f.id} style={{ ...s.statusRow, borderLeftColor: CAT_COLOR[f.category] || '#ef4444' }}>
              <span style={{ ...s.statusIcon, color: CAT_COLOR[f.category] }}>⚠</span>
              <div style={s.statusInfo}>
                <div style={{ ...s.statusName, color: CAT_COLOR[f.category] }}>{f.name}</div>
                <div style={s.statusMeta}>Active · triggered t = {f.triggered_at_h?.toFixed(1)} h</div>
              </div>
            </div>
          ))}

          {(recoveredFaults || []).map(f => (
            <div key={f.id} style={{ ...s.statusRow, borderLeftColor: '#22c55e' }}>
              <span style={{ ...s.statusIcon, color: '#22c55e' }}>✓</span>
              <div style={s.statusInfo}>
                <div style={{ ...s.statusName, color: '#15803d' }}>{f.name}</div>
                <div style={s.statusMeta}>Recovered</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const s = {
  container: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  header: {
    padding: '7px 14px',
    borderBottom: '1px solid #f1f5f9',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 11, fontWeight: 700, color: '#374151',
    textTransform: 'uppercase', letterSpacing: '0.07em',
  },
  offTag: {
    fontSize: 10, color: '#9ca3af', background: '#f9fafb',
    border: '1px solid #e5e7eb', padding: '1px 8px', borderRadius: 99,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  left: {
    flex: '0 0 340px',
    padding: '10px 14px',
    borderRight: '1px solid #f1f5f9',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  selectWrap: { display: 'flex', flexDirection: 'column' },
  select: {
    width: '100%',
    padding: '7px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    fontSize: 12,
    color: '#1e293b',
    background: '#fff',
    cursor: 'pointer',
    outline: 'none',
  },
  triggerBtn: {
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.02em',
    transition: 'opacity 0.15s',
    alignSelf: 'flex-start',
  },
  desc: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 1.5,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    padding: '4px 0',
  },
  catDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block' },
  defaultTime: { fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' },
  errMsg: { fontSize: 11, color: '#b91c1c', background: '#fef2f2', padding: '4px 8px', borderRadius: 4 },
  okMsg:  { fontSize: 11, color: '#15803d', background: '#dcfce7', padding: '4px 8px', borderRadius: 4 },
  right: {
    flex: 1,
    padding: '10px 14px',
    overflowY: 'auto',
  },
  statusTitle: {
    fontSize: 10, fontWeight: 700, color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
  },
  emptyStatus: { fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' },
  statusRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    borderLeft: '3px solid',
    paddingLeft: 8,
    marginBottom: 6,
  },
  statusIcon: { fontSize: 13, flexShrink: 0, lineHeight: 1.4 },
  statusInfo: {},
  statusName: { fontSize: 12, fontWeight: 600 },
  statusMeta: { fontSize: 10, color: '#94a3b8', marginTop: 1 },
}
