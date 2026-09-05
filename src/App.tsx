import { useEffect, useMemo, useRef, useState } from 'react'
import { Clapperboard, Library as LibraryIcon, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { createJob, deleteJob, useJobs, type Job, type JobInput } from './api'
import { GeneratorForm } from './components/GeneratorForm'
import { JobProgress } from './components/JobProgress'
import { Library } from './components/Library'
import { PlayerSheet } from './components/PlayerSheet'
import { ToastStack } from './components/Toasts'
import { useToasts } from './hooks/useToasts'

type Tab = 'create' | 'library'

const App = () => {
  const { jobs, connected, setJobs } = useJobs()
  const { toasts, push } = useToasts()
  const [tab, setTab] = useState<Tab>('create')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [playing, setPlaying] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const notified = useRef<string | null>(null)

  const activeJob = useMemo(() => jobs.find((j) => j.id === activeId) ?? null, [jobs, activeId])
  const activeError = activeJob?.error
  const activeStatus = activeJob?.status

  useEffect(() => {
    if (!activeId || (activeStatus !== 'done' && activeStatus !== 'error')) return
    const key = `${activeId}:${activeStatus}`
    if (notified.current === key) return
    notified.current = key
    if (activeStatus === 'done') push('Vídeo renderizado y listo', 'ok')
    else push(activeError ?? 'Fallo en el render', 'error')
  }, [activeId, activeStatus, activeError, push])

  const submit = async (input: JobInput) => {
    setBusy(true)
    try {
      const job = await createJob(input)
      setActiveId(job.id)
      push('Trabajo en cola: generando guión', 'info')
    } catch (err) {
      push((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (job: Job) => {
    await deleteJob(job.id)
    setJobs((prev) => prev.filter((j) => j.id !== job.id))
    if (activeId === job.id) setActiveId(null)
    push('Vídeo eliminado', 'info')
  }

  const exportToYouTube = (job: Job) =>
    push(`Exportación a YouTube simulada para "${job.title ?? job.input.topic}" (falta conectar OAuth)`, 'info')

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <ToastStack toasts={toasts} />

      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-brand-500/20 bg-ink-900/90 px-4 py-3 backdrop-blur">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7e3a1] via-[#e2b53f] to-[#a97d10] text-ink-900 shadow-[0_6px_18px_-8px_rgba(226,181,63,0.9)]">
          <Clapperboard size={18} />
        </span>
        <div className="flex-1">
          <h1 className="gold-text text-sm font-semibold leading-tight">AutoTube Studio</h1>
          <p className="text-[11px] text-amber-100/40">Generador de vídeos faceless</p>
        </div>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${
            connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {connected ? 'En vivo' : 'Sin conexión'}
        </span>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4 pb-28">
        {tab === 'create' ? (
          <>
            <GeneratorForm busy={busy} onSubmit={submit} />
            {activeJob && <JobProgress job={activeJob} />}
            {activeJob?.status === 'done' && activeJob.videoUrl && (
              <button className="btn-primary" onClick={() => setPlaying(activeJob)}>
                <Sparkles size={18} /> Ver vídeo generado
              </button>
            )}
          </>
        ) : (
          <Library jobs={jobs} onOpen={setPlaying} onDelete={remove} onExport={exportToYouTube} />
        )}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-md border-t border-brand-500/20 bg-ink-800/95 backdrop-blur">
        {([
          { id: 'create', label: 'Generar', icon: Sparkles },
          { id: 'library', label: 'Biblioteca', icon: LibraryIcon },
        ] as const).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex flex-1 flex-col items-center gap-1 py-3 text-[11px] ${
              tab === item.id ? 'text-brand-400' : 'text-amber-100/40'
            }`}
          >
            <item.icon size={20} />
            {item.label}
          </button>
        ))}
      </nav>

      {playing && <PlayerSheet job={playing} onClose={() => setPlaying(null)} onExport={exportToYouTube} />}
    </div>
  )
}

export default App
