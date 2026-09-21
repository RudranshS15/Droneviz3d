'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Mode = 'signin' | 'register'

export default function AdminLoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Already signed in? Admins go straight to the dashboard.
  useEffect(() => {
    fetch('/api/auth/me').then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      if (data.user) {
        router.replace(data.user.role === 'admin' ? '/droneviz3d/admin/dashboard' : '/droneviz3d')
      }
    }).catch(() => { /* offline / no session — stay on the form */ })
  }, [router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(mode === 'signin' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'signin'
            ? { email, password }
            : { email, password, bootstrapToken: bootstrapToken.trim() || undefined }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Request failed — try again')
        return
      }
      router.push(data.user?.role === 'admin' ? '/droneviz3d/admin/dashboard' : '/droneviz3d')
      router.refresh()
    } catch {
      setError('Network error — check that the server is running')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
        <h1 className="text-2xl font-bold text-[#e7e5e4] mb-1">Admin access</h1>
        <p className="text-[13px] text-[#a8a29e] mb-6">
          {mode === 'signin'
            ? 'Sign in to manage this DroneViz3D installation.'
            : 'Create an account. The first account on a new installation becomes the administrator — it needs the bootstrap token when the server asks for one.'}
        </p>

        <div className="flex gap-1 mb-6 p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]" role="tablist" aria-label="Sign in or create account">
          {(['signin', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => { setMode(m); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                mode === m ? 'bg-[#c27a3a] text-[#0c0a09]' : 'text-[#a8a29e] hover:text-white'
              }`}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="admin-email" className="block text-[12px] text-[#a8a29e] font-medium mb-1">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[#e7e5e4] text-[13px] font-mono placeholder:text-white/25 focus:outline-none focus:border-[#d4a053]"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-[12px] text-[#a8a29e] font-medium mb-1">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[#e7e5e4] text-[13px] font-mono placeholder:text-white/25 focus:outline-none focus:border-[#d4a053]"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label htmlFor="admin-bootstrap" className="block text-[12px] text-[#a8a29e] font-medium mb-1">
                Bootstrap token{' '}
                <span className="font-normal text-[#a8a29e]/70">— new installations only</span>
              </label>
              <input
                id="admin-bootstrap"
                type="password"
                autoComplete="off"
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                aria-describedby="admin-bootstrap-help"
                placeholder="Value of ADMIN_BOOTSTRAP_TOKEN"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[#e7e5e4] text-[13px] font-mono placeholder:text-white/25 focus:outline-none focus:border-[#d4a053]"
              />
              <p id="admin-bootstrap-help" className="mt-1 text-[11px] text-[#a8a29e]/80 leading-relaxed">
                Needed only when this installation has no administrator yet. An installation that
                already has one never asks for it.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-[14px] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a053]"
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-[11px] text-[#a8a29e]/80 leading-relaxed">
          Passwords are hashed with argon2id and stored only on this machine. Sessions are
          httpOnly cookies that expire after 7 days.
        </p>
      </div>
    </div>
  )
}