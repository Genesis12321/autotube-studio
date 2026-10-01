/**
 * Variables de entorno del propio servicio de Render, leídas y escritas por su API.
 * El disco se borra en cada reinicio y `process.env` solo se refresca al desplegar,
 * así que el valor vigente hay que pedirlo a la API.
 */
const endpoint = (key: string): string | null => {
  const service = process.env.RENDER_SERVICE_ID
  return process.env.RENDER_API_KEY && service
    ? `https://api.render.com/v1/services/${service}/env-vars/${key}`
    : null
}

const headers = (): Record<string, string> => ({
  authorization: `Bearer ${process.env.RENDER_API_KEY}`,
  'content-type': 'application/json',
})

export const readRenderVar = async (key: string): Promise<string> => {
  const url = endpoint(key)
  if (url) {
    try {
      const res = await fetch(url, { headers: headers() })
      if (res.ok) {
        const value = ((await res.json()) as { value?: string }).value ?? ''
        process.env[key] = value
        return value
      }
      if (res.status === 404) return process.env[key] ?? ''
      console.warn(`[render-env] no se pudo leer ${key}`, res.status)
    } catch (err) {
      console.warn(`[render-env] no se pudo leer ${key}`, (err as Error).message)
    }
  }
  return process.env[key] ?? ''
}

export const writeRenderVar = async (key: string, value: string): Promise<void> => {
  process.env[key] = value
  const url = endpoint(key)
  if (!url) return
  const res = await fetch(url, { method: 'PUT', headers: headers(), body: JSON.stringify({ value }) })
  if (!res.ok) console.warn(`[render-env] no se pudo guardar ${key}`, res.status)
}
