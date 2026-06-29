<template>
  <TheTopBar />

  <main id="app" class="app-main" tabindex="-1"></main>

  <nav class="mobile-nav" id="mobileNav" aria-label="移动端导航"></nav>

  <div class="toast-host" id="toastHost" aria-live="polite"></div>
  <div class="modal-root" id="modalRoot"></div>
</template>

<script setup>
import TheTopBar from "./TheTopBar.vue";
</script>
