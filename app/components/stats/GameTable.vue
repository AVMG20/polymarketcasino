<script setup lang="ts">
import { ArrowDown, ArrowUp } from 'lucide-vue-next'
import { formatCoins, formatCoinsExact } from '#shared/money'
import type { GameStats } from '#shared/stats'

/**
 * Results per game, sortable by any column (most wagered first). Picking a
 * game narrows the page to it; picking it again shows every game.
 */
const props = defineProps<{ games: GameStats[], selected: string | null }>()
const emit = defineEmits<{ select: [game: string | null] }>()

type SortKey = 'name' | 'rounds' | 'wagered' | 'paidOut' | 'net' | 'returnRate' | 'biggestWin'

const columns: { key: SortKey, label: string, title?: string, wide?: boolean }[] = [
    { key: 'rounds', label: 'Rounds', wide: true },
    { key: 'wagered', label: 'Wagered' },
    { key: 'paidOut', label: 'Paid out', wide: true, title: 'Paid in chips' },
    { key: 'net', label: 'Net' },
    { key: 'returnRate', label: 'Return', title: 'Paid out ÷ wagered' },
    { key: 'biggestWin', label: 'Best win', title: 'Biggest profit on one round', wide: true }
]

const sortKey = ref<SortKey>('wagered')
const descending = ref(true)

function sortBy(key: SortKey) {
    if (sortKey.value === key) {
        descending.value = !descending.value
    } else {
        sortKey.value = key
        descending.value = key !== 'name'
    }
}

const sorted = computed(() => {
    const key = sortKey.value
    const dir = descending.value ? -1 : 1
    return [...props.games].sort((a, b) => {
        const by = key === 'name' ? a.name.localeCompare(b.name) : (a[key] ?? -1) - (b[key] ?? -1)
        return by * dir || b.wagered - a.wagered
    })
})

const ariaSort = (key: SortKey) => (sortKey.value === key ? (descending.value ? 'descending' : 'ascending') : 'none')
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <caption class="sr-only">Results per game</caption>
      <thead class="text-xs text-muted-foreground">
        <tr class="border-b">
          <th scope="col" class="py-1 pr-1.5 text-left font-medium sm:pr-2" :aria-sort="ariaSort('name')">
            <button type="button" class="inline-flex min-h-10 items-center gap-1 hover:text-foreground sm:min-h-8" @click="sortBy('name')">
              Game
              <component :is="descending ? ArrowDown : ArrowUp" v-if="sortKey === 'name'" class="size-3" aria-hidden="true" />
            </button>
          </th>
          <th
            v-for="c in columns"
            :key="c.key"
            scope="col"
            class="px-1.5 py-1 text-right font-medium last:pr-0 sm:px-2"
            :class="c.wide ? 'hidden sm:table-cell' : ''"
            :aria-sort="ariaSort(c.key)"
          >
            <button type="button" class="inline-flex min-h-10 items-center gap-1 hover:text-foreground sm:min-h-8" :title="c.title" @click="sortBy(c.key)">
              <component :is="descending ? ArrowDown : ArrowUp" v-if="sortKey === c.key" class="size-3" aria-hidden="true" />
              {{ c.label }}
            </button>
          </th>
        </tr>
      </thead>
      <tbody class="divide-y tabular-nums">
        <tr
          v-for="g in sorted"
          :key="g.game"
          class="cursor-pointer transition-colors hover:bg-muted/60"
          :class="selected === g.game ? 'bg-primary/10' : ''"
          @click="emit('select', selected === g.game ? null : g.game)"
        >
          <th scope="row" class="w-full max-w-0 py-0 pr-1.5 text-left font-medium sm:pr-2">
            <button
              type="button"
              class="block min-h-11 w-full truncate text-left outline-none focus-visible:underline"
              :aria-pressed="selected === g.game"
              :title="g.name"
              @click.stop="emit('select', selected === g.game ? null : g.game)"
            >
              {{ g.name }}
            </button>
          </th>
          <td class="hidden px-2 text-right sm:table-cell">{{ formatCoins(g.rounds) }}</td>
          <td class="px-1.5 text-right sm:px-2" :title="formatCoinsExact(g.wagered)">{{ formatCoins(g.wagered, g.wagered >= 1e6) }}</td>
          <td class="hidden px-2 text-right sm:table-cell" :title="formatCoinsExact(g.paidOut)">{{ formatCoins(g.paidOut) }}</td>
          <td class="px-1.5 text-right font-medium sm:px-2" :title="formatCoinsExact(g.net)">{{ formatSignedCoins(g.net, Math.abs(g.net) >= 1e6) }}</td>
          <td class="px-1.5 text-right last:pr-0 sm:px-2 sm:last:pr-2">{{ formatReturn(g.returnRate) }}</td>
          <td class="hidden pl-2 text-right sm:table-cell" :title="formatCoinsExact(g.biggestWin)">{{ g.biggestWin ? formatCoins(g.biggestWin) : '–' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
