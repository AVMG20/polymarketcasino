import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from '../shared/tables/cards'
import { Shoe } from '../shared/tables/cards'
import { seededRng } from '../shared/rng'
import { dealerShouldHit, handScore, insuranceCost, settleHand, settleSideBets, type BjHand } from '../shared/tables/blackjack'
import { bacSpotReturn, bankerDraws, dealBaccarat, resolveBacBets, emptyBacBets } from '../shared/tables/baccarat'
import { compareTcp, evaluateTcp, resolveTcp, tcpDealerQualifies } from '../shared/tables/three-card-poker'
import { bestHand, chDealerQualifies, compareCh, evaluateFive, resolveCh } from '../shared/tables/casino-holdem'

let n = 0
const card = (code: string, hidden = false): Card => {
    const rank = code.slice(0, -1) as Rank
    const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as Record<string, Suit>)[code.slice(-1)]!
    return { id: `t${n++}`, rank, suit, ...(hidden ? { hidden: true } : {}) }
}
const cards = (codes: string) => codes.split(' ').map(code => card(code))
const faces = (codes: string) => cards(codes).map(c => ({ rank: c.rank!, suit: c.suit! }))
const hand = (codes: string, bet = 100, extra: Partial<BjHand> = {}): BjHand => ({ id: 'h', cards: cards(codes), bet, status: 'stood', doubled: false, fromSplit: false, score: 0, soft: false, ...extra })

describe('blackjack rules', () => {
    it('scores soft and hard hands, ignoring a face-down card', () => {
        expect(handScore(cards('Ah 6d'))).toEqual({ total: 17, soft: true })
        expect(handScore(cards('Ah 6d 9c'))).toEqual({ total: 16, soft: false })
        expect(handScore([card('Ks'), card('Ah', true)])).toEqual({ total: 10, soft: false })
        expect(dealerShouldHit(cards('Ah 6d'))).toBe(false)
        expect(dealerShouldHit(cards('10h 6d'))).toBe(true)
    })

    it('pays 3:2 on a blackjack, rounded down to 0.0001 coin, and pushes against a dealer blackjack', () => {
        expect(settleHand(hand('Ah Kd', 100), cards('9s 8c'))).toMatchObject({ status: 'blackjack', payout: 250, net: 150 })
        expect(settleHand(hand('Ah Kd', 150), cards('9s 8c')).payout).toBe(375)
        expect(settleHand(hand('Ah Kd', 101), cards('9s 8c')).payout).toBe(252.5)
        expect(settleHand(hand('Ah Kd', 0.0003), cards('9s 8c')).payout).toBe(0.0007)
        expect(settleHand(hand('Ah Kd'), cards('As Qc'))).toMatchObject({ status: 'push', payout: 100 })
        // A split 21 is not a blackjack.
        expect(settleHand(hand('Ah Kd', 100, { fromSplit: true }), cards('10s 9c'))).toMatchObject({ status: 'won', payout: 200 })
    })

    it('settles wins, pushes, busts, doubles and surrenders', () => {
        expect(settleHand(hand('10h 9d'), cards('10s 8c'))).toMatchObject({ status: 'won', payout: 200 })
        expect(settleHand(hand('10h 8d'), cards('10s 8c'))).toMatchObject({ status: 'push', payout: 100 })
        expect(settleHand(hand('10h 7d'), cards('10s 8c'))).toMatchObject({ status: 'lost', payout: 0 })
        expect(settleHand(hand('10h 6d 9c'), cards('10s 6c 9d'))).toMatchObject({ status: 'busted', payout: 0 })
        expect(settleHand(hand('10h 6d'), cards('10s 6c 9d'))).toMatchObject({ status: 'won', payout: 200 })
        expect(settleHand(hand('5h 6d 9c', 100, { doubled: true }), cards('10s 8c'))).toMatchObject({ status: 'won', payout: 400, net: 200 })
        expect(settleHand(hand('10h 6d', 100, { status: 'surrendered' }), cards('10s 8c'))).toMatchObject({ payout: 50, net: -50 })
        expect(settleHand(hand('10h 6d', 150, { status: 'surrendered' }), cards('10s 8c')).payout).toBe(75)
        expect(settleHand(hand('10h 6d', 151, { status: 'surrendered' }), cards('10s 8c'))).toMatchObject({ payout: 75.5, net: -75.5 })
        expect(insuranceCost(151)).toBe(75.5)
    })

    it('pays the side bets off the first two cards and the upcard', () => {
        const stakes = { perfectPairs: 100, twentyOnePlusThree: 100 }
        const [pp, tp] = settleSideBets(stakes, cards('8h 8h'), card('8h'))
        expect(pp).toMatchObject({ label: 'Perfect pair', payout: 2_600 })
        expect(tp).toMatchObject({ label: 'Suited trips', payout: 10_100 })
        expect(settleSideBets(stakes, cards('8h 8d'), card('2c'))[0]).toMatchObject({ label: 'Coloured pair', payout: 1_300 })
        expect(settleSideBets(stakes, cards('8h 8s'), card('2c'))[0]).toMatchObject({ label: 'Mixed pair', payout: 700 })
        expect(settleSideBets(stakes, cards('Qh Kh'), card('Ah'))[1]).toMatchObject({ label: 'Straight flush', payout: 4_100 })
        expect(settleSideBets(stakes, cards('Ah 2d'), card('3c'))[1]).toMatchObject({ label: 'Straight', payout: 1_100 })
        expect(settleSideBets(stakes, cards('Kh 2d'), card('3c'))).toMatchObject([{ payout: 0 }, { payout: 0 }])
    })
})

describe('baccarat rules', () => {
    it('follows the banker third-card table', () => {
        expect(bankerDraws(3, 8)).toBe(false)
        expect(bankerDraws(3, 7)).toBe(true)
        expect(bankerDraws(4, 1)).toBe(false)
        expect(bankerDraws(5, 4)).toBe(true)
        expect(bankerDraws(6, 6)).toBe(true)
        expect(bankerDraws(6, null)).toBe(false)
        expect(bankerDraws(5, null)).toBe(true)
    })

    it('pays banker 0.95 to 0.0001 coin, pushes the main bets on a tie, pays the pairs on their own', () => {
        const banker = { winner: 'banker' as const, playerPair: false, bankerPair: true }
        expect(bacSpotReturn('banker', 100, banker)).toBe(195)
        expect(bacSpotReturn('banker', 150, banker)).toBe(292.5)
        expect(bacSpotReturn('banker', 50, banker)).toBe(97.5)
        expect(resolveBacBets({ ...emptyBacBets(), banker: 150, bankerPair: 50 }, banker)).toEqual({ staked: 200, payout: 892.5 })
        expect(bacSpotReturn('player', 100, banker)).toBe(0)
        expect(bacSpotReturn('bankerPair', 100, banker)).toBe(1_200)
        const tie = { winner: 'tie' as const, playerPair: false, bankerPair: false }
        expect(resolveBacBets({ ...emptyBacBets(), player: 100, banker: 200, tie: 100 }, tie)).toEqual({ staked: 400, payout: 100 + 200 + 900 })
    })

    it('deals a complete hand that matches its own totals', () => {
        const shoe = new Shoe(seededRng(7), 8, 0.85)
        for (let i = 0; i < 500; i++) {
            const round = dealBaccarat(shoe)
            expect(round.playerCards.length).toBeGreaterThanOrEqual(2)
            expect(round.bankerCards.length).toBeLessThanOrEqual(3)
            expect(round.winner).toBe(round.playerTotal > round.bankerTotal ? 'player' : round.bankerTotal > round.playerTotal ? 'banker' : 'tie')
        }
    })
})

describe('three card poker rules', () => {
    it('ranks a straight over a flush, and A-2-3 as the lowest straight', () => {
        expect(compareTcp(evaluateTcp(faces('4h 5d 6c')), evaluateTcp(faces('2h 9h Kh')))).toBeGreaterThan(0)
        expect(evaluateTcp(faces('Ah 2d 3c'))).toMatchObject({ category: 'straight', values: [3] })
        expect(compareTcp(evaluateTcp(faces('Ah 2d 3c')), evaluateTcp(faces('2h 3d 4c')))).toBeLessThan(0)
        expect(tcpDealerQualifies(evaluateTcp(faces('Qh 5d 2c')))).toBe(true)
        expect(tcpDealerQualifies(evaluateTcp(faces('Jh 10d 8c')))).toBe(false)
    })

    it('settles ante, play, ante bonus and pair plus', () => {
        const straight = evaluateTcp(faces('4h 5d 6c'))
        // Dealer doesn't qualify: ante pays even money, play pushes, bonus still pays.
        expect(resolveTcp({ ante: 100, pairPlus: 100, played: true }, straight, evaluateTcp(faces('Jh 9d 2c')))).toMatchObject({ staked: 300, payout: 300 + 100 + 700, ante: 'win', play: 'push' })
        // Dealer qualifies and loses: ante and play pay even money.
        expect(resolveTcp({ ante: 100, pairPlus: 0, played: true }, straight, evaluateTcp(faces('Kh Kd 2c')))).toMatchObject({ payout: 400 + 100, net: 300 })
        // Folding keeps the pair plus.
        expect(resolveTcp({ ante: 100, pairPlus: 100, played: false }, evaluateTcp(faces('9h 9d 2c')), evaluateTcp(faces('Ah Kd 2c')))).toMatchObject({ staked: 200, payout: 200, ante: 'fold' })
        // Flush pays 4 to 1 on pair plus.
        expect(resolveTcp({ ante: 0, pairPlus: 100, played: false }, evaluateTcp(faces('2h 9h Kh')), evaluateTcp(faces('Ah Kd 2c'))).payout).toBe(500)
    })
})

describe("casino hold'em rules", () => {
    it('evaluates the best five of seven, including the wheel and a royal', () => {
        expect(evaluateFive(faces('Ah 2d 3c 4s 5h'))).toMatchObject({ category: 'straight', tiebreak: [5] })
        expect(bestHand(faces('Ah Kh Qh Jh 10h 2c 3d')).category).toBe('royal-flush')
        expect(bestHand(faces('9h 9d 9c 4s 4h 2c 3d')).category).toBe('full-house')
        expect(compareCh(bestHand(faces('Ah Kd 7c 7s 2h 3c 9d')), bestHand(faces('Qh Jd 7c 7s 2h 3c 9d')))).toBeGreaterThan(0)
        expect(chDealerQualifies(evaluateFive(faces('4h 4d 9c Js 2h')))).toBe(true)
        expect(chDealerQualifies(evaluateFive(faces('3h 3d 9c Js 2h')))).toBe(false)
    })

    it('settles a seat: non-qualifying dealer, win by paytable, fold keeps the AA bonus', () => {
        const flush = evaluateFive(faces('2h 5h 9h Jh Kh'))
        const lowDealer = evaluateFive(faces('3s 3d 9c Js 2c'))
        const goodDealer = evaluateFive(faces('Qs Qd 9c Js 2c'))
        expect(resolveCh({ ante: 100, call: 200, aa: 0 }, { folded: false, player: flush, dealer: lowDealer, aa: null })).toMatchObject({ outcome: 'win', payout: 300 + 200 })
        expect(resolveCh({ ante: 100, call: 200, aa: 0 }, { folded: false, player: flush, dealer: goodDealer, aa: null })).toMatchObject({ outcome: 'win', payout: 300 + 400 })
        expect(resolveCh({ ante: 100, call: 0, aa: 100 }, { folded: true, player: null, dealer: goodDealer, aa: evaluateFive(faces('Ah Ad 9c 4s 2h')) })).toMatchObject({ outcome: 'folded', staked: 200, payout: 800 })
        expect(resolveCh({ ante: 100, call: 0, aa: 100 }, { folded: true, player: null, dealer: goodDealer, aa: evaluateFive(faces('Kh Kd 9c 4s 2h')) }).payout).toBe(0)
    })
})
