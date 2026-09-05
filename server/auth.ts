import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

const COOKIE = 'autotube_session'

const password = (): string | undefined => process.env.APP_PASSWORD

/** Token derivado de la contraseña: cambia si se cambia la contraseña y cierra las sesiones. */
const token = (): string => createHash('sha256').update(`autotube:${password() ?? ''}`).digest('hex')

const readCookie = (req: Request): string | undefined =>
  req.headers.cookie
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === COOKIE)?.[1]

const equals = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export const authEnabled = (): boolean => Boolean(password())

export const authorized = (req: Request): boolean => {
  if (!authEnabled()) return true
  const cookie = readCookie(req)
  return Boolean(cookie && equals(cookie, token()))
}

export const login = (req: Request, res: Response): boolean => {
  const body = req.body as { password?: string }
  if (!authEnabled() || !body.password || !equals(body.password, password() ?? '')) return false
  res.cookie(COOKIE, token(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https',
    maxAge: 30 * 24 * 3600 * 1000,
  })
  return true
}

export const guard = (req: Request, res: Response, next: NextFunction): void => {
  if (authorized(req)) return next()
  res.status(401).json({ error: 'No autorizado' })
}
