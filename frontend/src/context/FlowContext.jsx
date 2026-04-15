import { createContext, useContext, useMemo, useState } from 'react'

const FlowContext = createContext(null)

export function FlowProvider({ children }) {
  const [runInfo, setRunInfo] = useState({ eventId: '', componentId: '', runId: '' })

  const value = useMemo(() => ({ runInfo, setRunInfo }), [runInfo])

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>
}

export function useFlow() {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('useFlow must be used within FlowProvider')
  return ctx
}
