import { useEffect, useRef, useState } from 'react'
import type { Job, JobInput } from '../server/types'

export type { Job, JobInput }

export const createJob = async (input: JobInput): Promise<Job> => {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Error al crear el trabajo')
  return (await res.json()) as Job
}

export const deleteJob = async (id: string): Promise<void> => {
  await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
}

/** Live job list backed by the server's SSE stream, with polling fallback. */
export const useJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const source = new EventSource('/api/stream')
    sourceRef.current = source

    source.addEventListener('snapshot', (event) => {
      setJobs(JSON.parse((event as MessageEvent<string>).data) as Job[])
      setConnected(true)
    })
    source.addEventListener('job', (event) => {
      const job = JSON.parse((event as MessageEvent<string>).data) as Job
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== job.id)
        return [job, ...next].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      })
    })
    source.onerror = () => setConnected(false)
    source.onopen = () => setConnected(true)

    return () => source.close()
  }, [])

  return { jobs, connected, setJobs }
}
