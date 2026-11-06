<script setup lang="ts">
const route = useRoute()
const customer = computed(() => !route.path.startsWith('/admin') && !route.path.startsWith('/dev/'))
</script>

<template>
  <div :class="customer ? 'site-shell' : 'internal-shell'">
    <a class="skip-link" href="#main-content">Langsung ke konten</a>
    <CustomerHeader v-if="customer" />
    <div id="main-content" tabindex="-1" class="page-content">
      <NuxtPage />
    </div>
    <CustomerFooter v-if="customer" />
    <NuxtRouteAnnouncer />
  </div>
</template>
