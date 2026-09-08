import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorized, forbidden } from '@/lib/auth'
import { adminApiLimiter, clientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { userCount, sessionCount } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WORKER_URL = (process.env.WORKER_URL ?? 'http://127.0.0.1:8300').replace(/\/+$/, '')
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? ''

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limited = adminApiLimiter(clientIp(req))
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec)

  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  let worker: { reachable: boolean; detail?: string; model?: string; auth?: boolean }
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      headers: WORKER_TOKEN ? { Authorization: `Bearer ${WORKER_TOKEN}` } : {},
      signal: AbortSignal.timeout(3_000),
    })
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {}
    worker = { reachable: res.ok, model: String(body.model ?? ''), auth: Boolean(body.auth), detail: res.ok ? undefined : `HTTP ${res.status}` }
  } catch {
    worker = { reachable: false, detail: 'worker not running' }
  }

  return NextResponse.json(
    {
      users: userCount(),
      sessions: sessionCount(),
      worker,
      db: { engine: 'sqlite (node:sqlite)', path: 'data/droneviz3d.db' },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
