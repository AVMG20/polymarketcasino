<script setup lang="ts">
import { LayoutGrid } from 'lucide-vue-next'
import type { BuildKind } from '#shared/tycoon'

/** One item's card: what the floor opens when you tap an empty plot or a zone for sale. Floats low; a tap outside closes it. */
defineProps<{ target: { kind: BuildKind, id: string } | null }>()
const emit = defineEmits<{ close: [], menu: [], play: [slug: string], open: [kind: BuildKind, id: string] }>()
</script>

<template>
  <TycoonDrawer :open="!!target" card dismissable height="72dvh" @close="emit('close')">
    <TycoonBuildDetail v-if="target" :key="`${target.kind}:${target.id}`" :kind="target.kind" :id="target.id" @started="emit('close')" @play="slug => emit('play', slug)" @open="(kind, id) => emit('open', kind, id)">
      <template #actions>
        <button type="button" class="g-btn g-dark size-11 shrink-0 rounded-xl" title="Build menu" aria-label="Build menu" @click="emit('menu')">
          <LayoutGrid class="size-5" :stroke-width="2.75" />
        </button>
      </template>
    </TycoonBuildDetail>
  </TycoonDrawer>
</template>
