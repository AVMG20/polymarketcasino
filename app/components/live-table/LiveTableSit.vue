<script setup lang="ts">
/**
 * An empty seat on the felt (stage coordinates): a chair that invites you to
 * sit, dimmed while you already have a seat, and behind a lock while you are
 * only watching (the game isn't built yet).
 */
defineProps<{ x: number, y: number, mode: 'open' | 'taken' | 'locked' }>()
defineEmits<{ sit: [] }>()
</script>

<template>
  <button
    type="button"
    class="lt-sit"
    :class="mode"
    :style="{ left: `${x}px`, top: `${y}px` }"
    :disabled="mode === 'taken'"
    :title="mode === 'locked' ? 'Build this game to take a seat' : mode === 'open' ? 'Take this seat' : undefined"
    @click="$emit('sit')"
  >
    <svg v-if="mode === 'locked'" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="11" y="21" width="26" height="20" rx="5" fill="currentColor" />
      <path d="M16 21v-5a8 8 0 0 1 16 0v5" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
      <circle cx="24" cy="30" r="3" fill="#2a170c" />
      <rect x="22.5" y="31" width="3" height="5" rx="1.5" fill="#2a170c" />
    </svg>
    <svg v-else viewBox="0 0 48 48" aria-hidden="true">
      <!-- A padded casino stool: back, seat, legs. -->
      <rect x="13" y="5" width="22" height="17" rx="7" fill="#c0392b" stroke="#ffe9b0" stroke-width="2.5" />
      <rect x="16.5" y="8.5" width="15" height="2.5" rx="1.25" fill="#fff" fill-opacity=".35" />
      <rect x="9" y="22" width="30" height="9" rx="4.5" fill="#e74c3c" stroke="#ffe9b0" stroke-width="2.5" />
      <path d="M14 31l-3 13M34 31l3 13M24 31v13" stroke="#ffe9b0" stroke-width="3" stroke-linecap="round" />
    </svg>
    <span class="lbl">{{ mode === 'locked' ? 'BUILD' : 'SIT' }}</span>
  </button>
</template>
