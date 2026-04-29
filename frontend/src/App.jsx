import { useState } from 'react'
import ConfigStage from './components/ConfigStage.jsx'
import DashboardStage from './components/DashboardStage.jsx'

export default function App() {
  const [stage, setStage] = useState('config')   // 'config' | 'dashboard'
  const [simParams, setSimParams] = useState(null)

  function handleStart(params) {
    setSimParams(params)
    setStage('dashboard')
  }

  function handleBack() {
    setStage('config')
    setSimParams(null)
  }

  return stage === 'config'
    ? <ConfigStage onStart={handleStart} />
    : <DashboardStage params={simParams} onBack={handleBack} />
}
