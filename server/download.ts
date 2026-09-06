import { createWriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Guarda la respuesta en disco por streaming; los clips no caben en memoria en instancias pequeñas. */
export const saveStream = async (res: Response, file: string): Promise<number> => {
  if (!res.body) throw new Error('respuesta sin cuerpo')
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(file))
  const { size } = await stat(file)
  return size
}

export const discard = async (file: string): Promise<void> => {
  await unlink(file).catch(() => undefined)
}
