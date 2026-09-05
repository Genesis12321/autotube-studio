import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Credit } from './types'

type OpenverseImage = {
  url?: string
  thumbnail?: string
  width?: number
  height?: number
  title?: string
  creator?: string
  license?: string
  license_version?: string
  foreign_landing_url?: string
  source?: string
  tags?: { name?: string }[]
}
type OpenverseResponse = { results?: OpenverseImage[] }
type PexelsResponse = {
  photos?: { alt?: string; url?: string; photographer?: string; src?: { large2x?: string; large?: string } }[]
}
type Orientation = 'portrait' | 'landscape'
type CommonsImageInfo = { thumburl?: string; url?: string; width?: number; height?: number }
type CommonsResponse = {
  query?: { pages?: Record<string, { title?: string; imageinfo?: CommonsImageInfo[] }> }
}
/**
 * Candidata con el texto (título y etiquetas) que permite medir si ilustra la escena y un
 * `bonus` por la calidad de la fuente (la fotografía de stock vale más que el archivo suelto).
 */
type StockResult = { url: string; text: string; bonus: number; credit: Credit }

/** Fuentes de Openverse que sí son fotografía de stock, no archivo ni escaneos de museo. */
const STOCK_SOURCES = 'stocksnap,rawpixel,nappy,wordpress'

const searchCache = new Map<string, StockResult[]>()
/** URLs ya usadas por job, para que dos escenas no repitan la misma foto. */
const usedUrls = new Map<string, Set<string>>()
const translationCache = new Map<string, string>()

const UA = { 'user-agent': 'autotube-studio/1.0' }

const STOPWORDS = new Set([
  'the', 'of', 'in', 'a', 'an', 'to', 'for', 'and', 'or', 'on', 'with', 'your', 'you', 'that', 'this', 'how', 'why',
  'best', 'benefits', 'tips', 'about', 'from', 'more', 'most', 'very', 'thing', 'things', 'people', 'really',
  'everything', 'nothing', 'always', 'never', 'know', 'make', 'want', 'need', 'much', 'many', 'first', 'second',
  'third', 'because', 'when', 'what', 'they', 'their', 'day', 'days', 'time', 'week', 'minutes',
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

const fitsOrientation = (img: { width?: number; height?: number }, orientation: Orientation): boolean =>
  orientation === 'portrait' ? (img.height ?? 0) >= (img.width ?? 0) : (img.width ?? 0) >= (img.height ?? 0)

const terms = (query: string): string[] =>
  Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
    ),
  )

/** Cuántos términos de la consulta aparecen en el título o las etiquetas de la imagen. */
const relevance = (result: StockResult, queryTerms: string[]): number => {
  const text = result.text.toLowerCase()
  // Compara por raíz para tolerar plurales y derivados ("running" ~ "runner").
  return queryTerms.filter((t) => text.includes(t.slice(0, Math.max(4, t.length - 2)))).length
}

const searchPexels = async (
  query: string,
  apiKey: string,
  orientation: Orientation,
): Promise<StockResult[]> => {
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({
    query,
    per_page: '20',
    orientation,
    locale: 'es-ES',
  })}`
  const res = await fetch(url, { headers: { ...UA, authorization: apiKey }, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`pexels ${res.status}`)
  const data = (await res.json()) as PexelsResponse
  return (data.photos ?? []).flatMap((p) => {
    const src = p.src?.large2x ?? p.src?.large
    return src
      ? [
          {
            url: src,
            text: p.alt ?? query,
            bonus: 2,
            credit: {
              kind: 'image' as const,
              author: p.photographer ?? 'Pexels',
              source: 'Pexels',
              license: 'Pexels License',
              url: p.url,
            },
          },
        ]
      : []
  })
}

let openverseToken: { value: string; expiresAt: number } | null = null

/** Openverse exige OAuth: pide (y cachea) un token de cliente si hay credenciales. */
export const openverseAuth = async (): Promise<Record<string, string>> => {
  const clientId = process.env.OPENVERSE_CLIENT_ID?.trim()
  const clientSecret = process.env.OPENVERSE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return {}
  if (openverseToken && openverseToken.expiresAt > Date.now()) {
    return { authorization: `Bearer ${openverseToken.value}` }
  }

  const res = await fetch('https://api.openverse.org/v1/auth_tokens/token/', {
    method: 'POST',
    headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`openverse auth ${res.status}`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('openverse auth sin token')

  openverseToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 900 }
  return { authorization: `Bearer ${openverseToken.value}` }
}

/**
 * Openverse. `source` acota el índice: sin filtro mezcla grabados, pinturas y escaneos de museo
 * que no ilustran una escena; con `STOCK_SOURCES` devuelve fotografía de stock de verdad.
 */
const searchOpenverse = async (
  query: string,
  orientation: Orientation,
  source: string | null,
  bonus: number,
): Promise<StockResult[]> => {
  const url = `https://api.openverse.org/v1/images/?${new URLSearchParams({
    q: shorten(await toEnglish(query)),
    page_size: '40',
    license_type: 'commercial',
    mature: 'false',
    ...(source ? { source } : {}),
  })}`
  const res = await fetch(url, {
    headers: { ...UA, ...(await openverseAuth()) },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`openverse ${res.status}`)
  const data = (await res.json()) as OpenverseResponse

  return (data.results ?? [])
    .filter((r) => (r.width ?? 0) >= 600 && (r.height ?? 0) >= 400)
    .sort((a, b) => Number(fitsOrientation(b, orientation)) - Number(fitsOrientation(a, orientation)))
    .flatMap((r) => {
      const src = r.url ?? r.thumbnail
      const text = [r.title ?? '', ...(r.tags ?? []).map((t) => t.name ?? '')].join(' ')
      return src
        ? [
            {
              url: src,
              text,
              bonus,
              credit: {
                kind: 'image' as const,
                author: r.creator ?? 'Desconocido',
                source: r.source ?? 'Openverse',
                license: [r.license?.toUpperCase(), r.license_version].filter(Boolean).join(' '),
                url: r.foreign_landing_url,
              },
            },
          ]
        : []
    })
}

/** Wikimedia Commons: sin API key y con fotografía real bastante más relevante que Openverse. */
const searchCommons = async (query: string, orientation: Orientation): Promise<StockResult[]> => {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `filetype:bitmap ${shorten(await toEnglish(query))}`,
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|size',
    iiurlwidth: '1600',
  })}`
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`commons ${res.status}`)
  const data = (await res.json()) as CommonsResponse

  return Object.values(data.query?.pages ?? {})
    .flatMap((page) => (page.imageinfo ?? []).map((info) => ({ info, title: page.title ?? '' })))
    .filter(({ info }) => (info.width ?? 0) >= 900 && (info.height ?? 0) >= 600)
    .sort((a, b) => Number(fitsOrientation(b.info, orientation)) - Number(fitsOrientation(a.info, orientation)))
    .flatMap(({ info, title }) => {
      const src = info.thumburl ?? info.url
      return src
        ? [
            {
              url: src,
              text: title,
              bonus: 0,
              credit: {
                kind: 'image' as const,
                author: title.replace(/^File:/, ''),
                source: 'Wikimedia Commons',
                url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
              },
            },
          ]
        : []
    })
}

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

const search = async (query: string, orientation: Orientation): Promise<StockResult[]> => {
  const key = `${orientation}:${query.toLowerCase()}`
  const hit = searchCache.get(key)
  if (hit) return hit

  const pexelsKey = process.env.PEXELS_API_KEY?.trim()
  const results: StockResult[] = []
  const add = async (label: string, fn: () => Promise<StockResult[]>): Promise<void> => {
    // Los bancos pequeños se quedan cortos en muchos temas: se acumulan por orden de calidad.
    if (results.length >= 24) return
    try {
      results.push(...(await fn()))
    } catch (err) {
      console.warn(`[stock] ${label} no disponible:`, (err as Error).message)
    }
  }

  if (pexelsKey) await add('Pexels', () => searchPexels(query, pexelsKey, orientation))
  await add('Openverse stock', () => searchOpenverse(query, orientation, STOCK_SOURCES, 2))
  await add('Openverse Flickr', () => searchOpenverse(query, orientation, 'flickr', 0))
  await add('Commons', () => searchCommons(query, orientation))
  if (results.length === 0) await add('Openverse', () => searchOpenverse(query, orientation, null, 0))

  searchCache.set(key, results)
  return results
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
 * Descarga una imagen de stock acorde a la escena: puntúa cada candidata por cuántos términos
 * del tema y de la escena aparecen en su título o etiquetas, y descarta las que no mencionan
 * el tema. Devuelve null si no hay nada usable (el render usa entonces un degradado).
 */
export const fetchStockImage = async (
  keywords: string[],
  topic: string,
  index: number,
  workDir: string,
  orientation: Orientation,
  variant = 0,
): Promise<{ file: string; credit: Credit } | null> => {
  const keyword = keywords[(index + variant) % Math.max(1, keywords.length)] ?? ''
  const queries = [`${topic} ${keyword}`, topic, keyword].map((q) => q.trim()).filter(Boolean)
  const file = path.join(workDir, `stock-${index}${variant ? `-${variant}` : ''}.jpg`)
  let used = usedUrls.get(workDir)
  if (!used) {
    used = new Set()
    usedUrls.set(workDir, used)
  }

  const topicTerms = terms(await toEnglish(topic))
  const sceneTerms = keyword ? terms(await toEnglish(keyword)) : []

  for (const query of queries) {
    let results: StockResult[] = []
    try {
      results = await search(query, orientation)
    } catch {
      continue
    }

    // El sujeto del tema ("correr" en "beneficios de correr por la mañana") es obligatorio:
    // sin él acaban colándose paisajes que solo coinciden con la palabra secundaria.
    const subject = topicTerms.slice(0, 1)
    const ranked = results
      .map((result) => ({
        result,
        score: relevance(result, topicTerms) * 2 + relevance(result, sceneTerms) + result.bonus,
      }))
      .filter((r) => subject.length === 0 || relevance(r.result, subject) > 0)
      .sort((a, b) => b.score - a.score)

    for (const { result } of ranked) {
      if (used.has(result.url)) continue
      used.add(result.url)
      if (await download(result.url, file)) return { file, credit: result.credit }
    }
  }

  // Último recurso: cualquier resultado del tema, aunque se repita, antes que caer al degradado.
  const pool = await search(topic, orientation).catch(() => [] as StockResult[])
  const fallback = pool
    .map((result) => ({ result, score: relevance(result, topicTerms) + result.bonus }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.result)
  const offset = index % Math.max(1, fallback.length)
  for (const result of [...fallback.slice(offset), ...fallback.slice(0, offset)]) {
    if (await download(result.url, file)) return { file, credit: result.credit }
  }
  return null
}
