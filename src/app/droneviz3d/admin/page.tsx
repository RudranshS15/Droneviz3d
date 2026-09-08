import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function AdminIndexPage() {
  const user = await getSessionUser()
  redirect(user?.role === 'admin' ? '/droneviz3d/admin/dashboard' : '/droneviz3d/admin/login')
}