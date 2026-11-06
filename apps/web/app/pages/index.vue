<script setup lang="ts">
useHead({ title: 'Booking bengkel — Rencanakan servis, lanjutkan perjalanan', meta: [{ name: 'description', content: 'Pilih layanan dan jadwal kedatangan, pantau progres servis, dan simpan riwayat kendaraan Anda. Mulai booking dengan WhatsApp.' }] })
// Initialize in the browser so the auth endpoint's CSRF cookie reaches the OTP request.
const { data: auth, error, refresh } = await useAsyncData('home-auth', () => $fetch<{ authenticated: boolean, csrfToken: string }>('/api/customer/auth'), { server: false })
const questions = [
  { question: 'Bagaimana cara membuat booking?', answer: 'Masuk menggunakan nomor WhatsApp dan kode OTP. Lengkapi nama dan kendaraan, lalu pilih layanan, tanggal, dan slot kedatangan. Periksa ringkasan sebelum mengonfirmasi booking.' },
  { question: 'Kapan saya bisa menjadwalkan kedatangan?', answer: 'Booking online tersedia untuk besok sampai 14 hari ke depan, mengikuti jam operasional dan kuota bengkel. Slot diperiksa kembali saat booking disimpan.' },
  { question: 'Apakah harga saat booking sudah final?', answer: 'Harga saat booking merupakan estimasi jasa. Biaya akhir mengikuti jasa dan komponen yang benar-benar dikerjakan oleh bengkel. Pembayaran dilakukan di lokasi melalui tunai, QRIS, atau EDC.' },
  { question: 'Bisa mengubah jadwal atau membatalkan?', answer: 'Bisa melalui detail booking, paling lambat 120 menit sebelum jadwal aktif dan sebelum kendaraan diterima bengkel. Jadwal baru mengikuti ketersediaan. Kode booking tetap sama setelah perubahan jadwal.' },
  { question: 'Bagaimana cara melihat progres dan invoice?', answer: 'Gunakan tautan tracking dari booking atau WhatsApp untuk memantau progres. Setelah pembayaran lunas, masuk ke Buku servis untuk melihat riwayat dan invoice. PDF dapat diunduh saat file siap.' },
]
</script>

<template>
  <main class="home">
    <section class="home-hero" aria-labelledby="home-title">
      <h1 id="home-title">Rencanakan servis.<br><em>Lanjutkan perjalanan.</em></h1>
      <div class="hero-description"><p>Pilih waktu kedatangan, ikuti pengerjaan, dan simpan riwayat kendaraan. Satu alur untuk setiap kunjungan Anda.</p><span class="booking-window"><AppIcon name="calendar-days" /> Booking online H+1 hingga H+14</span></div>
      <ol id="cara-booking" class="home-route">
        <li>
          <span class="route-number" aria-hidden="true">1</span>
          <h2>Mulai dari booking</h2><p>Pilih layanan dan jadwal setelah masuk dengan WhatsApp.</p>
          <div class="route-start admin">
            <NuxtLink v-if="auth?.authenticated" to="/bookings/new" class="button">Pilih layanan & jadwal <AppIcon name="arrow-right" /></NuxtLink>
            <OtpForm v-else-if="auth" base="/api/customer/otp" verify-path="/api/customer/auth" :csrf="auth.csrfToken" request-label="Mulai booking servis" @verified="navigateTo('/bookings/new')" />
            <template v-else><NuxtLink to="/login?returnTo=/bookings/new" class="button">Mulai booking servis <AppIcon name="arrow-right" /></NuxtLink><p v-if="error" class="signin-note">Sesi belum dapat dimuat. <button type="button" @click="refresh()">Coba lagi</button></p></template>
          </div>
          <p class="signin-note">Kode OTP dikirim ke WhatsApp. Jangan bagikan kode Anda kepada siapa pun.</p>
        </li>
        <li><span class="route-number" aria-hidden="true">2</span><h2>Datang ke bengkel</h2><p>Tunjukkan kode atau QR booking saat tiba sesuai jadwal kedatangan.</p><NuxtLink to="/bookings" class="stage-link">Lihat booking saya <AppIcon name="arrow-right" /></NuxtLink></li>
        <li><span class="route-number" aria-hidden="true">3</span><h2>Ikuti pengerjaan</h2><p>Pantau status kunjungan melalui tautan tracking dari booking atau WhatsApp.</p></li>
        <li><span class="route-number" aria-hidden="true">4</span><h2>Bayar di bengkel</h2><p>Selesaikan pembayaran di lokasi. Riwayat dan invoice tersimpan di akun Anda.</p><NuxtLink to="/history" class="stage-link">Buka buku servis <AppIcon name="arrow-right" /></NuxtLink></li>
      </ol>
    </section>

    <section class="home-section service-story" aria-labelledby="story-title">
      <figure><img src="/images/engine-detail.webp" width="1600" height="900" alt="Detail sabuk, puli, dan komponen mesin kendaraan" loading="lazy"><figcaption>Foto ilustrasi komponen kendaraan · <a href="https://images.unsplash.com/photo-1486262715619-67b85e0b08d3" target="_blank" rel="noopener noreferrer">Unsplash</a></figcaption></figure>
      <div class="story-copy">
        <h2 id="story-title">Kendaraan dirawat.<br>Informasi tercatat.</h2>
        <p>Dari kebutuhan servis hari ini sampai catatan kunjungan berikutnya, semua punya tempatnya.</p>
        <ul class="story-points">
          <li><AppIcon name="calendar-days" /><div><h3>Rencanakan sebelum berangkat</h3><p>Pilih layanan dan slot kedatangan yang tersedia. Estimasi jasa terlihat sebelum booking dikonfirmasi.</p></div></li>
          <li><AppIcon name="wrench" /><div><h3>Tahu sampai mana servisnya</h3><p>Ikuti tahapan kunjungan dari kendaraan diterima hingga pengerjaan selesai melalui tautan tracking.</p></div></li>
          <li><AppIcon name="files" /><div><h3>Buku servis untuk setiap kendaraan</h3><p>Akses riwayat kunjungan lunas dan invoice dari akun Anda, termasuk saat memiliki lebih dari satu kendaraan.</p></div></li>
        </ul>
      </div>
    </section>

    <section class="service-facts" aria-labelledby="facts-title">
      <div><h2 id="facts-title">Lebih jelas sebelum Anda datang.</h2><p>Beberapa hal yang perlu diketahui saat merencanakan kunjungan ke bengkel.</p></div>
      <dl><div><dt>Jadwal kedatangan</dt><dd>Besok hingga 14 hari ke depan, sesuai slot tersedia. Seluruh waktu dalam WIB.</dd></div><div><dt>Estimasi biaya</dt><dd>Terlihat saat booking. Biaya akhir mengikuti pekerjaan aktual.</dd></div><div><dt>Pembayaran di lokasi</dt><dd>Tunai, QRIS, atau EDC setelah diperiksa oleh Admin.</dd></div><div><dt>Perubahan rencana</dt><dd>Ubah atau batal minimal 120 menit sebelum jadwal, sebelum kendaraan diterima.</dd></div></dl>
    </section>

    <section id="pertanyaan" class="home-section faq-section" aria-labelledby="faq-title">
      <div><h2 id="faq-title">Sebelum mulai,<br>mungkin Anda bertanya.</h2><p>Jawaban untuk merencanakan kunjungan pertama Anda.</p></div>
      <div class="faq-list"><details v-for="item in questions" :key="item.question"><summary>{{ item.question }}<AppIcon name="chevron-down" /></summary><p>{{ item.answer }}</p></details></div>
    </section>
    <section class="home-close"><div><h2>Siapkan kunjungan berikutnya.</h2><p>Mulai dari layanan yang kendaraan Anda butuhkan.</p></div><NuxtLink to="/bookings/new" class="button">Booking servis <AppIcon name="arrow-up-right" /></NuxtLink></section>
  </main>
</template>
