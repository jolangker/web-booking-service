<template>
  <footer class="site-footer">
    <div class="footer-top">
      <NuxtLink to="/" class="brand"><span class="brand-mark"><AppIcon name="route" /></span><span>booking<span class="brand-light">bengkel</span><span class="brand-dot">.</span></span></NuxtLink>
      <p>Rencanakan kunjungan.<br>Ikuti servisnya sampai selesai.</p>
      <nav aria-label="Navigasi footer"><NuxtLink to="/bookings">Booking saya</NuxtLink><NuxtLink to="/history">Buku servis</NuxtLink><NuxtLink to="/account">Akun & kendaraan</NuxtLink></nav>
    </div>
    <div class="footer-bottom"><span>Jadwal dalam WIB · Pembayaran di bengkel</span><NuxtLink to="/admin">Akses Admin <AppIcon name="arrow-up-right" /></NuxtLink></div>
  </footer>
</template>
