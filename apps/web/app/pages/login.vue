<script setup lang="ts">
const csrf = ref(''), error = ref('')
async function prepare() {
  error.value = ''
  try {
    const result = await $fetch<{ authenticated: boolean, csrfToken: string }>('/api/customer/auth')
    if (result.authenticated) await navigateTo('/account')
    else csrf.value = result.csrfToken
  } catch (e) { error.value = adminError(e) }
}
onMounted(prepare)
</script>

<template>
  <main class="admin admin-login">
    <p class="eyebrow">BOOKING BENGKEL</p><h1>Masuk dengan WhatsApp</h1>
    <p>Kode 4 digit akan dikirim ke WhatsApp Anda. Kode berlaku maksimal 5 menit, dengan 3 percobaan verifikasi.</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <button v-if="error" @click="prepare">Coba lagi</button>
    <OtpForm v-if="csrf" base="/api/customer/otp" verify-path="/api/customer/auth" :csrf="csrf" @verified="navigateTo('/account')" />
    <p><NuxtLink to="/">Beranda</NuxtLink> · <NuxtLink to="/admin">Masuk Admin</NuxtLink></p>
  </main>
</template>
