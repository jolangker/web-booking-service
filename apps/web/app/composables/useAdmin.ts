export function adminError(error: unknown) {
  const e = error as { data?: { statusMessage?: string }, message?: string }
  return e.data?.statusMessage ?? 'Tidak dapat menghubungi server. Coba lagi.'
}

export function useAdmin() {
  const csrf = useState('admin-csrf', () => '')
  const username = useState('admin-username', () => '')
  async function authenticate() {
    const result = await $fetch<{ authenticated: boolean, username?: string, csrfToken: string }>('/api/admin/auth')
    csrf.value = result.csrfToken
    username.value = result.username ?? ''
    return result.authenticated
  }
  async function request<T>(url: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown = {}) {
    try {
      return await $fetch<T>(url, { method, headers: { 'x-csrf-token': csrf.value, 'content-type': 'application/json' }, body: body as Record<string, unknown> })
    } catch (error) {
      if ((error as { status?: number }).status === 401) await navigateTo('/admin/login')
      throw error
    }
  }
  return { csrf, username, authenticate, request }
}
