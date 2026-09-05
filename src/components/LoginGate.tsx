import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { login } from '../api'

type Props = { onUnlock: () => void }

export const LoginGate = ({ onUnlock }: Props) => {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      onUnlock()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <form onSubmit={submit} className="card w-full max-w-sm animate-fade-in space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7e3a1] via-[#e2b53f] to-[#a97d10] text-ink-900">
          <KeyRound size={20} />
        </span>
        <div>
          <h1 className="gold-text text-lg font-semibold">AutoTube Studio</h1>
          <p className="text-xs text-amber-100/50">Introduce la contraseña para entrar</p>
        </div>
        <input
          type="password"
          className="field text-center"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Contraseña"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy || !password}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={16} />} Entrar
        </button>
      </form>
    </div>
  )
}
