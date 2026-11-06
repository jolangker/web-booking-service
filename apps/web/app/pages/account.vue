<script setup lang="ts">
useHead({ title: 'Akun & kendaraan — Booking bengkel' })
const csrf = ref(''), error = ref(''), busy = ref(false)
async function prepare() {
  try {
    const result = await $fetch<{ authenticated: boolean, csrfToken: string }>('/api/customer/auth')
    if (!result.authenticated) await navigateTo('/login')
    else csrf.value = result.csrfToken
  } catch (e) { error.value = adminError(e) }
}
onMounted(prepare)
async function logout() {
  busy.value = true
  try {
    await $fetch('/api/customer/auth', { method: 'DELETE', headers: { 'x-csrf-token': csrf.value, 'content-type': 'application/json' }, body: {} })
    await navigateTo('/login')
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
</script>

<template>
  <main class="admin customer-account">
    <header class="page-heading admin-header"><div><h1>Akun & kendaraan</h1><p>Lengkapi profil dan simpan kendaraan untuk kunjungan Anda.</p></div><button v-if="csrf" :disabled="busy" @click="logout"><AppIcon name="log-out" /> Keluar</button></header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <nav class="customer-links" aria-label="Tautan akun"><NuxtLink to="/bookings">Booking saya</NuxtLink><NuxtLink to="/bookings/new">Buat booking</NuxtLink><NuxtLink to="/history">Buku servis & invoice</NuxtLink></nav>
    <button v-if="error && !csrf" @click="prepare">Coba lagi</button>
    <CustomerEditor v-if="csrf" base="/api/customer" :csrf="csrf" />
  </main>
</template>
