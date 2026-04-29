const BASE = '/api'

export async function fetchFaults() {
  const r = await fetch(`${BASE}/faults`)
  if (!r.ok) throw new Error('Failed to fetch faults')
  return r.json()
}

export async function startSimulation(params) {
  const r = await fetch(`${BASE}/simulation/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!r.ok) throw new Error('Failed to start simulation')
  return r.json()
}

export async function stopSimulation() {
  const r = await fetch(`${BASE}/simulation/stop`, { method: 'POST' })
  if (!r.ok) throw new Error('Failed to stop simulation')
  return r.json()
}

export async function triggerFault(faultId) {
  const r = await fetch(`${BASE}/fault/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fault_id: faultId }),
  })
  if (!r.ok) throw new Error('Failed to trigger fault')
  return r.json()
}

export async function applyRecovery(faultId) {
  const r = await fetch(`${BASE}/fault/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fault_id: faultId }),
  })
  if (!r.ok) throw new Error('Failed to apply recovery')
  return r.json()
}

export async function declineRecovery(faultId) {
  const r = await fetch(`${BASE}/fault/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fault_id: faultId }),
  })
  if (!r.ok) throw new Error('Failed to decline recovery')
  return r.json()
}

export async function fetchHistory() {
  const r = await fetch(`${BASE}/simulation/history`)
  if (!r.ok) throw new Error('Failed to fetch history')
  return r.json()
}

export function createSSEStream(onMessage, onError) {
  const es = new EventSource(`${BASE}/simulation/stream`)
  es.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data))
    } catch (_) {}
  }
  es.onerror = (e) => {
    if (onError) onError(e)
  }
  return es
}
