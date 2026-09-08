'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface AdminUser {
  id: number
  email: string
  role: 'user' | 'admin'
  created_at: string
}

/**
 * Every mutating admin call must echo back the session's CSRF token, which the
 * server compares against the one stored for the session cookie. We fetch it
 * fresh from /api/auth/me on each call so it stays valid even right after a
 * password change rotates the session (and therefore the token).
 */
async function fetchWithCsrf(url: string, init: RequestInit = {}): Promise<Response> {
  const me = await fetch('/api/auth/me', { cache: 'no-store' })
  const data = await me.json().catch(() => ({}))
  const headers = new Headers(init.headers)
  if (typeof data.csrf === 'string' && data.csrf) {
    headers.set('X-CSRF-Token', data.csrf)
  }
  return fetch(url, { ...init, headers })
}

export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const logout = async () => {
    setBusy(true)
    await fetchWithCsrf('/api/auth/logout', { method: 'POST' }).catch(() => {})
    router.push('/droneviz3d/admin/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="px-4 py-2 rounded-lg border border-white/[0.15] text-[#e7e5e4] text-[13px] font-medium hover:bg-white/[0.04] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a053]"
    >
      Sign out
    </button>
  )
}

/** Change-password control: forces re-authentication with the current password. */
export function ChangePasswordButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (next !== confirm) {
      setError('New password and confirmation do not match')
      return
    }
    setBusy(true)
    try {
      const res = await fetchWithCsrf('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Password change failed')
        return
      }
      setCurrent(''); setNext(''); setConfirm('')
      setNotice('Password updated — all other sessions were signed out.')
      router.refresh() // re-render with the rotated session
    } catch {
      setError('Network error — check that the server is running')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { setOpen(!open); setError(null); setNotice(null) }}
        aria-expanded={open}
        className="px-4 py-2 rounded-lg border border-white/[0.15] text-[#e7e5e4] text-[13px] font-medium hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a053]"
      >
        Change password
      </button>

      {open && (
        <form
          onSubmit={submit}
          noValidate
          className="mt-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] w-full max-w-sm"
        >
          <p className="text-[12px] text-[#a8a29e] mb-4 leading-relaxed">
            For security you must confirm your current password. Changing it signs out every other session.
          </p>
          <div className="space-y-3">
            <div>
              <label htmlFor="cp-current" className="block text-[12px] text-[#a8a29e] font-medium mb-1">
                Current password
              </label>
              <input
                id="cp-current"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[#e7e5e4] text-[13px] font-mono focus:outline-none focus:border-[#d4a053]"
              />
            </div>
            <div>
              <label htmlFor="cp-new" className="block text-[12px] text-[#a8a29e] font-medium mb-1">
                New password
              </label>
              <input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[#e7e5e4] text-[13px] font-mono focus:outline-none focus:border-[#d4a053]"
              />
            </div>
            <div>
              <label htmlFor="cp-confirm" className="block text-[12px] text-[#a8a29e] font-medium mb-1">
                Confirm new password
              </label>
              <input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[#e7e5e4] text-[13px] font-mono focus:outline-none focus:border-[#d4a053]"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-3 text-[12px] text-green-300 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !current || !next || !confirm}
            className="mt-4 w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-[13px] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a053]"
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}
    </div>
  )
}

export function UsersTable({ users, currentUserId }: { users: AdminUser[]; currentUserId: number }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const act = async (u: AdminUser, what: 'remove' | 'promote' | 'demote') => {
    const label = what === 'remove'
      ? `Remove ${u.email}? This cannot be undone.`
      : `${what === 'promote' ? 'Promote' : 'Demote'} ${u.email}? Their sessions will be signed out.`
    if (!window.confirm(label)) return
    setError(null)
    setBusyId(u.id)
    try {
      const res = what === 'remove'
        ? await fetchWithCsrf(`/api/admin/users/${u.id}`, { method: 'DELETE' })
        : await fetchWithCsrf(`/api/admin/users/${u.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: what === 'promote' ? 'admin' : 'user' }),
          })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `${what} failed`)
        return
      }
      router.refresh()
    } catch {
      setError('Network error — request failed')
    } finally {
      setBusyId(null)
    }
  }

  const isSelf = (u: AdminUser) => u.id === currentUserId

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <table className="w-full text-left">
        <thead>
          <tr className="text-[11px] text-[#a8a29e] uppercase tracking-wider border-b border-white/[0.08]">
            <th scope="col" className="py-2 pr-4 font-medium">Email</th>
            <th scope="col" className="py-2 pr-4 font-medium">Role</th>
            <th scope="col" className="py-2 pr-4 font-medium">Created</th>
            <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-white/[0.05]">
              <td className="py-3 pr-4 text-[13px] text-[#e7e5e4] font-mono">
                {u.email}
                {isSelf(u) && <span className="ml-2 text-[10px] text-[#d4a053]">(you)</span>}
              </td>
              <td className="py-3 pr-4">
                <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                  u.role === 'admin' ? 'bg-[#c27a3a]/10 text-[#d4a053] border border-[#c27a3a]/40' : 'bg-white/[0.05] text-[#a8a29e] border border-white/[0.1]'
                }`}>
                  {u.role}
                </span>
              </td>
              <td className="py-3 pr-4 text-[12px] text-[#a8a29e] font-mono">{u.created_at}</td>
              <td className="py-3 text-right whitespace-nowrap">
                {!isSelf(u) && (
                  <button
                    type="button"
                    onClick={() => act(u, u.role === 'admin' ? 'demote' : 'promote')}
                    disabled={busyId === u.id}
                    aria-label={u.role === 'admin' ? `Demote ${u.email} to regular user` : `Promote ${u.email} to administrator`}
                    className="text-[12px] text-[#a8a29e] hover:text-[#d4a053] mr-4 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a053]"
                  >
                    {busyId === u.id ? 'Working…' : u.role === 'admin' ? 'Demote' : 'Promote'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => act(u, 'remove')}
                  disabled={isSelf(u) || busyId === u.id}
                  aria-label={`Remove user ${u.email}`}
                  className="text-[12px] text-[#a8a29e] hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && (
        <p className="text-[13px] text-[#a8a29e] py-4">No users registered yet.</p>
      )}
    </div>
  )
}
