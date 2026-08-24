import { writeFile } from 'node:fs/promises'
import path from 'node:path'

type OpenverseImage = { url?: string; thumbnail?: string; width?: number; height?: number }
type OpenverseResponse = { results?: OpenverseImage[] }
type PexelsResponse = { photos?: { src?: { large2x?: string; large?: string } }[] }
type Orientation = 'portrait' | 'landscape'

const searchCache = new Map<string, string[]>()
const translationCache = new Map<string, string>()

const UA = { 'user-agent': 'autotube-studio/1.0' }

const STOPWORDS = new Set([
  'the', 'of', 'in', 'a', 'an', 'to', 'for', 'and', 'or', 'on', 'with', 'your', 'you', 'that', 'this', 'how', 'why',
  'best', 'benefits', 'tips',
])

/** Los buscadores de stock funcionan mucho mejor con consultas de una o dos palabras. */
const shorten = (query: string): string =>
  query
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 2)
    .join(' ') || query

/** Traduce la consulta al inglés (los bancos de imágenes indexan sobre todo en inglés). */
const toEnglish = async (query: string): Promise<string> => {
  const cached = translationCache.get(query)
  if (cached) return cached
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?${new URLSearchParams({ q: query, langpair: 'es|en' })}`,
      { headers: UA, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { responseData?: { translatedText?: string } }
    const text = data.responseData?.translatedText?.trim()
    const value = text && text.length > 1 ? text : query
    translationCache.set(query, value)
    return value
  } catch {
    return query
  }
}

const searchPexels = async (query: string, apiKey: string, orientation: Orientation): Promise<string[]> => {
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({
    query,
    per_page: '8',
    orientation,
    locale: 'es-ES',
  })}`
  const res = await fetch(url, { headers: { ...UA, authorization: apiKey }, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`pexels ${res.status}`)
  const data = (await res.json()) as PexelsResponse
  return (data.photos ?? []).flatMap((p) => {
    const src = p.src?.large2x ?? p.src?.large
    return src ? [src] : []
  })
}

const searchOpenverse = async (query: string, orientation: Orientation): Promise<string[]> => {
  const url = `https://api.openverse.org/v1/images/?${new URLSearchParams({
    q: shorten(await toEnglish(query)),
    page_size: '12',
    license_type: 'commercial',
    mature: 'false',
  })}`
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`openverse ${res.status}`)
  const data = (await res.json()) as OpenverseResponse

  return (data.results ?? [])
    .filter((r) => (r.width ?? 0) >= 700 && (r.height ?? 0) >= 500)
    .sort((a, b) => {
      const fits = (r: OpenverseImage) =>
        orientation === 'portrait' ? (r.height ?? 0) >= (r.width ?? 0) : (r.width ?? 0) >= (r.height ?? 0)
      return Number(fits(b)) - Number(fits(a))
    })
    .flatMap((r) => (r.url ? [r.url] : r.thumbnail ? [r.thumbnail] : []))
}

const search = async (query: string, orientation: Orientation): Promise<string[]> => {
  const key = `${orientation}:${query.toLowerCase()}`
  const hit = searchCache.get(key)
  if (hit) return hit

  const pexelsKey = process.env.PEXELS_API_KEY?.trim()
  let urls: string[] = []
  if (pexelsKey) {
    try {
      urls = await searchPexels(query, pexelsKey, orientation)
    } catch (err) {
      console.warn('[stock] Pexels no disponible:', (err as Error).message)
    }
  }
  if (urls.length === 0) urls = await searchOpenverse(query, orientation)

  searchCache.set(key, urls)
  return urls
}

const download = async (url: string, file: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength < 8000) return false
    await writeFile(file, buf)
    return true
  } catch {
    return false
  }
}

/**
 * Descarga una imagen de stock acorde a la escena. Prueba consultas de menos a más
 * genéricas y devuelve null si no hay nada usable (el render usa entonces un degradado).
 */
export const fetchStockImage = async (
  keywords: string[],
  topic: string,
  index: number,
  workDir: string,
  orientation: Orientation,
): Promise<string | null> => {
  const queries = [topic, `${topic} ${keywords[index % Math.max(1, keywords.length)] ?? ''}`, keywords[0] ?? '']
    .map((q) => q.trim())
    .filter(Boolean)
  const file = path.join(workDir, `stock-${index}.jpg`)

  for (const query of queries) {
    let urls: string[] = []
    try {
      urls = await search(query, orientation)
    } catch {
      continue
    }
    for (const url of urls.slice(index % Math.max(1, urls.length))) {
      if (await download(url, file)) return file
    }
  }
  return null
}
