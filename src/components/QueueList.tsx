import { ArrowDown, ArrowUp, ListOrdered, X } from 'lucide-react'
import type { Job } from '../../server/types'

type Props = {
  jobs: Job[]
  onMove: (job: Job, direction: 'up' | 'down') => void
  onCancel: (job: Job) => void
}

/** Trabajos aún sin empezar: se lanzan de uno en uno en el orden que muestra esta lista. */
export const QueueList = ({ jobs, onMove, onCancel }: Props) => {
  if (jobs.length === 0) return null

  return (
    <section className="card space-y-3 animate-fade-in">
      <header className="flex items-center gap-2">
        <ListOrdered size={16} className="text-brand-400" />
        <p className="text-sm font-semibold">En cola ({jobs.length})</p>
      </header>

      <ol className="space-y-2">
        {jobs.map((job, index) => (
          <li key={job.id} className="flex items-center gap-2 rounded-xl bg-ink-700/60 px-3 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] text-brand-400">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{job.input.topic}</p>
              <p className="text-[11px] text-amber-100/45">
                {job.input.format === 'vertical' ? '9:16' : '16:9'} · {job.input.targetDuration}s
              </p>
            </div>
            <button
              type="button"
              onClick={() => onMove(job, 'up')}
              disabled={index === 0}
              aria-label="Subir en la cola"
              className="rounded-lg bg-ink-600 p-1.5 disabled:opacity-30"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => onMove(job, 'down')}
              disabled={index === jobs.length - 1}
              aria-label="Bajar en la cola"
              className="rounded-lg bg-ink-600 p-1.5 disabled:opacity-30"
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => onCancel(job)}
              aria-label="Quitar de la cola"
              className="rounded-lg bg-ink-600 p-1.5 text-amber-100/60"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
