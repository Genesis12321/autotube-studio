import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, MonitorPlay } from 'lucide-react'
import {
  disconnectYoutube,
  getSchedule,
  saveSchedule,
  youtubeStatus,
  type Privacy,
  type Schedule,
  type ScheduleSlot,
  type YoutubeStatus,
} from '../api'

const PRIVACY_LABEL: Record<Privacy, string> = {
  private: 'Privado',
  unlisted: 'Oculto',
  public: 'Público',
}

type Props = { onMessage: (text: string, kind?: 'ok' | 'error' | 'info') => void }

export const AutoPanel = ({ onMessage }: Props) => {
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [yt, setYt] = useState<YoutubeStatus | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getSchedule().then(setSchedule).catch(() => undefined)
    void youtubeStatus().then(setYt).catch(() => undefined)
  }, [])

  const patchSlot = (id: string, patch: Partial<ScheduleSlot>) =>
    setSchedule((prev) =>
      prev ? { ...prev, slots: prev.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : prev,
    )

  const save = async () => {
    if (!schedule) return
    setSaving(true)
    try {
      setSchedule(await saveSchedule(schedule))
      onMessage('Programación guardada', 'ok')
    } catch (err) {
      onMessage((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!schedule) return <p className="text-sm text-amber-100/45">Cargando programación...</p>

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <header className="flex items-center gap-2">
          <MonitorPlay size={16} className="text-brand-400" />
          <p className="text-sm font-semibold">YouTube</p>
        </header>
        {!yt?.configured ? (
          <p className="text-xs text-amber-100/60">
            Faltan las credenciales de Google (Client ID y Secret) en el servidor.
          </p>
        ) : yt.connected ? (
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-amber-100/60">Conectado{yt.channel ? `: ${yt.channel}` : ''}</p>
            <button
              type="button"
              className="rounded-lg bg-ink-600 px-3 py-1.5 text-xs"
              onClick={async () => setYt(await disconnectYoutube())}
            >
              Desconectar
            </button>
          </div>
        ) : (
          <a className="btn-primary inline-flex" href="/api/youtube/auth">
            <MonitorPlay size={16} /> Conectar mi canal
          </a>
        )}
      </section>

      <section className="card space-y-4">
        <header className="flex items-center gap-2">
          <CalendarClock size={16} className="text-brand-400" />
          <p className="text-sm font-semibold">Vídeos automáticos</p>
        </header>

        <label className="flex items-center justify-between gap-3 text-sm">
          Crear vídeos solo a estas horas
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-3 text-sm">
          Subirlos a YouTube al terminar
          <input
            type="checkbox"
            checked={schedule.autoPublish}
            onChange={(e) => setSchedule({ ...schedule, autoPublish: e.target.checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-3 text-sm">
          Visibilidad
          <select
            className="rounded-lg bg-ink-700 px-2 py-1 text-sm"
            value={schedule.privacy}
            onChange={(e) => setSchedule({ ...schedule, privacy: e.target.value as Privacy })}
          >
            {(Object.keys(PRIVACY_LABEL) as Privacy[]).map((p) => (
              <option key={p} value={p}>
                {PRIVACY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        <ul className="space-y-2">
          {schedule.slots.map((slot) => (
            <li key={slot.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-700/60 px-3 py-2">
              <input
                type="checkbox"
                checked={slot.enabled}
                onChange={(e) => patchSlot(slot.id, { enabled: e.target.checked })}
              />
              <input
                type="time"
                className="rounded-lg bg-ink-800 px-2 py-1 text-sm"
                value={slot.time}
                onChange={(e) => patchSlot(slot.id, { time: e.target.value })}
              />
              <select
                className="rounded-lg bg-ink-800 px-2 py-1 text-sm"
                value={slot.format}
                onChange={(e) => patchSlot(slot.id, { format: e.target.value as ScheduleSlot['format'] })}
              >
                <option value="vertical">Short 9:16</option>
                <option value="horizontal">Largo 16:9</option>
              </select>
              <select
                className="rounded-lg bg-ink-800 px-2 py-1 text-sm"
                value={slot.targetDuration}
                onChange={(e) => patchSlot(slot.id, { targetDuration: Number(e.target.value) })}
              >
                {[30, 45, 60, 120, 300, 480, 540, 600].map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d}s` : `${Math.round(d / 60)} min`}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-amber-100/45">
          Horario de {schedule.timezone}. El tema y el título los elige la IA en cada vídeo.
        </p>

        <button type="button" className="btn-primary w-full" disabled={saving} onClick={save}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />} Guardar
        </button>
      </section>
    </div>
  )
}
