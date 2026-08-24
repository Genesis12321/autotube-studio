import { Download, Upload, X } from 'lucide-react'
import type { Job } from '../../server/types'

type Props = {
  job: Job
  onClose: () => void
  onExport: (job: Job) => void
}

export const PlayerSheet = ({ job, onClose, onExport }: Props) => (
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
        poster={`/media/${job.id}/thumb.jpg`}
        controls
        autoPlay
        playsInline
      />
    </div>

    <div className="safe-bottom flex gap-2 p-4">
      <a
        href={job.videoUrl}
        download={`${job.id}.mp4`}
        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-ink-700 text-sm font-medium"
      >
        <Download size={16} /> Descargar
      </a>
      <button type="button" onClick={() => onExport(job)} className="btn-primary flex-1">
        <Upload size={16} /> Subir a YouTube
      </button>
    </div>
  </div>
)
