<script setup lang="ts">
const { username, authenticate, request, csrf } = useAdmin()
const tab = ref('services'), error = ref(''), ready = ref(false), busy = ref(false)
async function prepare() {
  error.value = ''
  try { if (await authenticate()) ready.value = true; else await navigateTo('/admin/login') }
  catch (e) { error.value = adminError(e) }
}
onMounted(prepare)
async function logout() {
  busy.value = true; error.value = ''
  try {
    await request('/api/admin/auth', 'DELETE')
    csrf.value = ''; username.value = ''
    await navigateTo('/admin/login')
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
</script>

<template>
  <main class="admin admin-dashboard">
    <header class="admin-header">
      <div><p class="eyebrow">BOOKING BENGKEL · ADMIN</p><h1>Konfigurasi bengkel</h1><p class="muted">Satu cabang · Asia/Jakarta (WIB)</p></div>
      <div v-if="ready" class="actions"><span>{{ username }}</span><button :disabled="busy" @click="logout">{{ busy ? 'Keluar…' : 'Keluar' }}</button></div>
    </header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <button v-if="error && !ready" @click="prepare">Coba lagi</button>
    <p v-if="!ready && !error" role="status">Memuat sesi Admin…</p>
    <template v-if="ready">
      <nav class="admin-tabs" aria-label="Konfigurasi bengkel">
        <button v-for="item in [{ id: 'services', label: 'Layanan' }, { id: 'calendar', label: 'Jam & hari libur' }, { id: 'slots', label: 'Preview & kuota' }]" :key="item.id" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id">{{ item.label }}</button>
      </nav>
      <AdminServices v-if="tab === 'services'" />
      <AdminCalendar v-if="tab === 'calendar'" />
      <AdminSlots v-if="tab === 'slots'" />
    </template>
  </main>
</template>
