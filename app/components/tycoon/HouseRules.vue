<script setup lang="ts">
import { Check, Timer } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { findZone } from '#shared/tycoon'
import { RULE_UNLOCKS, type HouseRuleOption } from '#shared/visitors'

/**
 * The house rules (state.house): one exclusive choice per unlocked rule.
 * Each option says what it does and what it would change the expected
 * income by before it is picked; a change starts a cooldown.
 */
const tycoon = useTycoon()
const rules = useHouseRules()
const groups = computed(() => rules.groups.value)
const cooling = computed(() => rules.cooldownMs.value > 0)
const expected = computed(() => tycoon.expectedPerHour.value)
/** The next rule still locked and the room that brings it, or null when every rule is open. */
const more = computed(() => {
    const next = RULE_UNLOCKS.find(r => !rules.unlocked.value.includes(r.rule))
    return next ? `${RULE_INFO[next.rule].name} comes with the ${findZone(next.zone)?.name ?? next.zone}.` : null
})

function deltaText(o: HouseRuleOption): string {
    const rounded = Math.round(o.delta)
    return rounded === 0 ? '±0/h' : `${formatSignedCoins(rounded)}/h`
}
function deltaClass(o: HouseRuleOption): string {
    const rounded = Math.round(o.delta)
    return rounded > 0 ? 'text-[#7ee08f]' : rounded < 0 ? 'text-[#ff8a8a]' : 'text-[var(--g-muted)]'
}
function optionTitle(o: HouseRuleOption): string {
    if (o.active) return `${o.label}: your casino runs this now`
    if (cooling.value) return `You can change a rule again in ${formatCountdown(rules.cooldownMs.value)}`
    return `${o.label}: about ${deltaText(o).replace('/h', '')} coins an hour on average`
}
</script>

<template>
  <div class="space-y-3 px-3 pb-3">
    <p v-if="expected !== null" class="g-well flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold" title="What your floor earns an hour on average with these rules (good and quiet hours even out)">
      <CasinoCoinIcon class="size-5 shrink-0" />
      <span class="text-[var(--g-muted)]">On average</span>
      <span class="g-num ml-auto text-base text-[#7ee08f]">{{ formatCoins(expected) }}/h avg</span>
    </p>

    <p v-if="cooling" class="flex items-center gap-1.5 rounded-xl bg-[#ff9a2e]/15 px-3 py-2 text-[13px] font-semibold text-[#ffb35c]" role="status">
      <Timer class="size-4 shrink-0" :stroke-width="3" />
      Rules can change again in <span class="g-num">{{ formatCountdown(rules.cooldownMs.value) }}</span>
    </p>

    <section v-for="g in groups" :key="g.rule" class="space-y-1.5" :aria-labelledby="`rule-${g.rule}`">
      <h3 :id="`rule-${g.rule}`" class="g-title flex items-center gap-1.5 text-base leading-5">
        <component :is="g.icon" class="size-4.5 shrink-0" :style="{ color: g.color }" :stroke-width="3" />
        {{ g.name }}
      </h3>
      <div class="space-y-1.5" role="radiogroup" :aria-labelledby="`rule-${g.rule}`">
        <button
          v-for="o in g.options"
          :key="String(o.value)"
          type="button"
          role="radio"
          :aria-checked="o.active"
          class="option flex min-h-12 w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left transition-transform active:scale-[0.98]"
          :class="o.active ? 'option-on' : ''"
          :aria-disabled="!o.active && cooling"
          :disabled="tycoon.busy.value && !o.active"
          :title="optionTitle(o)"
          @click="rules.pick(o)"
        >
          <span class="grid size-5 shrink-0 place-items-center rounded-full border-2" :class="o.active ? 'border-[#3fd25a] bg-[#3fd25a]' : 'border-white/30'">
            <Check v-if="o.active" class="size-3 text-[#0b3a17]" :stroke-width="4" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[15px] leading-5 font-semibold">{{ o.label }}</span>
            <span class="block text-[12.5px] leading-4 text-[var(--g-muted)]">{{ o.description }}</span>
          </span>
          <span v-if="o.active" class="g-num shrink-0 rounded-full bg-[#3fd25a]/20 px-2 text-xs leading-6 text-[#7ee08f]">Now</span>
          <span v-else class="g-num shrink-0 text-sm whitespace-nowrap" :class="[deltaClass(o), cooling ? 'opacity-50' : '']">{{ deltaText(o) }}</span>
        </button>
      </div>
    </section>

    <p v-if="more" class="text-center text-[12px] font-semibold text-[var(--g-muted)]">{{ more }}</p>
  </div>
</template>

<style scoped>
.option {
  background: linear-gradient(180deg, #3a2c57, #2e2246 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 3px 0 #120c1d;
}
.option[aria-disabled='true'] { cursor: default; }
.option:disabled { opacity: 0.7; }
.option-on {
  border-color: #1b8a33;
  box-shadow: 0 3px 0 #120c1d, 0 0 0 2px rgb(63 210 90 / 0.45);
}
</style>
