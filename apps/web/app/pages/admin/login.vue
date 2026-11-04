<script setup lang="ts">
const { authenticate, request } = useAdmin()
const username = ref(''), password = ref(''), error = ref(''), ready = ref(false), busy = ref(false)
async function prepare() {
  error.value = ''
  try {
    if (await authenticate()) { await navigateTo('/admin'); return }
    ready.value = true
  } catch (e) { error.value = adminError(e) }
}
onMounted(prepare)
async function login() {
  busy.value = true; error.value = ''
  try {
    await request('/api/admin/auth', 'POST', { username: username.value, password: password.value })
    password.value = ''
    await navigateTo('/admin')
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
</script>

<template>
  <main class="admin admin-login">
    <p class="eyebrow">BOOKING BENGKEL · INTERNAL</p>
    <h1>Masuk sebagai Admin</h1>
    <p>Kelola layanan, jam operasional, dan kuota kedatangan.</p>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <button v-if="!ready && error" @click="prepare">Coba lagi</button>
    <p v-if="!ready && !error" role="status">Menyiapkan login…</p>
    <form v-if="ready" @submit.prevent="login">
      <label>Username<input v-model="username" name="username" autocomplete="username" required minlength="3" maxlength="64" autocapitalize="none" spellcheck="false"></label>
      <label>Password<input v-model="password" name="password" type="password" autocomplete="current-password" required></label>
      <button class="primary" :disabled="busy">{{ busy ? 'Memeriksa…' : 'Masuk' }}</button>
    </form>
    <p class="muted">Akun disiapkan oleh operator melalui prosedur bootstrap Admin.</p>
  </main>
</template>
