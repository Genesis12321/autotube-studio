import { Check, Copy, Download, Image, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { selectThumb } from '../api'
import type { Job } from '../../server/types'

type Props = {
  job: Job
  onClose: () => void
  onExport: (job: Job) => void
}

export const PlayerSheet = ({ job, onClose, onExport }: Props) => {
  const [copied, setCopied] = useState(false)
  const thumbs = job.thumbUrls ?? (job.thumbUrl ? [job.thumbUrl] : [])
  const [thumb, setThumb] = useState(job.thumbUrl ?? thumbs[0])

  const pickThumb = (url: string, index: number) => {
    setThumb(url)
    void selectThumb(job.id, index)
  }
  const metadata = [job.title ?? job.input.topic, '', job.description ?? '', '', (job.hashtags ?? []).join(' ')]
    .join('\n')
    .trim()

  const copy = async () => {
    await navigator.clipboard.writeText(metadata)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm">
      <header className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full bg-white/10 p-2">
          <X size={18} />
        </button>
        <p className="truncate text-sm font-medium">{job.title ?? job.input.topic}</p>
      </header>

      <div className="flex flex-1 items-center justify-center px-4">
        <video
          className={`max-h-full w-full rounded-2xl bg-black ${job.input.format === 'vertical' ? 'max-w-[380px]' : ''}`}
          src={job.videoUrl}
          poster={thumb}
          controls
          autoPlay
          playsInline
        />
      </div>

      {thumbs.length > 1 && (
        <div className="mx-4 mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Portada</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {thumbs.map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={() => pickThumb(url, index)}
                aria-label={`Usar portada ${index + 1}`}
                className={`h-20 shrink-0 overflow-hidden rounded-xl border-2 ${
                  url === thumb ? 'border-brand-500' : 'border-transparent'
                }`}
              >
                <img src={url} alt="" className="h-full w-auto object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {(job.description || job.hashtags?.length) && (
        <div className="mx-4 mt-3 max-h-48 overflow-y-auto rounded-2xl bg-ink-800/80 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Descripción para YouTube</p>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          {job.description && <p className="mt-2 whitespace-pre-line text-white/80">{job.description}</p>}
          {job.hashtags?.length ? <p className="mt-2 text-brand-400">{job.hashtags.join(' ')}</p> : null}
        </div>
      )}

      <div className="safe-bottom flex gap-2 p-4">
        <a
          href={job.videoUrl}
          download={`${job.id}.mp4`}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-ink-700 text-sm font-medium"
        >
          <Download size={16} /> Descargar
        </a>
        {thumb && (
          <a
            href={thumb}
            download={`${job.id}-miniatura.jpg`}
            aria-label="Descargar miniatura"
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-700"
          >
            <Image size={16} />
          </a>
        )}
        <button type="button" onClick={() => onExport(job)} className="btn-primary flex-1">
          <Upload size={16} /> Subir a YouTube
        </button>
      </div>
    </div>
  )
}
