<script setup lang="ts">
useHead({ title: 'Masuk dengan WhatsApp — Booking bengkel' })
const csrf = ref(''), error = ref(''), returnPath = ref('/account'), route = useRoute()
async function prepare() {
  error.value = ''
  try {
    const result = await $fetch<{ authenticated: boolean, csrfToken: string, returnPath: string }>('/api/customer/auth', { query: { returnTo: route.query.returnTo } })
    returnPath.value = result.returnPath
    if (result.authenticated) await navigateTo(returnPath.value)
    else csrf.value = result.csrfToken
  } catch (e) { error.value = adminError(e) }
}
onMounted(prepare)
</script>

<template>
  <main class="admin customer-account auth-layout">
    <section class="auth-story"><h1>Langkah pertama untuk servis berikutnya.</h1><p>Masuk dengan nomor WhatsApp untuk mengatur kunjungan dan melihat catatan kendaraan Anda.</p><ul class="auth-benefits"><li><AppIcon name="calendar-days" />Pilih layanan dan jadwal kedatangan</li><li><AppIcon name="wrench" />Ikuti progres kunjungan Anda</li><li><AppIcon name="files" />Simpan riwayat servis dan invoice</li></ul></section>
    <section class="auth-form-panel" aria-labelledby="login-title">
      <h2 id="login-title">Masuk dengan WhatsApp</h2><p>Kami akan mengirim kode OTP 4 digit ke nomor Anda.</p>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p><button v-if="error" @click="prepare">Coba lagi</button>
      <OtpForm v-if="csrf" base="/api/customer/otp" verify-path="/api/customer/auth" :csrf="csrf" @verified="navigateTo(returnPath)" />
      <p v-else-if="!error" role="status">Menyiapkan sesi Anda…</p>
      <p class="privacy-note"><AppIcon name="shield-check" /><span>Kode berlaku 5 menit, maksimal 3 percobaan. Jangan bagikan kode OTP Anda.</span></p>
    </section>
  </main>
</template>
