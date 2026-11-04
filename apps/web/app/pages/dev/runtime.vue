<script setup lang="ts">
const token = ref('')
const status = ref('Belum diperiksa')
const busy = ref(false)
const failOnce = ref(true)
const delaySeconds = ref(0)
const jobId = ref('')
const jobStatus = ref('')
const headers = () => ({ 'x-runtime-token': token.value })

async function check() {
  busy.value = true
  try {
    const result = await $fetch('/health/ready', { headers: headers() })
    status.value = result.status
  } catch { status.value = 'Readiness gagal. Periksa token, DB, dan migration.' }
  finally { busy.value = false }
}
async function enqueue() {
  busy.value = true
  try {
    const job = await $fetch('/api/dev/jobs', { method: 'POST', headers: headers(), body: { failOnce: failOnce.value, delaySeconds: delaySeconds.value } })
    jobId.value = job.id
    jobStatus.value = `Antrean tersimpan: ${job.queueJobId}`
  } catch { jobStatus.value = 'Job gagal dikirim. Periksa token dan runtime.' }
  finally { busy.value = false }
}
async function refreshJob() {
  busy.value = true
  try {
    const job = await $fetch(`/api/dev/jobs/${jobId.value}`, { headers: headers() })
    jobStatus.value = `${job.completedAt ? 'Selesai' : 'Menunggu / retry'} | Percobaan: ${job.attempts} | Queue ID: ${job.queueJobId}`
  } catch { jobStatus.value = 'Status gagal dibaca.' }
  finally { busy.value = false }
}
</script>

<template>
  <main>
    <h1>Runtime development</h1>
    <p>Memeriksa API, PostgreSQL, dan job persisten.</p>
    <label>Token runtime <input v-model="token" type="password" autocomplete="off"></label>
    <section aria-labelledby="readiness">
      <h2 id="readiness">Readiness</h2>
      <button :disabled="busy" @click="check">Periksa koneksi</button>
      <p role="status">{{ status }}</p>
    </section>
    <section aria-labelledby="jobs">
      <h2 id="jobs">Job contoh</h2>
      <label><input v-model="failOnce" type="checkbox"> Gagal sekali untuk memeriksa retry</label>
      <p><label>Tunda (0–120 detik) <input v-model.number="delaySeconds" type="number" min="0" max="120"></label></p>
      <button :disabled="busy" @click="enqueue">Kirim job</button>
      <p><label>ID job <input v-model="jobId" type="text" size="38"></label></p>
      <button :disabled="busy || !jobId" @click="refreshJob">Baca hasil</button>
      <p role="status">{{ jobStatus }}</p>
    </section>
  </main>
</template>
