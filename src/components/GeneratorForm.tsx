import { useState } from 'react'
import { Loader2, Smartphone, Monitor, Sparkles, Wand2 } from 'lucide-react'
import type { JobInput, VideoFormat, VoiceId } from '../../server/types'

const VOICES: { id: VoiceId; label: string; desc: string }[] = [
  { id: 'slt', label: 'Aura', desc: 'Femenina · España' },
  { id: 'kal16', label: 'Nova', desc: 'Masculina · España' },
  { id: 'awb', label: 'Orion', desc: 'Masculina · México' },
  { id: 'rms', label: 'Vega', desc: 'Femenina · Argentina' },
]

const TONES = ['divulgativo', 'motivacional', 'misterioso', 'humor', 'noticias']
const SHORT_DURATIONS = [30, 45, 60, 90]
const LONG_DURATIONS = [300, 480, 540, 600]

const durationLabel = (seconds: number): string =>
  seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)} min`

type Props = {
  busy: boolean
  onSubmit: (input: JobInput) => void
}

export const GeneratorForm = ({ busy, onSubmit }: Props) => {
  const [topic, setTopic] = useState('')
  const [script, setScript] = useState('')
  const [format, setFormat] = useState<VideoFormat>('vertical')
  const [voice, setVoice] = useState<VoiceId>('slt')
  const [tone, setTone] = useState(TONES[0])
  const [targetDuration, setTargetDuration] = useState(45)
  const [showScript, setShowScript] = useState(false)

  const submit = () => onSubmit({ topic, script: script || undefined, format, voice, tone, targetDuration })

  return (
    <div className="space-y-4 animate-fade-in">
      <section className="card space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-amber-100/60">Idea o temática</label>
        <input
          className="field"
          placeholder="Ej. 3 hábitos que multiplican tu productividad"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShowScript((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-brand-400"
        >
          <Wand2 size={14} />
          {showScript ? 'Usar guión automático' : 'Tengo mi propio guión'}
        </button>
        {showScript && (
          <textarea
            className="field min-h-[120px] resize-y"
            placeholder="Pega aquí tu guión. Lo dividiré en escenas automáticamente."
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-100/60">Formato</p>
          <div className="flex gap-2">
            {([
              { id: 'vertical', label: 'Shorts / Reels', icon: Smartphone, hint: '9:16' },
              { id: 'horizontal', label: 'YouTube', icon: Monitor, hint: '16:9' },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFormat(opt.id)}
                className={`chip flex flex-col items-center gap-1 py-3 ${
                  format === opt.id
                    ? 'border-brand-500 bg-brand-500/15 text-brand-400'
                    : 'border-brand-500/15 bg-ink-700 text-amber-100/60'
                }`}
              >
                <opt.icon size={18} />
                {opt.label}
                <span className="text-[10px] text-amber-100/45">{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-100/60">Voz IA (TTS)</p>
          <div className="grid grid-cols-2 gap-2">
            {VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVoice(v.id)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  voice === v.id ? 'border-brand-500 bg-brand-500/15' : 'border-brand-500/15 bg-ink-700'
                }`}
              >
                <span className="block text-sm font-medium">{v.label}</span>
                <span className="block text-[11px] text-amber-100/45">{v.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-100/60">Tono</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs capitalize ${
                  tone === t ? 'border-brand-500 bg-brand-500/15 text-brand-400' : 'border-brand-500/15 bg-ink-700 text-amber-100/60'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-100/60">
            Duración objetivo · <span className="text-brand-400">{durationLabel(targetDuration)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {[...SHORT_DURATIONS, ...LONG_DURATIONS].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setTargetDuration(d)}
                className={`chip ${
                  targetDuration === d
                    ? 'border-brand-500 bg-brand-500/15 text-brand-400'
                    : 'border-brand-500/15 bg-ink-700 text-amber-100/60'
                }`}
              >
                {durationLabel(d)}
              </button>
            ))}
          </div>
          {targetDuration >= 300 && (
            <p className="mt-2 text-[11px] text-amber-100/45">
              Los vídeos largos tardan varios minutos en renderizarse; puedes seguir el progreso aquí mismo.
            </p>
          )}
        </div>
      </section>

      <button className="btn-primary" disabled={busy || (!topic.trim() && !script.trim())} onClick={submit}>
        {busy ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
        {busy ? 'Generando...' : 'Generar vídeo'}
      </button>
    </div>
  )
}
