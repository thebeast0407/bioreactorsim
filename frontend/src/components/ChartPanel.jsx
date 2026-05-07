import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '8px 12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      fontSize: 11,
      minWidth: 140,
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>
        t = {Number(label).toFixed(2)} h
      </div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ color: '#64748b', flex: 1 }}>{p.name}</span>
          <span style={{ color: '#1e293b', fontWeight: 700, fontFamily: 'monospace' }}>
            {typeof p.value === 'number' ? p.value.toPrecision(5).replace(/\.?0+$/, '') : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Tick interval helper ──────────────────────────────────────────────────────

function getXTicks(duration) {
  const NICE = [1, 2, 3, 4, 6, 8, 10, 12, 16, 24, 36, 48]
  const target = duration / 6
  const step = NICE.find(n => n >= target) ?? Math.ceil(target)
  const ticks = []
  for (let t = 0; t <= duration; t += step) ticks.push(t)
  return ticks
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Props:
 *   title          string
 *   data           array of data points
 *   series         [{ key, label, color, dashed?, area? }]
 *   duration       number   — full x-axis span (fixed from batch start)
 *   yDomain        [min, max]
 *   setpoint       number   — blue dashed baseline
 *   bands          [{ y1, y2, fill, opacity? }]
 *   referenceLines [{ y, label, color }]
 *   faultEvents    [{ time_h, name, category }]
 */
export default function ChartPanel({
  title, data, series, duration,
  yDomain, setpoint, bands, referenceLines, faultEvents, recoveryEvents,
}) {
  const xTicks  = duration ? getXTicks(duration) : undefined
  const xDomain = duration ? [0, duration] : ['auto', 'auto']

  const CAT_STROKE = { process: '#ef4444', sensor: '#f97316', excursion: '#a855f7' }
  const singleSeries = series.length === 1

  return (
    <div style={styles.panel}>
      <div style={styles.titleRow}>
        <span style={styles.title}>{title}</span>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 12, left: -4, bottom: 0 }}>

          {/* Gradient defs for area fills */}
          <defs>
            {series.map(s => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={s.color} stopOpacity={0.18} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          {/* Alert / limit shaded bands */}
          {(bands || []).map((b, i) => (
            <ReferenceArea
              key={i}
              y1={b.y1} y2={b.y2}
              fill={b.fill}
              fillOpacity={b.opacity ?? 0.4}
              ifOverflow="hidden"
            />
          ))}

          <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" vertical={false} />

          <XAxis
            dataKey="time_h"
            type="number"
            domain={xDomain}
            ticks={xTicks}
            tickFormatter={v => `${v}h`}
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
            allowDataOverflow
          />
          <YAxis
            domain={yDomain || ['auto', 'auto']}
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={42}
          />

          <Tooltip content={<CustomTooltip />} />

          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 2 }}
            iconType="plainline"
            iconSize={20}
          />

          {/* Setpoint baseline */}
          {setpoint != null && (
            <ReferenceLine
              y={setpoint}
              stroke="#94a3b8"
              strokeDasharray="6 3"
              strokeWidth={1}
              label={{ value: `${setpoint}`, fill: '#94a3b8', fontSize: 8, position: 'insideTopLeft' }}
            />
          )}

          {/* Alert / limit lines */}
          {(referenceLines || []).map((ref, i) => (
            <ReferenceLine
              key={i}
              y={ref.y}
              stroke={ref.color}
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{
                value: ref.label,
                fill: ref.color,
                fontSize: 7,
                position: i % 2 === 0 ? 'insideTopRight' : 'insideBottomRight',
              }}
            />
          ))}

          {/* Vertical fault event lines */}
          {(faultEvents || []).map((fe, i) => (
            <ReferenceLine
              key={`fe-${i}`}
              x={fe.time_h}
              stroke={CAT_STROKE[fe.category] || '#ef4444'}
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: '⚠', fill: CAT_STROKE[fe.category] || '#ef4444', fontSize: 9, position: 'insideTopLeft' }}
            />
          ))}

          {/* Vertical recovery lines (green) */}
          {(recoveryEvents || []).map((re, i) => (
            <ReferenceLine
              key={`re-${i}`}
              x={re.time_h}
              stroke="#22c55e"
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{ value: '✓', fill: '#22c55e', fontSize: 9, position: 'insideTopRight' }}
            />
          ))}

          {/* Data series: Area for single, Line for multi */}
          {series.map(s =>
            (singleSeries && !s.dashed)
              ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#grad-${s.key})`}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: s.color }}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={s.dashed ? 1.5 : 2}
                  strokeDasharray={s.dashed ? '5 3' : undefined}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: s.color }}
                  isAnimationActive={false}
                />
              )
          )}

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const styles = {
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '8px 10px 4px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    height: '100%',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 2,
    flexShrink: 0,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
}
