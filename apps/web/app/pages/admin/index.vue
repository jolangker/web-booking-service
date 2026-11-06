<script setup lang="ts">
const { username, authenticate, request, csrf } = useAdmin()
const tab = ref('reception'), error = ref(''), ready = ref(false), busy = ref(false)
const route = useRoute()
const navOpen = ref(false)
const navigation = [
  { label: 'Operasional', items: [
    { id: 'reception', label: 'Penerimaan', icon: 'clipboard-list', description: 'Kelola kedatangan dan penerimaan kendaraan hari ini.' },
    { id: 'progress', label: 'Pengerjaan / WO', icon: 'wrench', description: 'Catat pengerjaan, penugasan, dan rincian biaya servis.' },
    { id: 'cashier', label: 'Kasir / Invoice', icon: 'credit-card', description: 'Finalkan pembayaran dan kelola arsip invoice.' },
  ] },
  { label: 'Data & laporan', items: [
    { id: 'customers', label: 'Pelanggan', icon: 'users-round', description: 'Kelola profil pelanggan, kendaraan, dan riwayat servis.' },
    { id: 'reports', label: 'Laporan', icon: 'files', description: 'Tinjau kunjungan dan pembayaran dalam periode WIB.' },
  ] },
  { label: 'Pengaturan', items: [
    { id: 'services', label: 'Layanan', icon: 'sliders-horizontal', description: 'Atur layanan, tarif, dan estimasi durasi pengerjaan.' },
    { id: 'calendar', label: 'Jam & hari libur', icon: 'calendar-days', description: 'Atur jadwal mingguan, waktu istirahat, dan pengecualian tanggal.' },
    { id: 'slots', label: 'Slot & kuota', icon: 'clock', description: 'Periksa slot dan kelola kapasitas kedatangan.' },
    { id: 'gateway', label: 'WhatsApp', icon: 'message-circle', description: 'Kelola koneksi WhatsApp dan status pengiriman notifikasi.' },
  ] },
]
const currentPage = computed(() => navigation.flatMap(group => group.items).find(item => item.id === tab.value) ?? navigation[0]!.items[0]!)
watch(() => route.fullPath, () => { navOpen.value = false })
useHead(() => ({ title: `${currentPage.value.label} — Admin Booking bengkel` }))
watch(() => route.query.tab, value => {
  tab.value = typeof value === 'string' && ['reception', 'progress', 'cashier', 'reports', 'services', 'calendar', 'slots', 'customers', 'gateway'].includes(value) ? value : 'reception'
}, { immediate: true })
const initialBookingId = computed(() => typeof route.query.booking === 'string' && /^[0-9a-f-]{36}$/.test(route.query.booking) ? route.query.booking : undefined)
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
  <div class="admin admin-frame">
    <aside class="admin-sidebar" :class="{ 'is-open': navOpen }" @keydown.esc="navOpen = false">
      <div class="admin-sidebar-header">
        <NuxtLink to="/admin" class="brand" aria-label="Booking bengkel Admin"><span class="brand-mark"><AppIcon name="route" /></span><span>booking<span class="brand-light">bengkel</span><span class="brand-dot">.</span></span></NuxtLink>
        <button v-if="ready" type="button" class="admin-nav-toggle" :aria-expanded="navOpen" aria-controls="admin-navigation" aria-label="Menu Admin" @click="navOpen = !navOpen"><AppIcon :name="navOpen ? 'x' : 'menu'" /></button>
      </div>
      <nav v-if="ready" id="admin-navigation" aria-label="Navigasi Admin">
        <div v-for="group in navigation" :key="group.label"><span class="sidebar-group-label">{{ group.label }}</span><NuxtLink v-for="item in group.items" :key="item.id" :to="{ path: '/admin', query: { tab: item.id } }" :aria-current="tab === item.id ? 'page' : undefined"><AppIcon :name="item.icon" />{{ item.label }}</NuxtLink></div>
      </nav>
      <div class="sidebar-footer">Ruang kerja Admin<span>Satu cabang · WIB</span></div>
    </aside>
    <div class="admin-workspace">
      <header class="admin-topbar">
        <div class="admin-topbar-title">Operasional bengkel <span aria-hidden="true">/</span> <strong>{{ currentPage.label }}</strong></div>
        <div v-if="ready" class="admin-session"><span class="admin-avatar" aria-hidden="true">{{ username.slice(0, 1).toUpperCase() }}</span><span class="session-name">{{ username }}</span><button class="admin-logout" :disabled="busy" @click="logout"><AppIcon name="log-out" />{{ busy ? 'Keluar…' : 'Keluar' }}</button></div>
      </header>
      <main class="admin-dashboard">
        <div class="workspace-heading"><div><h1>{{ currentPage.label }}</h1><p>{{ currentPage.description }}</p></div><span class="workspace-symbol"><AppIcon :name="currentPage.icon" /></span></div>
        <p v-if="error" role="alert" class="notice error">{{ error }}</p>
        <button v-if="error && !ready" @click="prepare">Coba lagi</button>
        <p v-if="!ready && !error" role="status">Memuat sesi Admin…</p>
        <template v-if="ready">
          <AdminReception v-if="tab === 'reception'" />
          <AdminWorkOrders v-if="tab === 'progress'" :key="initialBookingId" :initial-booking-id="initialBookingId" />
          <AdminCashier v-if="tab === 'cashier'" :key="initialBookingId" :initial-booking-id="initialBookingId" />
          <AdminReports v-if="tab === 'reports'" />
          <AdminServices v-if="tab === 'services'" />
          <AdminCalendar v-if="tab === 'calendar'" />
          <AdminSlots v-if="tab === 'slots'" />
          <AdminCustomers v-if="tab === 'customers'" />
          <AdminGateway v-if="tab === 'gateway'" />
        </template>
      </main>
    </div>
  </div>
</template>
