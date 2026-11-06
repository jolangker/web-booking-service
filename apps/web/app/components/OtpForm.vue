<script setup lang="ts">
const props = defineProps<{ base: string, verifyPath: string, csrf: string, contact?: boolean, requestLabel?: string }>()
const emit = defineEmits<{ verified: [] }>()
const phone = ref(''), code = ref(''), error = ref(''), busy = ref(false)
const challenge = ref<{ id: string, expiresAt: string, resendAt: string, status: string }>()
const now = ref(Date.now())
const cooldown = computed(() => challenge.value ? Math.max(0, Math.ceil((Date.parse(challenge.value.resendAt) - now.value) / 1000)) : 0)
const remaining = computed(() => challenge.value ? Math.max(0, Math.ceil((Date.parse(challenge.value.expiresAt) - now.value) / 1000)) : 0)
const descriptions: Record<string, string> = {
  queued: 'Kode dalam antrean pengiriman.', retrying: 'Gateway sedang bermasalah. Pengiriman akan dicoba kembali sebelum kode kedaluwarsa.',
  sending: 'Mengirim kode melalui WhatsApp…', accepted: 'Gateway menerima pesan; penerimaan di HP belum terkonfirmasi.',
  sent: 'Pesan terkirim ke server WhatsApp.', delivered: 'Pesan diterima perangkat WhatsApp.', read: 'Pesan sudah dibaca.',
  failed: 'Pengiriman gagal. Anda dapat meminta kode baru setelah cooldown.', unknown: 'Hasil pengiriman belum dapat dipastikan. Periksa WhatsApp; minta kode baru setelah cooldown bila belum diterima.',
  stale: 'Kode sudah diganti atau tidak berlaku.', expired: 'Kode kedaluwarsa. Minta kode baru.', locked: 'Batas 3 percobaan tercapai. Minta kode baru setelah cooldown.', used: 'Kode sudah digunakan.',
}
let timer: ReturnType<typeof setInterval> | undefined, polling = false, ticks = 0
onMounted(() => {
  timer = setInterval(async () => {
    now.value = Date.now()
    ticks++
    if (!challenge.value || polling || busy.value || ticks % 3 !== 0) return
    polling = true
    const id = challenge.value.id
    try {
      const status = await $fetch<typeof challenge.value>(`${props.base}/${id}`)
      if (challenge.value?.id === id) challenge.value = status
    }
    catch { error.value = 'Status pengiriman belum dapat diperbarui. Periksa koneksi.' }
    finally { polling = false }
  }, 1000)
})
onBeforeUnmount(() => clearInterval(timer))
async function requestCode() {
  busy.value = true; error.value = ''
  try {
    challenge.value = await $fetch(props.base, { method: 'POST', headers: { 'x-csrf-token': props.csrf }, body: { phone: phone.value } })
    code.value = ''; now.value = Date.now()
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
async function verify() {
  if (!challenge.value) return
  busy.value = true; error.value = ''
  try {
    await $fetch(props.verifyPath, { method: 'POST', headers: { 'x-csrf-token': props.csrf }, body: { id: challenge.value.id, code: code.value } })
    emit('verified')
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="otp-form">
    <p v-if="contact" class="muted">Nomor baru harus menerima OTP. Setelah berhasil, semua sesi pelanggan dicabut; masuk kembali dengan nomor baru.</p>
    <form @submit.prevent="requestCode">
      <label>Nomor WhatsApp{{ contact ? ' baru' : '' }}<input v-model="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="08… atau +628…" required maxlength="30" :disabled="busy || cooldown > 0"></label>
      <button type="submit" class="primary" :disabled="busy || cooldown > 0">{{ busy ? 'Memproses…' : cooldown > 0 ? `Kirim ulang dalam ${cooldown} detik` : challenge ? 'Kirim kode baru' : requestLabel || 'Kirim OTP WhatsApp' }}</button>
    </form>
    <template v-if="challenge">
      <p role="status">{{ remaining === 0 ? descriptions.expired : descriptions[challenge.status] }} <span v-if="remaining > 0">Berlaku {{ remaining }} detik lagi.</span></p>
      <form @submit.prevent="verify">
        <label>Kode OTP 4 digit<input v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" maxlength="4" minlength="4" required></label>
        <button type="submit" class="primary" :disabled="busy || remaining === 0 || ['locked', 'stale', 'used'].includes(challenge.status)">{{ busy ? 'Memproses…' : 'Verifikasi kode' }}</button>
      </form>
    </template>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  </div>
</template>
