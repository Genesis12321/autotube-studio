import { Download, Film, Loader2, Trash2, Upload } from 'lucide-react'
import type { Job } from '../../server/types'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

type Props = {
  jobs: Job[]
  onOpen: (job: Job) => void
  onDelete: (job: Job) => void
  onExport: (job: Job) => void
}

export const Library = ({ jobs, onOpen, onDelete, onExport }: Props) => {
  if (jobs.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 py-12 text-center">
        <Film className="text-slate-600" size={32} />
        <p className="text-sm text-slate-400">Aún no has generado vídeos</p>
        <p className="text-xs text-slate-600">Crea el primero desde la pestaña Generar</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {jobs.map((job) => (
        <article key={job.id} className="card flex gap-3 p-3">
          <button
            type="button"
            onClick={() => job.videoUrl && onOpen(job)}
            className={`relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-600 ${
              job.input.format === 'horizontal' ? 'h-20 w-32' : ''
            }`}
          >
            {job.videoUrl ? (
              <img src={`/media/${job.id}/thumb.jpg`} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-slate-500">
                {job.status === 'error' ? '!' : <Loader2 size={16} className="animate-spin" />}
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{job.title ?? job.input.topic}</p>
            <p className="text-[11px] text-slate-500">
              {fmtDate(job.createdAt)}
              {job.durationSec ? ` · ${job.durationSec.toFixed(0)}s` : ''}
              {job.sizeBytes ? ` · ${(job.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
            </p>
            <p
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                job.status === 'done'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : job.status === 'error'
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-brand-500/15 text-brand-400'
              }`}
            >
              {job.status === 'done' ? 'Renderizado' : job.status === 'error' ? 'Error' : 'Renderizando...'}
            </p>

            <div className="mt-2 flex gap-2">
              <a
                href={job.videoUrl ?? '#'}
                download={`${job.id}.mp4`}
                aria-disabled={!job.videoUrl}
                className={`flex items-center gap-1 rounded-lg bg-ink-600 px-2.5 py-1.5 text-[11px] ${
                  job.videoUrl ? '' : 'pointer-events-none opacity-40'
                }`}
              >
                <Download size={13} /> Descargar
              </a>
              <button
                type="button"
                onClick={() => onExport(job)}
                disabled={!job.videoUrl}
                className="flex items-center gap-1 rounded-lg bg-ink-600 px-2.5 py-1.5 text-[11px] disabled:opacity-40"
              >
                <Upload size={13} /> YouTube
              </button>
              <button
                type="button"
                onClick={() => onDelete(job)}
                className="ml-auto rounded-lg bg-ink-600 p-1.5 text-slate-400"
                aria-label="Eliminar"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
