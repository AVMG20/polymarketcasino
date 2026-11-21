import type { Cell, Grid, PayModel, SlotConfig, SlotWin, SymbolId } from './types'

/** The pay for `count`: the highest listed count at or below it, or 0. */
export function payFor(pays: Readonly<Record<number, number>> | undefined, count: number): number {
    if (!pays) return 0
    let best = 0
    let bestKey = -1
    for (const [key, pay] of Object.entries(pays)) {
        const k = Number(key)
        if (k <= count && k > bestKey) {
            best = pay
            bestKey = k
        }
    }
    return best
}

function kindOf(config: SlotConfig, symbol: SymbolId) {
    return config.symbols[symbol]?.kind ?? 'pay'
}

function evaluateLines(config: SlotConfig, grid: Grid, lines: readonly (readonly number[])[]): SlotWin[] {
    const wins: SlotWin[] = []
    lines.forEach((line, index) => {
        const symbols = line.map((row, col) => grid[col]![row]!)
        if (kindOf(config, symbols[0]!) === 'scatter') return

        // A run of leading wilds can pay as wilds, or extend the first real symbol.
        let wildRun = 0
        while (wildRun < symbols.length && kindOf(config, symbols[wildRun]!) === 'wild') wildRun++
        const wildSymbol = symbols[0]!
        const wildPay = wildRun > 0 ? payFor(config.symbols[wildSymbol]?.pays, wildRun) : 0

        let target: SymbolId | null = null
        let run = 0
        for (const symbol of symbols) {
            const kind = kindOf(config, symbol)
            if (kind === 'scatter') break
            if (kind === 'wild') {
                run++
                continue
            }
            if (target === null) target = symbol
            if (symbol !== target) break
            run++
        }
        const symbolPay = target ? payFor(config.symbols[target]?.pays, run) : 0

        const useWild = wildPay > symbolPay
        const pay = useWild ? wildPay : symbolPay
        const count = useWild ? wildRun : run
        if (pay <= 0) return
        wins.push({
            symbol: useWild ? wildSymbol : target!,
            count,
            cells: line.slice(0, count).map((row, col) => [col, row] as const),
            pay: pay * config.payScale,
            line: index
        })
    })
    return wins
}

function evaluateWays(config: SlotConfig, grid: Grid): SlotWin[] {
    const wins: SlotWin[] = []
    for (const [symbol, def] of Object.entries(config.symbols)) {
        if (def.kind !== 'pay') continue
        let ways = 1
        let reels = 0
        const cells: Cell[] = []
        for (let col = 0; col < grid.length; col++) {
            let hits = 0
            grid[col]!.forEach((s, row) => {
                if (s === symbol || kindOf(config, s) === 'wild') {
                    hits++
                    cells.push([col, row])
                }
            })
            if (!hits) break
            ways *= hits
            reels++
        }
        // A run of reels made only of wilds pays nothing on its own.
        const real = cells.some(([col, row]) => grid[col]![row] === symbol)
        const pay = real ? payFor(def.pays, reels) : 0
        if (pay > 0) {
            wins.push({
                symbol,
                count: reels,
                cells: cells.filter(([col]) => col < reels),
                pay: pay * ways * config.payScale,
                ways
            })
        }
    }
    return wins
}

function evaluateClusters(config: SlotConfig, grid: Grid, minSize: number): SlotWin[] {
    const wins: SlotWin[] = []
    const cols = grid.length
    const rows = grid[0]?.length ?? 0
    for (const [symbol, def] of Object.entries(config.symbols)) {
        if (def.kind !== 'pay') continue
        const matches = (col: number, row: number) => {
            const s = grid[col]![row]!
            return s === symbol || kindOf(config, s) === 'wild'
        }
        const seen = new Set<number>()
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                const id = col * rows + row
                // Grow clusters from a real symbol; wilds only join them.
                if (seen.has(id) || grid[col]![row] !== symbol) continue
                const cluster: Cell[] = []
                const stack: Cell[] = [[col, row]]
                seen.add(id)
                while (stack.length) {
                    const [c, r] = stack.pop()!
                    cluster.push([c, r])
                    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as const) {
                        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
                        const nid = nc * rows + nr
                        if (seen.has(nid) || !matches(nc, nr)) continue
                        seen.add(nid)
                        stack.push([nc, nr])
                    }
                }
                // Wilds may join clusters of several symbols, so release them.
                for (const [c, r] of cluster) if (grid[c]![r] !== symbol) seen.delete(c * rows + r)
                const pay = cluster.length >= minSize ? payFor(def.pays, cluster.length) : 0
                if (pay > 0) wins.push({ symbol, count: cluster.length, cells: cluster, pay: pay * config.payScale })
            }
        }
    }
    return wins
}

/** Every win on a grid under the slot's pay model, before any multiplier. */
export function evaluateGrid(config: SlotConfig, grid: Grid): SlotWin[] {
    const model: PayModel = config.pay
    switch (model.type) {
        case 'lines':
            return evaluateLines(config, grid, model.lines)
        case 'ways':
            return evaluateWays(config, grid)
        case 'cluster':
            return evaluateClusters(config, grid, model.minSize)
    }
}
