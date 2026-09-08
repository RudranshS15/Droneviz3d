import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorized, forbidden } from '@/lib/auth'
import { adminApiLimiter, clientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { listUsers } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limited = adminApiLimiter(clientIp(req))
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec)

  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (user.role !== 'admin') return forbidden()

  return NextResponse.json({ users: listUsers() }, { headers: { 'Cache-Control': 'no-store' } })
}
