import { useEffect, useRef, useState } from 'react'
import type { Job, JobInput } from '../server/types'

export type { Job, JobInput }

export type Session = { required: boolean; authorized: boolean }

export const getSession = async (): Promise<Session> => {
  const res = await fetch('/api/session')
  if (!res.ok) throw new Error('No se pudo comprobar la sesión')
  return (await res.json()) as Session
}

export const login = async (password: string): Promise<void> => {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Contraseña incorrecta')
}

export const createJob = async (input: JobInput): Promise<Job> => {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Error al crear el trabajo')
  return (await res.json()) as Job
}

export const selectThumb = async (id: string, index: number): Promise<void> => {
  await fetch(`/api/jobs/${id}/thumb`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ index }),
  })
}

const fileName = (job: Job): string =>
  `${(job.title ?? job.input.topic)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || job.id}.mp4`

/**
 * Guarda el vídeo en el teléfono. Compartir el archivo es la única vía web para llegar a la
 * galería (iOS y Android); si el navegador no lo soporta, se descarga desde el blob ya
 * cargado, porque `<a download>` sobre una URL protegida por cookie falla en varios móviles.
 */
export const saveVideo = async (job: Job): Promise<'shared' | 'downloaded'> => {
  const res = await fetch(`/api/jobs/${job.id}/download`)
  if (!res.ok) throw new Error('No se pudo descargar el vídeo')
  const name = fileName(job)
  const blob = await res.blob()
  const file = new File([blob], name, { type: 'video/mp4' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: job.title ?? job.input.topic })
      return 'shared'
    } catch (err) {
      // El usuario canceló la hoja de compartir: no tiene sentido descargarlo a la fuerza.
      if ((err as Error).name === 'AbortError') return 'shared'
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return 'downloaded'
}

export type Privacy = 'private' | 'unlisted' | 'public'
export type YoutubeStatus = { configured: boolean; connected: boolean; channel?: string }

export const youtubeStatus = async (): Promise<YoutubeStatus> => {
  const res = await fetch('/api/youtube/status')
  if (!res.ok) throw new Error('No se pudo consultar la conexión con YouTube')
  return (await res.json()) as YoutubeStatus
}

export const publishJob = async (id: string, privacy: Privacy): Promise<string> => {
  const res = await fetch(`/api/jobs/${id}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ privacy }),
  })
  const json = (await res.json()) as { url?: string; error?: string }
  if (!res.ok || !json.url) throw new Error(json.error ?? 'Error al subir a YouTube')
  return json.url
}

export const deleteJob = async (id: string): Promise<void> => {
  await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
}

/** Live job list backed by the server's SSE stream, with polling fallback. */
export const useJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const lastEventAt = useRef(0)

  useEffect(() => {
    const source = new EventSource('/api/stream')
    sourceRef.current = source

    source.addEventListener('snapshot', (event) => {
      lastEventAt.current = Date.now()
      setJobs(JSON.parse((event as MessageEvent<string>).data) as Job[])
      setConnected(true)
    })
    source.addEventListener('job', (event) => {
      lastEventAt.current = Date.now()
      const job = JSON.parse((event as MessageEvent<string>).data) as Job
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== job.id)
        return [job, ...next].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      })
    })
    source.onerror = () => setConnected(false)
    source.onopen = () => setConnected(true)

    // Algunos proxies (túneles, CDN) almacenan el SSE en búfer: refresco por sondeo.
    const poll = async () => {
      if (Date.now() - lastEventAt.current < 5000) return
      try {
        const res = await fetch('/api/jobs')
        if (!res.ok) return
        setJobs((await res.json()) as Job[])
        setConnected(true)
      } catch {
        setConnected(false)
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 2500)

    return () => {
      clearInterval(timer)
      source.close()
    }
  }, [])

  return { jobs, connected, setJobs }
}
