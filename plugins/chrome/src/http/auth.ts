import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Logger } from '../logger.js'
export const MAX_ADMIN_BODY_BYTES = 1024
const digest = (value: string): Buffer => createHash('sha256').update(value).digest()
export function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected))
}
export function bearerFrom(header: string | undefined): string | null {
  if (typeof header !== 'string') return null
  const m = /^Bearer ([^\s]+)$/i.exec(header)
  return m ? m[1] : null
}
function bodyTooLarge(req: Request): boolean {
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    const n = Number(declared)
    return !Number.isFinite(n) || n > MAX_ADMIN_BODY_BYTES
  }
  if (req.body === undefined || req.body === null) return false
  try {
    return Buffer.byteLength(JSON.stringify(req.body), 'utf8') > MAX_ADMIN_BODY_BYTES
  } catch {
    return true
  }
}
export function createAuthMiddleware(
  token: string,
  adminToken: string,
  logger?: Logger,
): RequestHandler {
  if (token.length < 32) throw new Error('refusing to start the auth middleware with a short token')
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.headers.origin !== undefined) {
      logger?.warn('request refused', { reason: 'origin' })
      res.status(403).json({ error: 'forbidden' })
      return
    }
    const presented = bearerFrom(req.headers.authorization)
    if (presented === null || !tokensMatch(presented, req.path === '/mcp' ? token : adminToken)) {
      logger?.warn('request refused', { reason: 'unauthorized' })
      res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'unauthorized' })
      return
    }
    if (req.path !== '/mcp' && bodyTooLarge(req)) {
      logger?.warn('request refused', { reason: 'body-too-large' })
      res.status(413).json({ error: 'payload too large' })
      return
    }
    next()
  }
}
