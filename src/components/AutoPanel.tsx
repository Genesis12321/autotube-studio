import { useEffect, useState } from 'react'
import { CalendarClock, LifeBuoy, Loader2, MonitorPlay, Music2 } from 'lucide-react'
import {
  disconnectTiktok,
  disconnectYoutube,
  getDaySlots,
  getSchedule,
  redoSlots,
  saveSchedule,
  tiktokStatus,
  youtubeStatus,
  type DaySlot,
  type Privacy,
  type Schedule,
  type ScheduleSlot,
  type TiktokStatus,
  type YoutubeStatus,
} from '../api'

const PRIVACY_LABEL: Record<Privacy, string> = {
  private: 'Privado',
  unlisted: 'Oculto',
  public: 'Público',
}

type Props = { onMessage: (text: string, kind?: 'ok' | 'error' | 'info') => void }

const JOB_LABEL: Record<NonNullable<DaySlot['job']>['status'], string> = {
  queued: 'En cola',
  running: 'Creándose',
  done: 'Hecho',
  error: 'Falló',
  canceled: 'Cancelado',
}

/** `AAAA-MM-DD` de hoy (0) o ayer (1) en la zona del programador. */
const dayIn = (timezone: string, daysAgo: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(Date.now() - daysAgo * 86_400_000))

const slotState = (slot: DaySlot): string => {
  if (slot.job?.youtubeId) return 'Subido'
  if (slot.job) return slot.job.uploadError ? `Sin subir: ${slot.job.uploadError}` : JOB_LABEL[slot.job.status]
  return slot.uploaded ? 'Consta como subido' : 'No está'
}

const MissingVideos = ({ timezone, onMessage }: { timezone: string } & Props) => {
  const [open, setOpen] = useState(false)
  const [daysAgo, setDaysAgo] = useState(0)
  const [slots, setSlots] = useState<DaySlot[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const day = dayIn(timezone, daysAgo)

  const show = (ago: number) => {
    setOpen(true)
    setDaysAgo(ago)
    setSlots(null)
    setPicked([])
    void getDaySlots(dayIn(timezone, ago))
      .then(setSlots)
      .catch((err: Error) => onMessage(err.message, 'error'))
  }

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => (on ? [...prev, id] : prev.filter((p) => p !== id)))

  const redo = async () => {
    const already = slots?.filter((s) => picked.includes(s.id) && s.uploaded) ?? []
    if (
      already.length > 0 &&
      !window.confirm(
        `${already.map((s) => s.time).join(', ')} ya consta como subido. Rehazlo solo si no está en YouTube Studio. ¿Seguir?`,
      )
    )
      return
    setBusy(true)
    try {
      const launched = await redoSlots(day, picked)
      onMessage(`Se están creando ${launched.length} vídeo(s); se suben solos al terminar`, 'ok')
      setSlots(await getDaySlots(day))
      setPicked([])
    } catch (err) {
      onMessage((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary w-full" onClick={() => show(0)}>
        <LifeBuoy size={16} /> ¿Te falta algún vídeo?
      </button>
    )
  }

  return (
    <section className="card space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LifeBuoy size={16} className="text-brand-400" />
          <p className="text-sm font-semibold">¿Te falta algún vídeo?</p>
        </div>
        <button type="button" className="text-xs text-amber-100/60" onClick={() => setOpen(false)}>
          Cerrar
        </button>
      </header>
      <div className="flex gap-2">
        {['Hoy', 'Ayer'].map((label, i) => (
          <button
            key={label}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs ${daysAgo === i ? 'bg-brand-500 text-ink-900' : 'bg-ink-600'}`}
            onClick={() => show(i)}
          >
            {label}
          </button>
        ))}
      </div>
      {!slots ? (
        <p className="text-xs text-amber-100/45">Revisando...</p>
      ) : (
        <ul className="space-y-2">
          {slots.map((slot) => (
            <li key={slot.id}>
              <label className="flex items-center gap-3 rounded-xl bg-ink-700/60 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  disabled={Boolean(slot.job)}
                  checked={picked.includes(slot.id)}
                  onChange={(e) => toggle(slot.id, e.target.checked)}
                />
                <span className="font-semibold">{slot.time}</span>
                <span className="text-xs text-amber-100/60">
                  {slot.format === 'vertical' ? 'Short' : 'Largo'} · {slotState(slot)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-amber-100/45">
        Marca los que no veas en YouTube Studio. Si su hora ya pasó, se publican en cuanto terminen.
      </p>
      <button type="button" className="btn-primary w-full" disabled={busy || picked.length === 0} onClick={redo}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <LifeBuoy size={16} />} Rehacer y subir
      </button>
    </section>
  )
}

export const AutoPanel = ({ onMessage }: Props) => {
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [yt, setYt] = useState<YoutubeStatus | null>(null)
  const [tt, setTt] = useState<TiktokStatus | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getSchedule().then(setSchedule).catch(() => undefined)
    void youtubeStatus().then(setYt).catch(() => undefined)
    void tiktokStatus().then(setTt).catch(() => undefined)
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
      <MissingVideos timezone={schedule.timezone} onMessage={onMessage} />

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

      <section className="card space-y-3">
        <header className="flex items-center gap-2">
          <Music2 size={16} className="text-brand-400" />
          <p className="text-sm font-semibold">TikTok (solo shorts)</p>
        </header>
        {!tt?.configured ? (
          <p className="text-xs text-amber-100/60">
            Faltan las credenciales de TikTok (Client Key y Secret) en el servidor.
          </p>
        ) : tt.connected ? (
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-amber-100/60">Conectado{tt.user ? `: ${tt.user}` : ''}</p>
            <button
              type="button"
              className="rounded-lg bg-ink-600 px-3 py-1.5 text-xs"
              onClick={async () => setTt(await disconnectTiktok())}
            >
              Desconectar
            </button>
          </div>
        ) : (
          <a className="btn-primary inline-flex" href="/api/tiktok/auth">
            <Music2 size={16} /> Conectar TikTok
          </a>
        )}
      </section>

      <section className="card space-y-4">
        <header className="flex items-center gap-2">
          <CalendarClock size={16} className="text-brand-400" />
          <p className="text-sm font-semibold">Vídeos automáticos</p>
        </header>

        <label className="flex items-center justify-between gap-3 text-sm">
          Publicar en YouTube a estas horas
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-3 text-sm">
          Subirlos solos a YouTube
          <input
            type="checkbox"
            checked={schedule.autoPublish}
            onChange={(e) => setSchedule({ ...schedule, autoPublish: e.target.checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-3 text-sm">
          Publicar los shorts también en TikTok
          <input
            type="checkbox"
            checked={schedule.tiktok !== false}
            onChange={(e) => setSchedule({ ...schedule, tiktok: e.target.checked })}
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
              <select
                className="rounded-lg bg-ink-800 px-2 py-1 text-sm"
                value={slot.youtube === false ? 'no' : 'si'}
                onChange={(e) => patchSlot(slot.id, { youtube: e.target.value === 'si' })}
              >
                <option value="si">Sube a YouTube</option>
                <option value="no">Solo biblioteca</option>
              </select>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-amber-100/45">
          Horario de {schedule.timezone}. El tema y el título los elige la IA en cada vídeo. En TikTok no hay
          programación: el short se publica a su hora, ya renderizado.
        </p>

        <button type="button" className="btn-primary w-full" disabled={saving} onClick={save}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />} Guardar
        </button>
      </section>
    </div>
  )
}
