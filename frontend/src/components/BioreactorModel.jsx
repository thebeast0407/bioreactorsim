import { useRef, useState, useEffect } from 'react'

const IMG_W = 1376
const IMG_H = 768
const IMG_ASPECT = IMG_W / IMG_H   // 1.792

// CPP annotation positions as fractions of the rendered image rect
const CPP_ANNOTATIONS = [
  { key: 'press', label: 'Pressure',   xFrac: 0.86, yFrac: 0.11, fmt: v => v.toFixed(3), unit: ' bar' },
  { key: 'pH',    label: 'pH',         xFrac: 0.86, yFrac: 0.30, fmt: v => v.toFixed(2), unit: '' },
  { key: 'do',    label: 'DO',         xFrac: 0.86, yFrac: 0.52, fmt: v => v.toFixed(1), unit: ' %' },
  { key: 'temp',  label: 'Temp',       xFrac: 0.86, yFrac: 0.72, fmt: v => v.toFixed(1), unit: ' °C' },
  { key: 'vcd',   label: 'VCD',        xFrac: 0.10, yFrac: 0.30, fmt: v => (v / 1e6).toFixed(2), unit: ' ×10⁶/mL' },
]

// Which CPP keys are affected by each fault id
const FAULT_CPP = {
  agitator_power_loss:  ['do'],
  sparger_blockage:     ['do'],
  gas_supply_failure:   ['do'],
  foam_overflow:        ['do'],
  viscosity_surge:      ['do'],
  antifoam_injection:   ['do'],
  impeller_shear:       ['do', 'vcd'],
  coolant_leak:         ['do'],
  exhaust_filter_clog:  ['do', 'press'],
  seed_hypoxia:         ['do', 'vcd'],
  do_probe_bias:        ['do'],
  pid_fault:            ['temp'],
  antifoam_overdose:    ['do'],
  ph_high:              ['pH'],
  ph_low:               ['pH'],
  ph_oscillation:       ['pH'],
  do_low_sustained:     ['do'],
  do_high:              ['do'],
  do_hunting:           ['do'],
  temp_high:            ['temp'],
  temp_low:             ['temp'],
  temp_ramp:            ['temp'],
}

const CAT_COLOR = { process: '#ef4444', sensor: '#f97316', excursion: '#a855f7' }

const LIMITS = {
  pH:    { alertLow: 6.9, alertHigh: 7.5, limitLow: 6.5, limitHigh: 7.8 },
  do:    { alertLow: 20,  alertHigh: 90,  limitLow: 10,  limitHigh: 100 },
  temp:  { alertLow: 36,  alertHigh: 38.5, limitLow: 34, limitHigh: 40 },
  press: { alertLow: 1.0, alertHigh: 1.5, limitLow: 0.8, limitHigh: 2.0 },
}

function cppStatus(key, val) {
  const b = LIMITS[key]
  if (!b || val == null) return 'normal'
  if (val < (b.limitLow ?? -Infinity) || val > (b.limitHigh ?? Infinity)) return 'limit'
  if (val < (b.alertLow ?? -Infinity) || val > (b.alertHigh ?? Infinity)) return 'alert'
  return 'normal'
}

const STATUS_STYLE = {
  normal: { bg: '#f0fdf4', border: '#22c55e', labelColor: '#16a34a', valColor: '#15803d' },
  alert:  { bg: '#fffbeb', border: '#f59e0b', labelColor: '#b45309', valColor: '#92400e' },
  limit:  { bg: '#fef2f2', border: '#ef4444', labelColor: '#b91c1c', valColor: '#991b1b' },
}

export default function BioreactorModel({ state, activeFaults }) {
  const containerRef = useRef(null)
  const [imgRect, setImgRect] = useState({ left: 0, top: 0, w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const recalc = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (!cw || !ch) return
      const cAspect = cw / ch
      let w, h, left, top
      if (cAspect > IMG_ASPECT) {
        h = ch; w = ch * IMG_ASPECT; left = (cw - w) / 2; top = 0
      } else {
        w = cw; h = cw / IMG_ASPECT; left = 0; top = (ch - h) / 2
      }
      setImgRect({ left, top, w, h })
    }
    recalc()
    const obs = new ResizeObserver(recalc)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  if (!state) {
    return (
      <div ref={containerRef} style={styles.wrapper}>
        <div style={styles.placeholder}>
          <span style={{ fontSize: 52, opacity: 0.3 }}>⚗</span>
          <p style={{ color: '#94a3b8', marginTop: 8, fontSize: 13 }}>Waiting for data…</p>
        </div>
      </div>
    )
  }

  const vals = {
    pH:    state.pH,
    do:    state.dissolved_oxygen_pct,
    temp:  state.temperature_C,
    press: state.pressure_bar,
    vcd:   state.viable_cell_density,
  }

  // Build set of CPP keys that have an active fault
  const faultedCPP = {}   // key → [{ name, category }]
  for (const f of (activeFaults || [])) {
    const affected = FAULT_CPP[f.id] || []
    for (const k of affected) {
      if (!faultedCPP[k]) faultedCPP[k] = []
      faultedCPP[k].push(f)
    }
  }

  return (
    <div ref={containerRef} style={styles.wrapper}>
      <img
        src="/bioreactormodel.png"
        alt="Bioreactor schematic"
        style={styles.image}
        draggable={false}
      />

      {/* CPP badges */}
      {imgRect.w > 0 && CPP_ANNOTATIONS.map(({ key, label, xFrac, yFrac, fmt, unit }) => {
        const val   = vals[key]
        const st    = cppStatus(key, val)
        const c     = STATUS_STYLE[st]
        const faults = faultedCPP[key] || []
        const hasFault = faults.length > 0
        const faultColor = hasFault ? (CAT_COLOR[faults[0].category] || '#ef4444') : null

        return (
          <div
            key={key}
            style={{
              position: 'absolute',
              left: imgRect.left + imgRect.w * xFrac,
              top:  imgRect.top  + imgRect.h * yFrac,
              transform: 'translate(-50%, -50%)',
              background: hasFault ? `${faultColor}12` : c.bg,
              border: `1.5px solid ${hasFault ? faultColor : c.border}`,
              borderRadius: 7,
              padding: '3px 9px',
              minWidth: 68,
              textAlign: 'center',
              pointerEvents: 'none',
              boxShadow: hasFault
                ? `0 0 0 2px ${faultColor}40, 0 2px 6px rgba(0,0,0,0.12)`
                : '0 1px 4px rgba(0,0,0,0.08)',
            }}
          >
            {/* Label row with optional fault icon */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginBottom: 2 }}>
              {hasFault && (
                <span style={{ fontSize: 9, color: faultColor, lineHeight: 1 }}>⚠</span>
              )}
              <span style={{
                fontSize: 9, fontWeight: 700,
                color: hasFault ? faultColor : c.labelColor,
                textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1,
              }}>
                {label}
              </span>
            </div>
            {/* Value */}
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: hasFault ? faultColor : c.valColor,
              fontFamily: 'monospace', lineHeight: 1,
            }}>
              {val != null ? `${fmt(val)}${unit}` : '—'}
            </div>
          </div>
        )
      })}

      {/* Active fault tags stacked at bottom of image */}
      {imgRect.w > 0 && (activeFaults || []).map((f, i) => {
        const color = CAT_COLOR[f.category] || '#ef4444'
        return (
          <div
            key={f.id}
            style={{
              position: 'absolute',
              left: imgRect.left + 8,
              top:  imgRect.top + imgRect.h - 26 - i * 24,
              background: '#fff',
              border: `1px solid ${color}`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 600,
              color,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            ⚠ {f.name}
          </div>
        )
      })}

      {/* Time stamp */}
      {imgRect.w > 0 && (
        <div style={{
          position: 'absolute',
          right: imgRect.left === 0 ? 4 : (imgRect.left === 0 ? 4 : `calc(100% - ${imgRect.left + imgRect.w - 4}px)`),
          top: imgRect.top + 4,
          background: 'rgba(255,255,255,0.9)',
          border: '1px solid #e2e8f0',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#64748b',
          pointerEvents: 'none',
        }}>
          t = {state.time_h.toFixed(2)} h
        </div>
      )}
    </div>
  )
}

const styles = {
  wrapper: {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: '#fff',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  placeholder: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
}
