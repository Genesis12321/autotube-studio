import { AlertTriangle, Check, Loader2, Mic, Film, FileText, Clapperboard } from 'lucide-react'
import type { Job, StepId } from '../../server/types'

const ICONS: Record<StepId, typeof FileText> = {
  script: FileText,
  voice: Mic,
  visuals: Film,
  render: Clapperboard,
}

export const JobProgress = ({ job }: { job: Job }) => (
  <section className="card space-y-4 animate-fade-in">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{job.title ?? job.input.topic}</p>
        <p className="text-xs text-amber-100/45">
          {job.input.format === 'vertical' ? '9:16' : '16:9'} · {job.input.tone} · {job.input.targetDuration}s
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
          job.status === 'done'
            ? 'bg-emerald-500/15 text-emerald-400'
            : job.status === 'error'
              ? 'bg-red-500/15 text-red-400'
              : 'bg-brand-500/15 text-brand-400'
        }`}
      >
        {job.status === 'done' ? 'Listo' : job.status === 'error' ? 'Error' : 'Procesando'}
      </span>
    </header>

    <ol className="space-y-3">
      {job.steps.map((step) => {
        const Icon = ICONS[step.id]
        return (
          <li key={step.id} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                step.status === 'done'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : step.status === 'running'
                    ? 'bg-brand-600/20 text-brand-400'
                    : step.status === 'error'
                      ? 'bg-red-500/15 text-red-400'
                      : 'bg-ink-700 text-amber-100/30'
              }`}
            >
              {step.status === 'done' ? (
                <Check size={16} />
              ) : step.status === 'running' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : step.status === 'error' ? (
                <AlertTriangle size={16} />
              ) : (
                <Icon size={16} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${step.status === 'pending' ? 'text-amber-100/45' : 'text-amber-50'}`}>{step.label}</p>
              {step.detail && <p className="truncate text-xs text-amber-100/45">{step.detail}</p>}
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-600">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    step.status === 'error' ? 'bg-red-500' : step.status === 'done' ? 'bg-emerald-500' : 'bg-brand-500'
                  }`}
                  style={{ width: `${step.status === 'done' ? 100 : step.progress}%` }}
                />
              </div>
            </div>
          </li>
        )
      })}
    </ol>

    {job.error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">{job.error}</p>}

    {job.scenes.length > 0 && (
      <details className="rounded-xl bg-ink-700/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-amber-100/75">
          Guión por escenas ({job.scenes.length})
        </summary>
        <div className="mt-2 space-y-2">
          {job.scenes.map((scene) => (
            <div key={scene.index} className="rounded-lg bg-ink-800 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">{scene.heading}</p>
              <p className="mt-0.5 text-xs text-amber-100/75">{scene.narration}</p>
            </div>
          ))}
        </div>
      </details>
    )}

    {job.audioUrl && (
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-100/60">Vista previa de audio</p>
        <audio className="w-full" controls src={job.audioUrl} />
      </div>
    )}
  </section>
)
