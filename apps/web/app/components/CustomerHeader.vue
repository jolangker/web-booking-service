<script setup lang="ts">
const route = useRoute()
const open = ref(false)
watch(() => route.fullPath, () => { open.value = false })
const home = computed(() => route.path === '/')
</script>

<template>
  <header class="site-header" @keydown.esc="open = false">
    <div class="site-header-inner">
      <NuxtLink to="/" class="brand" aria-label="Booking bengkel — beranda">
        <span class="brand-mark"><AppIcon name="route" /></span>
        <span>booking<span class="brand-light">bengkel</span><span class="brand-dot">.</span></span>
      </NuxtLink>
      <nav class="desktop-nav" aria-label="Navigasi utama">
        <NuxtLink v-if="home" to="#cara-booking">Cara booking</NuxtLink>
        <NuxtLink v-if="home" to="#pertanyaan">Pertanyaan umum</NuxtLink>
        <NuxtLink to="/bookings" :aria-current="route.path.startsWith('/bookings') ? 'page' : undefined">Booking saya</NuxtLink>
        <NuxtLink v-if="!home" to="/history" :aria-current="route.path.startsWith('/history') || route.path.startsWith('/invoices') ? 'page' : undefined">Buku servis</NuxtLink>
        <NuxtLink v-if="!home" to="/account" :aria-current="route.path === '/account' ? 'page' : undefined">Akun & kendaraan</NuxtLink>
      </nav>
      <div class="header-actions">
        <NuxtLink to="/bookings/new" class="button button-small">Booking servis <AppIcon name="arrow-up-right" /></NuxtLink>
        <button class="menu-toggle" type="button" :aria-expanded="open" aria-controls="customer-menu" aria-label="Menu navigasi" @click="open = !open"><AppIcon :name="open ? 'x' : 'menu'" /></button>
      </div>
    </div>
    <nav v-if="open" id="customer-menu" class="mobile-nav" aria-label="Navigasi seluler">
      <NuxtLink to="/" @click="open = false">Beranda</NuxtLink>
      <NuxtLink to="/bookings" @click="open = false">Booking saya</NuxtLink>
      <NuxtLink to="/history" @click="open = false">Buku servis & invoice</NuxtLink>
      <NuxtLink to="/account" @click="open = false">Akun & kendaraan</NuxtLink>
      <NuxtLink to="/login" @click="open = false">Masuk dengan WhatsApp</NuxtLink>
    </nav>
  </header>
</template>
