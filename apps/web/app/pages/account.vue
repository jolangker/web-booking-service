<script setup lang="ts">
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
    <header class="admin-header"><div><p class="eyebrow">BOOKING BENGKEL · PELANGGAN</p><h1>Akun & kendaraan</h1></div><button v-if="csrf" :disabled="busy" @click="logout">Keluar</button></header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <button v-if="error && !csrf" @click="prepare">Coba lagi</button>
    <CustomerEditor v-if="csrf" base="/api/customer" :csrf="csrf" />
  </main>
</template>
