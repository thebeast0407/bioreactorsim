import { useState } from 'react'
import { applyRecovery, declineRecovery } from '../services/api.js'

export default function RecoveryBar({ prompt }) {
  const [busy, setBusy] = useState(null)   // 'apply' | 'decline' | null

  if (!prompt) {
    return (
      <div style={{ ...s.bar, background: '#f8fafc', borderColor: '#e2e8f0' }}>
        <span style={s.idle}>No active recovery prompts</span>
      </div>
    )
  }

  async function handleApply() {
    setBusy('apply')
    try { await applyRecovery(prompt.fault_id) } finally { setBusy(null) }
  }
  async function handleDecline() {
    setBusy('decline')
    try { await declineRecovery(prompt.fault_id) } finally { setBusy(null) }
  }

  const urgent = prompt.remaining_h < 0.5
  const accentColor = urgent ? '#ef4444' : '#f59e0b'

  return (
    <div style={{ ...s.bar, background: urgent ? '#fef2f2' : '#fffbeb', borderColor: accentColor }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>

      <div style={s.info}>
        <span style={{ color: accentColor, fontWeight: 700 }}>{prompt.fault_name}</span>
        <span style={s.sep}> › </span>
        <span style={{ color: '#374151' }}>{prompt.recovery_name}</span>
        <span style={s.sep}> │ </span>
        <span style={{ color: accentColor, fontFamily: 'monospace', fontSize: 12 }}>
          auto-decline in {prompt.remaining_h.toFixed(1)} h
        </span>
        <span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: 11 }}>
          {' '}(deadline t={prompt.deadline_h.toFixed(1)} h)
        </span>
      </div>

      <div style={s.btns}>
        <button
          onClick={handleApply}
          disabled={busy !== null}
          style={{ ...s.btn, background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', opacity: busy ? 0.5 : 1 }}
        >
          {busy === 'apply' ? '…' : '✓  Apply Recovery'}
        </button>
        <button
          onClick={handleDecline}
          disabled={busy !== null}
          style={{ ...s.btn, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', opacity: busy ? 0.5 : 1 }}
        >
          {busy === 'decline' ? '…' : '✗  Decline'}
        </button>
      </div>
    </div>
  )
}

const s = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 14px',
    border: '1px solid',
    borderRadius: 8,
    minHeight: 44,
    transition: 'border-color 0.3s, background 0.3s',
  },
  idle: { fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' },
  info: { flex: 1, fontSize: 13, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 },
  sep: { color: '#cbd5e1' },
  btns: { display: 'flex', gap: 8, flexShrink: 0 },
  btn: {
    border: 'none',
    borderRadius: 6,
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
}
