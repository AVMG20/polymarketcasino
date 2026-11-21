<script setup lang="ts">
/** A player's hub avatar, or their initials on a colour picked from their name. */
const props = withDefaults(defineProps<{ name: string, image: string | null, size?: number }>(), { size: 28 })
const failed = ref(false)
const initials = computed(() => props.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?')
const hue = computed(() => [...props.name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360)
</script>

<template>
  <img
    v-if="image && !failed"
    :src="image"
    :alt="name"
    class="shrink-0 rounded-full object-cover ring-2 ring-white/70"
    :style="{ width: `${size}px`, height: `${size}px` }"
    referrerpolicy="no-referrer"
    @error="failed = true"
  >
  <span
    v-else
    class="grid shrink-0 place-items-center rounded-full font-display font-bold text-white ring-2 ring-white/70"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.4}px`, background: `oklch(0.6 0.15 ${hue})` }"
  >{{ initials }}</span>
</template>
