import path from 'node:path'
import { discard, saveStream } from './download'
import type { Credit } from './types'

type PexelsVideoFile = { link?: string; width?: number; height?: number; file_type?: string }
type PexelsVideo = {
  id: number
  duration?: number
  url?: string
  user?: { name?: string; url?: string }
  video_files?: PexelsVideoFile[]
}
type PexelsVideoResponse = { videos?: PexelsVideo[] }

type Orientation = 'portrait' | 'landscape'

const UA = { 'user-agent': 'autotube-studio/1.0' }

/** Clips ya usados por job, para que dos escenas no repitan el mismo plano. */
const usedClips = new Map<string, Set<number>>()

/** El menor archivo que aun así cubre el lienzo: descargar 4K por escena es tirar minutos de render. */
const pickFile = (video: PexelsVideo, orientation: Orientation): string | null => {
  const minSide = orientation === 'portrait' ? 1080 : 1920
  const usable = (video.video_files ?? [])
    .filter((f) => f.file_type === 'video/mp4' && (f.width ?? 0) > 0 && (f.height ?? 0) > 0)
    .filter((f) => (orientation === 'portrait' ? (f.height ?? 0) >= (f.width ?? 0) : (f.width ?? 0) >= (f.height ?? 0)))
    .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))
  const long = orientation === 'portrait' ? (f: PexelsVideoFile) => f.height ?? 0 : (f: PexelsVideoFile) => f.width ?? 0
  return (usable.find((f) => long(f) >= minSide) ?? usable.at(-1))?.link ?? null
}

const searchVideos = async (query: string, apiKey: string, orientation: Orientation): Promise<PexelsVideo[]> => {
  const url = `https://api.pexels.com/videos/search?${new URLSearchParams({
    query,
    per_page: '15',
    orientation,
    size: 'medium',
  })}`
  const res = await fetch(url, { headers: { ...UA, authorization: apiKey }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`pexels video ${res.status}`)
  return ((await res.json()) as PexelsVideoResponse).videos ?? []
}

/**
 * Descarga un clip de stock en movimiento para la escena (Pexels, licencia libre y comercial).
 * Devuelve null si no hay clave o ningún candidato sirve: el pipeline cae entonces a la foto.
 */
export const fetchStockClip = async (
  keywords: string[],
  topic: string,
  index: number,
  workDir: string,
  orientation: Orientation,
  minDuration: number,
  variant = 0,
): Promise<{ file: string; credit: Credit } | null> => {
  const apiKey = process.env.PEXELS_API_KEY?.trim()
  if (!apiKey) return null

  let used = usedClips.get(workDir)
  if (!used) {
    used = new Set()
    usedClips.set(workDir, used)
  }

  const keyword = keywords[(index + variant) % Math.max(1, keywords.length)] ?? ''
  const file = path.join(workDir, `clip-${index}${variant ? `-${variant}` : ''}.mp4`)

  for (const query of [`${keyword} ${topic}`, keyword, topic].map((q) => q.trim()).filter(Boolean)) {
    let videos: PexelsVideo[] = []
    try {
      videos = await searchVideos(query, apiKey, orientation)
    } catch {
      continue
    }

    // Los clips más largos que la escena evitan el bucle visible al repetir el plano.
    const candidates = [
      ...videos.filter((v) => (v.duration ?? 0) >= minDuration),
      ...videos.filter((v) => (v.duration ?? 0) < minDuration),
    ]

    for (const video of candidates) {
      if (used.has(video.id)) continue
      const link = pickFile(video, orientation)
      if (!link) continue
      used.add(video.id)
      try {
        const res = await fetch(link, { headers: UA, signal: AbortSignal.timeout(60000), redirect: 'follow' })
        if (!res.ok) continue
        const size = await saveStream(res, file)
        if (size < 100000) {
          await discard(file)
          continue
        }
        return {
          file,
          credit: {
            kind: 'video',
            author: video.user?.name ?? 'Pexels',
            source: 'Pexels',
            license: 'Pexels License',
            url: video.url,
          },
        }
      } catch {
        /* siguiente candidato */
      }
    }
  }
  return null
}
