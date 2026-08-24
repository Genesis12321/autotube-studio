import { useCallback, useState } from 'react'
import type { Toast } from '../components/Toasts'

export const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, text, kind }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  return { toasts, push }
}
