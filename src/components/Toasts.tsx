import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'

export type Toast = { id: number; text: string; kind: 'ok' | 'error' | 'info' }

export const ToastStack = ({ toasts }: { toasts: Toast[] }) => (
  <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
    {toasts.map((t) => (
      <div
        key={t.id}
        className="flex w-full max-w-md items-center gap-2 rounded-xl border border-white/10 bg-ink-700/95 px-3 py-2.5 text-sm shadow-lg animate-fade-in"
      >
        {t.kind === 'ok' ? (
          <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
        ) : t.kind === 'error' ? (
          <AlertTriangle size={16} className="shrink-0 text-red-400" />
        ) : (
          <Info size={16} className="shrink-0 text-brand-400" />
        )}
        <span className="min-w-0 flex-1">{t.text}</span>
      </div>
    ))}
  </div>
)
