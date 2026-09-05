import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureDir } from './render'
import { openverseAuth } from './stock'
import type { Credit } from './types'

type OpenverseAudio = {
  url?: string
  duration?: number
  title?: string
  creator?: string
  license?: string
  license_version?: string
  foreign_landing_url?: string
  source?: string
}

const UA = { 'user-agent': 'autotube-studio/1.0' }

/** Consulta de música por tono: todas devuelven pistas con licencia de uso comercial. */
const QUERY_BY_TONE: Record<string, string> = {
  energetico: 'upbeat energetic instrumental',
  motivador: 'inspiring uplifting instrumental',
  misterioso: 'dark cinematic ambient',
  educativo: 'calm corporate instrumental',
  cercano: 'soft acoustic instrumental',
  humoristico: 'playful happy instrumental',
}

const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  )

const searchAudio = async (query: string, source: string): Promise<OpenverseAudio[]> => {
  const url = `https://api.openverse.org/v1/audio/?${new URLSearchParams({
    q: query,
    page_size: '12',
    license_type: 'commercial',
    source,
  })}`
  const res = await fetch(url, { headers: { ...UA, ...(await openverseAuth()) }, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`openverse audio ${res.status}`)
  const data = (await res.json()) as { results?: OpenverseAudio[] }
  return data.results ?? []
}

/**
 * Descarga (y cachea entre jobs) una pista libre acorde al tono. Devuelve null si no hay
 * ninguna disponible: el vídeo se monta igual, solo que sin música.
 */
export const fetchMusicTrack = async (
  tone: string,
  cacheDir: string,
): Promise<{ file: string; credit: Credit } | null> => {
  const query = QUERY_BY_TONE[tone] ?? QUERY_BY_TONE.educativo
  const file = path.join(cacheDir, `${tone}.mp3`)
  // El crédito se guarda junto a la pista cacheada: sin él no se puede atribuir en jobs futuros.
  const creditFile = `${file}.json`
  if ((await exists(file)) && (await exists(creditFile))) {
    return { file, credit: JSON.parse(await readFile(creditFile, 'utf8')) as Credit }
  }

  await ensureDir(cacheDir)
  for (const source of ['jamendo', 'wikimedia_audio']) {
    let results: OpenverseAudio[] = []
    try {
      results = await searchAudio(query, source)
    } catch (err) {
      console.warn(`[music] ${source} no disponible:`, (err as Error).message)
      continue
    }

    // Pistas largas: se recortan al vídeo y evitan bucles audibles en los vídeos de 8-9 min.
    for (const track of results.filter((t) => (t.duration ?? 0) >= 90000)) {
      if (!track.url) continue
      try {
        const res = await fetch(track.url, { headers: UA, signal: AbortSignal.timeout(30000), redirect: 'follow' })
        if (!res.ok) continue
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.byteLength < 200000) continue
        const credit: Credit = {
          kind: 'music',
          author: track.creator ?? 'Desconocido',
          source: track.source ?? source,
          license: [track.license?.toUpperCase(), track.license_version].filter(Boolean).join(' '),
          url: track.foreign_landing_url,
        }
        await writeFile(file, buf)
        await writeFile(creditFile, JSON.stringify(credit), 'utf8')
        return { file, credit }
      } catch {
        /* siguiente candidata */
      }
    }
  }
  return null
}
