// `bun scripts/blackjack-rtp.ts [hands] [bet] [seed]`: live blackjack played
// with basic strategy on the table's rules and shoe, plus both side bets.
import { Shoe } from '../shared/tables/cards'
import {
    basicStrategy, BJ_RULES, canHit, dealerHasBlackjack, dealerShouldHit, handScore, handStake,
    isBlackjack, settleHand, settleSideBets, type BjHand
} from '../shared/tables/blackjack'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(2_000_000)
const shoe = new Shoe(seededRng(seed), BJ_RULES.decks, BJ_RULES.penetration)
const main = new Tally()
const pairs = new Tally()
const plus3 = new Tally()
let seq = 0

const newHand = (fromSplit: boolean): BjHand => ({ id: `h${seq++}`, cards: [], bet, status: 'playing', doubled: false, fromSplit, score: 0, soft: false })

for (let i = 0; i < rounds; i++) {
    if (shoe.needsShuffle) shoe.shuffle()
    const hands = [newHand(false)]
    hands[0]!.cards.push(shoe.draw())
    const dealer = [shoe.draw()]
    hands[0]!.cards.push(shoe.draw())
    dealer.push(shoe.draw(true))
    const up = dealer[0]!

    const sides = settleSideBets({ perfectPairs: bet, twentyOnePlusThree: bet }, hands[0]!.cards, up)
    pairs.add(bet, sides[0]!.payout)
    plus3.add(bet, sides[1]!.payout)

    if (isBlackjack(hands[0]!)) hands[0]!.status = 'blackjack'
    // The dealer peeks under an ace or a ten; insurance is never taken.
    const peeked = dealerHasBlackjack(dealer)
    if (!peeked) {
        for (let h = 0; h < hands.length; h++) {
            const hand = hands[h]!
            while (hand.status === 'playing') {
                if (!canHit(hand)) {
                    hand.status = 'stood'
                    break
                }
                const action = basicStrategy(hand, up.rank!, hands)
                if (action === 'stand') hand.status = 'stood'
                else if (action === 'surrender') hand.status = 'surrendered'
                else if (action === 'hit') {
                    hand.cards.push(shoe.draw())
                    if (handScore(hand.cards).total > 21) hand.status = 'busted'
                } else if (action === 'double') {
                    hand.doubled = true
                    hand.cards.push(shoe.draw())
                    hand.status = handScore(hand.cards).total > 21 ? 'busted' : 'stood'
                } else {
                    const aces = hand.cards[0]!.rank === 'A'
                    const sibling = newHand(true)
                    sibling.cards.push(hand.cards.pop()!)
                    hand.fromSplit = true
                    hand.cards.push(shoe.draw())
                    sibling.cards.push(shoe.draw())
                    hands.splice(h + 1, 0, sibling)
                    if (aces) hand.status = sibling.status = 'stood'
                }
            }
        }
    }
    dealer[1]!.hidden = undefined
    if (!peeked && hands.some(hand => hand.status === 'stood')) {
        while (dealerShouldHit(dealer)) dealer.push(shoe.draw())
    }
    let staked = 0
    let paid = 0
    for (const hand of hands) {
        staked += handStake(hand)
        paid += settleHand(hand, dealer).payout
    }
    main.add(staked, paid)
}

console.log(main.line('main (basic)'))
console.log(pairs.line('perfect pairs'))
console.log(plus3.line('21+3'))
