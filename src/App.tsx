import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Clapperboard, Library as LibraryIcon, Sparkles, Wifi, WifiOff } from 'lucide-react'
import {
  cancelJob,
  createJob,
  deleteJob,
  getSession,
  moveJob,
  publishJob,
  useJobs,
  type Job,
  type JobInput,
} from './api'
import { AutoPanel } from './components/AutoPanel'
import { GeneratorForm } from './components/GeneratorForm'
import { JobProgress } from './components/JobProgress'
import { Library } from './components/Library'
import { LoginGate } from './components/LoginGate'
import { PlayerSheet } from './components/PlayerSheet'
import { QueueList } from './components/QueueList'
import { ToastStack } from './components/Toasts'
import { useToasts } from './hooks/useToasts'

type Tab = 'create' | 'library' | 'auto'

const Studio = () => {
  const { jobs, connected, setJobs } = useJobs()
  const { toasts, push } = useToasts()
  const [tab, setTab] = useState<Tab>('create')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [playing, setPlaying] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  // Ids pedidos en esta sesión: solo esos avisan al terminar, no los que ya estaban en la biblioteca.
  const pending = useRef(new Set<string>())

  const activeJob = useMemo(() => jobs.find((j) => j.id === activeId) ?? null, [jobs, activeId])
  const runningJob = useMemo(() => jobs.find((j) => j.status === 'running') ?? null, [jobs])
  const queued = useMemo(
    () => jobs.filter((j) => j.status === 'queued').sort((a, b) => (a.queueIndex ?? 0) - (b.queueIndex ?? 0)),
    [jobs],
  )

  // Con varios vídeos en cola cada uno avisa al terminar, no solo el último que se pidió.
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'done' && job.status !== 'error') continue
      if (!pending.current.delete(job.id)) continue
      if (job.status === 'done') push(`"${job.title ?? job.input.topic}" listo`, 'ok')
      else push(job.error ?? 'Fallo en el render', 'error')
    }
  }, [jobs, push])

  const submit = async (input: JobInput) => {
    setBusy(true)
    try {
      const job = await createJob(input)
      setActiveId(job.id)
      pending.current.add(job.id)
      push(job.queueIndex ? `Añadido a la cola (puesto ${job.queueIndex + 1})` : 'Generando vídeo...', 'info')
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

  const move = async (job: Job, direction: 'up' | 'down') => {
    await moveJob(job.id, direction)
  }

  const cancel = async (job: Job) => {
    await cancelJob(job.id)
    pending.current.delete(job.id)
    push('Quitado de la cola', 'info')
  }

  const exportToYouTube = async (job: Job) => {
    push('Subiendo a YouTube...', 'info')
    try {
      const url = await publishJob(job.id, 'private')
      push(`Publicado como privado: ${url}`, 'ok')
    } catch (err) {
      push((err as Error).message, 'error')
    }
  }

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
            {runningJob && <JobProgress job={runningJob} />}
            <QueueList jobs={queued} onMove={move} onCancel={cancel} />
            {activeJob && activeJob.id !== runningJob?.id && activeJob.status !== 'queued' && (
              <JobProgress job={activeJob} />
            )}
            {activeJob?.status === 'done' && activeJob.videoUrl && (
              <button className="btn-primary" onClick={() => setPlaying(activeJob)}>
                <Sparkles size={18} /> Ver vídeo generado
              </button>
            )}
          </>
        ) : tab === 'library' ? (
          <Library jobs={jobs} onOpen={setPlaying} onDelete={remove} onExport={exportToYouTube} />
        ) : (
          <AutoPanel onMessage={push} />
        )}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-md border-t border-brand-500/20 bg-ink-800/95 backdrop-blur">
        {([
          { id: 'create', label: 'Generar', icon: Sparkles },
          { id: 'library', label: 'Biblioteca', icon: LibraryIcon },
          { id: 'auto', label: 'Auto', icon: CalendarClock },
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

const App = () => {
  const [unlocked, setUnlocked] = useState<boolean | null>(null)

  useEffect(() => {
    void getSession()
      .then((session) => setUnlocked(!session.required || session.authorized))
      .catch(() => setUnlocked(true))
  }, [])

  if (unlocked === null) return null
  if (!unlocked) return <LoginGate onUnlock={() => setUnlocked(true)} />
  return <Studio />
}

export default App
