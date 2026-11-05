<script setup lang="ts">
const { username, authenticate, request, csrf } = useAdmin()
const tab = ref('reception'), error = ref(''), ready = ref(false), busy = ref(false)
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
    sessionStorage.removeItem('reception-check-in'); sessionStorage.removeItem('reception-walk-in')
    sessionStorage.removeItem('work-order-mutation')
    sessionStorage.removeItem('cashier-payment')
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('invoice-delivery:')) sessionStorage.removeItem(key)
    await navigateTo('/admin/login')
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
</script>

<template>
  <main class="admin admin-dashboard">
    <header class="admin-header">
      <div><p class="eyebrow">BOOKING BENGKEL · ADMIN</p><h1>Operasional bengkel</h1><p class="muted">Satu cabang · Asia/Jakarta (WIB)</p></div>
      <div v-if="ready" class="actions"><span>{{ username }}</span><button :disabled="busy" @click="logout">{{ busy ? 'Keluar…' : 'Keluar' }}</button></div>
    </header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <button v-if="error && !ready" @click="prepare">Coba lagi</button>
    <p v-if="!ready && !error" role="status">Memuat sesi Admin…</p>
    <template v-if="ready">
      <nav class="admin-tabs" aria-label="Konfigurasi bengkel">
        <button v-for="item in [{ id: 'reception', label: 'Penerimaan' }, { id: 'progress', label: 'Pengerjaan / WO' }, { id: 'cashier', label: 'Kasir / Invoice' }, { id: 'services', label: 'Layanan' }, { id: 'calendar', label: 'Jam & hari libur' }, { id: 'slots', label: 'Preview & kuota' }, { id: 'customers', label: 'Pelanggan' }, { id: 'gateway', label: 'WhatsApp' }]" :key="item.id" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id">{{ item.label }}</button>
      </nav>
      <AdminReception v-if="tab === 'reception'" />
      <AdminWorkOrders v-if="tab === 'progress'" />
      <AdminCashier v-if="tab === 'cashier'" />
      <AdminServices v-if="tab === 'services'" />
      <AdminCalendar v-if="tab === 'calendar'" />
      <AdminSlots v-if="tab === 'slots'" />
      <AdminCustomers v-if="tab === 'customers'" />
      <AdminGateway v-if="tab === 'gateway'" />
    </template>
  </main>
</template>
