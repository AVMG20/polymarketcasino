<script setup lang="ts">
/** A magician's white glove with a gold cuff: a hand on the board. `tone` dims it once its tile lost. */
defineProps<{ tone?: 'live' | 'won' | 'lost' }>()
</script>

<template>
  <svg viewBox="0 0 32 36" aria-hidden="true" class="mh-glove" :class="tone ?? 'live'">
    <!-- Outline pass: every part stroked, then filled over, so only the silhouette shows. -->
    <g class="mh-outline">
      <rect x="7" y="6.5" width="4.8" height="15" rx="2.4" />
      <rect x="11.8" y="2.5" width="4.8" height="17" rx="2.4" />
      <rect x="16.6" y="3.5" width="4.8" height="16" rx="2.4" />
      <rect x="21.4" y="7" width="4.6" height="13" rx="2.3" />
      <rect x="7" y="13" width="19" height="14" rx="5.5" />
      <rect x="1.6" y="14.5" width="4.8" height="11" rx="2.4" transform="rotate(-38 5 24)" />
      <rect x="7.6" y="25.5" width="17.8" height="8" rx="2" />
    </g>
    <g class="mh-fill">
      <rect x="7" y="6.5" width="4.8" height="15" rx="2.4" />
      <rect x="11.8" y="2.5" width="4.8" height="17" rx="2.4" />
      <rect x="16.6" y="3.5" width="4.8" height="16" rx="2.4" />
      <rect x="21.4" y="7" width="4.6" height="13" rx="2.3" />
      <rect x="7" y="13" width="19" height="14" rx="5.5" />
      <rect x="1.6" y="14.5" width="4.8" height="11" rx="2.4" transform="rotate(-38 5 24)" />
    </g>
    <path d="M11.8 13.5v3.5M16.6 12.5v4.5M21.4 13v4" class="mh-crease" />
    <rect x="7.6" y="25.5" width="17.8" height="8" rx="2" class="mh-cuff" />
    <path d="M9 28.2h15M9 30.8h15" class="mh-cuff-line" />
  </svg>
</template>

<style scoped>
.mh-glove { overflow: visible; filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.35)); }
.mh-outline { fill: #2a1546; stroke: #2a1546; stroke-width: 3; stroke-linejoin: round; }
.mh-fill { fill: #fffaf0; }
.mh-crease { stroke: #d9cfe8; stroke-width: 1.2; stroke-linecap: round; fill: none; }
.mh-cuff { fill: #ffc93a; }
.mh-cuff-line { stroke: #c3840a; stroke-width: 1; }
.won .mh-fill { fill: #fff; }
.won { filter: drop-shadow(0 0 6px rgb(255 230 120 / 0.95)) drop-shadow(0 2px 0 rgb(0 0 0 / 0.35)); }
.lost { opacity: 0.45; filter: grayscale(0.7); }
</style>
