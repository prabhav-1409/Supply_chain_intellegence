import { createContext, useContext, useMemo, useState } from 'react'

const FlowContext = createContext(null)

const INITIAL_ORDER_CONTEXT = {
  orderId: '',
  skuId: 'xps-15-i9-rtx4080',
  quantity: 1200,
  region: 'NA',
  customerPriority: 'standard',
}

export function FlowProvider({ children }) {
  const [runInfo, setRunInfo] = useState({ eventId: '', componentId: '', runId: '' })
  const [orderContext, setOrderContext] = useState(INITIAL_ORDER_CONTEXT)

  const value = useMemo(() => ({ runInfo, setRunInfo, orderContext, setOrderContext, initialOrderContext: INITIAL_ORDER_CONTEXT }), [runInfo, orderContext])

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>
}

export function useFlow() {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('useFlow must be used within FlowProvider')
  return ctx
}
