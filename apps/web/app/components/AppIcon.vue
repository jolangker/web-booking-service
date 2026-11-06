<script setup lang="ts">
// Lucide icons, ISC license: https://github.com/lucide-icons/lucide/blob/main/LICENSE
const icons: Record<string, { tag: string, attributes: Record<string, string> }[]> = {
  "arrow-right": [{"tag":"path","attributes":{"d":"M5 12h14m-7-7l7 7l-7 7"}}],
  "arrow-up-right": [{"tag":"path","attributes":{"d":"M7 7h10v10M7 17L17 7"}}],
  "calendar-days": [{"tag":"path","attributes":{"d":"M8 2v3m8-3v3"}},{"tag":"rect","attributes":{"width":"18","height":"18","x":"3","y":"3","rx":"2"}},{"tag":"path","attributes":{"d":"M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"}}],
  "check": [{"tag":"path","attributes":{"d":"M20 6L9 17l-5-5"}}],
  "check-check": [{"tag":"path","attributes":{"d":"M18 6L7 17l-5-5m20-2l-7.5 7.5L13 16"}}],
  "chevron-down": [{"tag":"path","attributes":{"d":"m6 9l6 6l6-6"}}],
  "clipboard-list": [{"tag":"rect","attributes":{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}},{"tag":"path","attributes":{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m4 7h4m-4 5h4m-8-5h.01M8 16h.01"}}],
  "clock": [{"tag":"circle","attributes":{"cx":"12","cy":"12","r":"10"}},{"tag":"path","attributes":{"d":"M12 6v6l4 2"}}],
  "credit-card": [{"tag":"rect","attributes":{"width":"20","height":"14","x":"2","y":"5","rx":"2"}},{"tag":"path","attributes":{"d":"M2 10h20M6 14h2"}}],
  "car": [{"tag":"path","attributes":{"d":"M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"}},{"tag":"circle","attributes":{"cx":"7","cy":"17","r":"2"}},{"tag":"path","attributes":{"d":"M9 17h6"}},{"tag":"circle","attributes":{"cx":"17","cy":"17","r":"2"}}],
  "files": [{"tag":"path","attributes":{"d":"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"}},{"tag":"path","attributes":{"d":"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706zM5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"}}],
  "history": [{"tag":"path","attributes":{"d":"M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8"}},{"tag":"path","attributes":{"d":"M3 3v5h5m4-1v5l4 2"}}],
  "log-out": [{"tag":"path","attributes":{"d":"m16 17l5-5l-5-5m5 5H9m0 9H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}}],
  "menu": [{"tag":"path","attributes":{"d":"M4 5h16M4 12h16M4 19h16"}}],
  "message-circle": [{"tag":"path","attributes":{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092a10 10 0 1 0-4.777-4.719"}}],
  "plus": [{"tag":"path","attributes":{"d":"M5 12h14m-7-7v14"}}],
  "search": [{"tag":"path","attributes":{"d":"m21 21l-4.34-4.34"}},{"tag":"circle","attributes":{"cx":"11","cy":"11","r":"8"}}],
  "shield-check": [{"tag":"path","attributes":{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}},{"tag":"path","attributes":{"d":"m9 12l2 2l4-4"}}],
  "sliders-horizontal": [{"tag":"path","attributes":{"d":"M10 5H3m9 14H3M14 3v4m2 10v4m5-9h-9m9 7h-5m5-14h-7m-6 5v4m0-2H3"}}],
  "users-round": [{"tag":"path","attributes":{"d":"M18 21a8 8 0 0 0-16 0"}},{"tag":"circle","attributes":{"cx":"10","cy":"8","r":"5"}},{"tag":"path","attributes":{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}}],
  "wrench": [{"tag":"path","attributes":{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}}],
  "x": [{"tag":"path","attributes":{"d":"M18 6L6 18M6 6l12 12"}}],
  "route": [{"tag":"circle","attributes":{"cx":"6","cy":"19","r":"3"}},{"tag":"path","attributes":{"d":"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}},{"tag":"circle","attributes":{"cx":"18","cy":"5","r":"3"}}],
}
defineProps<{ name: string }>()
</script>

<template>
  <svg class="app-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true">
    <component :is="shape.tag" v-for="(shape, index) in icons[name] ?? icons.route" :key="index" v-bind="shape.attributes" />
  </svg>
</template>
