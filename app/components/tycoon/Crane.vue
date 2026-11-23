<script setup lang="ts">
/**
 * The "construction in progress" motif: a little tower crane. Still when the
 * builders are idle; while something is built the hook swings with its crate
 * and the jib light blinks (no motion with prefers-reduced-motion).
 */
defineProps<{ active?: boolean }>()
</script>

<template>
  <svg viewBox="0 0 40 40" class="crane block" :class="active ? 'is-active' : ''" aria-hidden="true">
    <g stroke="#1b1329" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
      <!-- Base and mast -->
      <rect x="7" y="33" width="16" height="4" rx="1.5" fill="#6b5a8e" />
      <rect x="12" y="10" width="6" height="23.5" fill="#ffc93a" />
      <path d="M12 14 L18 19 M18 19 L12 24 M12 24 L18 29 M18 29 L12 33" fill="none" stroke-width="1.2" />
      <!-- Jib with the counterweight and the cab -->
      <rect x="4" y="7" width="33" height="3.6" rx="1" fill="#ffc93a" />
      <rect x="3.5" y="10.4" width="6" height="4.6" rx="1" fill="#6b5a8e" />
      <rect x="12.5" y="3.4" width="5" height="4" rx="1" fill="#ff9a2e" />
      <circle class="light" cx="36" cy="5.6" r="1.4" fill="#ff5470" stroke-width="1" />
      <!-- Trolley, cable, hook and crate -->
      <rect x="27.5" y="10.4" width="4" height="2" rx="0.6" fill="#4a3a6b" stroke-width="1" />
      <g class="hook">
        <path d="M29.5 12.4 V22" fill="none" stroke-width="1.1" />
        <path d="M26.5 22 H32.5 L31 24 H28 Z" fill="#c9b8e8" stroke-width="1" />
        <rect x="25" y="24" width="9" height="8" rx="1.3" fill="#ff9a2e" />
        <path d="M25 28 H34 M29.5 24 V32" fill="none" stroke-width="1" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.hook { transform-box: view-box; transform-origin: 29.5px 12.4px; }
.is-active .hook { animation: swing 1.6s ease-in-out infinite; }
.is-active .light { animation: blink 1.2s steps(2, jump-none) infinite; }
.crane:not(.is-active) .light { fill: #6b5a8e; }
@keyframes swing {
  0%, 100% { transform: rotate(7deg); }
  50% { transform: rotate(-7deg); }
}
@keyframes blink {
  50% { opacity: 0.25; }
}
@media (prefers-reduced-motion: reduce) {
  .is-active .hook, .is-active .light { animation: none; }
}
</style>
