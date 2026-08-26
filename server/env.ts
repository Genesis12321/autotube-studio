import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Carga un `.env` local (claves de API) sin dependencias externas. Las variables ya
 * definidas en el entorno tienen prioridad.
 */
export const loadEnv = (file = path.join(process.cwd(), '.env')): void => {
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return
  }

  for (const line of content.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}
