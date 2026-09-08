import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { listUsers, sessionCount, userCount } from '@/lib/db'
import { LogoutButton, UsersTable, ChangePasswordButton } from './admin-actions'

export const dynamic = 'force-dynamic'

const WORKER_URL = (process.env.WORKER_URL ?? 'http://127.0.0.1:8300').replace(/\/+$/, '')
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? ''

async function workerStatus(): Promise<{ reachable: boolean; detail?: string; model?: string; auth?: boolean }> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      headers: WORKER_TOKEN ? { Authorization: `Bearer ${WORKER_TOKEN}` } : {},
      signal: AbortSignal.timeout(3_000),
    })
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {}
    return { reachable: res.ok, model: String(body.model ?? ''), auth: Boolean(body.auth), detail: res.ok ? undefined : `HTTP ${res.status}` }
  } catch {
    return { reachable: false, detail: 'worker not running' }
  }
}

export default async function AdminDashboardPage() {
  // Server-side guard: this page only renders for authenticated admins.
  const user = await getSessionUser()
  if (!user) redirect('/droneviz3d/admin/login')
  if (user.role !== 'admin') redirect('/droneviz3d/admin/login')

  const users = listUsers()
  const worker = await workerStatus()

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 pt-10 pb-20">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-2">
              Admin dashboard
            </h1>
            <p className="text-[#a8a29e] text-[14px]">
              Signed in as <span className="text-[#e7e5e4] font-medium">{user.email}</span> ·{' '}
              {userCount()} users · {sessionCount()} active sessions
            </p>
          </div>
          <div className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <ChangePasswordButton />
              <LogoutButton />
            </div>
            <p className="text-[11px] text-[#a8a29e]/70 leading-relaxed">
              Role changes and password changes sign the affected sessions out immediately.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="text-[11px] text-[#a8a29e] uppercase tracking-wider font-medium mb-1">Users</div>
            <div className="text-2xl font-bold text-[#e7e5e4]">{users.length}</div>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="text-[11px] text-[#a8a29e] uppercase tracking-wider font-medium mb-1">Active sessions</div>
            <div className="text-2xl font-bold text-[#e7e5e4]">{sessionCount()}</div>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="text-[11px] text-[#a8a29e] uppercase tracking-wider font-medium mb-1">LocateAnything worker</div>
            <div className={`text-2xl font-bold ${worker.reachable ? 'text-green-300' : 'text-[#a8a29e]'}`}>
              {worker.reachable ? 'Online' : 'Offline'}
            </div>
            <div className="text-[11px] text-[#a8a29e] mt-1">
              {worker.reachable ? (worker.model || 'worker') : (worker.detail ?? 'unknown')}
              {worker.auth ? ' · auth enabled' : ''}
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
          <h2 className="text-[13px] font-semibold text-[#e7e5e4] mb-4">Registered users</h2>
          <UsersTable users={users} currentUserId={user.id} />
        </div>
      </div>
    </div>
  )
}