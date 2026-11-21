"""Authoritative no-limit Texas Hold'em rules."""
from dataclasses import dataclass, field
from random import SystemRandom

from treys import Card, Evaluator

RANKS = "23456789TJQKA"
DECK = tuple(rank + suit for rank in RANKS for suit in "shdc")
CARDS = {card: Card.new(card) for card in DECK}
EVALUATOR = Evaluator()
STREETS = ("preflop", "flop", "turn", "river")
NAMES = ("You", "Marlowe", "Vega", "Kit", "Noor", "Jules")


def rank_hand(hole, board):
    """Lower is stronger. Needs five to seven cards in total."""
    return EVALUATOR.evaluate([CARDS[c] for c in board], [CARDS[c] for c in hole])


def hand_class(hole, board):
    """1 = straight flush … 9 = high card."""
    return EVALUATOR.get_rank_class(rank_hand(hole, board))


def describe(hole, board):
    if len(board) < 3:
        return "Pocket pair" if hole[0][0] == hole[1][0] else "High card"
    return EVALUATOR.class_to_string(hand_class(hole, board))


@dataclass
class Seat:
    name: str
    stack: int = 500
    hole: list[str] = field(default_factory=list)
    folded: bool = False
    bet: int = 0
    paid: int = 0


class PokerTable:
    def __init__(self, opponents=3, small_blind=5, big_blind=10, stack=500, stepped=False):
        if not 1 <= opponents <= 5:
            raise ValueError("Opponents must be between 1 and 5")
        if not 0 < small_blind <= big_blind < stack:
            raise ValueError("Blinds must be positive and smaller than the stack")
        self.small_blind, self.big_blind = small_blind, big_blind
        # Stepped tables pause between run-out streets so a caller can pace them.
        self.stepped = stepped
        self.seats = [Seat(name, stack) for name in NAMES[:opponents + 1]]
        self.button = -1
        self.hand = 0
        self.version = 0
        self.phase = "showdown"
        self.start_hand()

    # --- helpers -----------------------------------------------------------
    def clockwise(self, after):
        return [(after + offset) % len(self.seats) for offset in range(1, len(self.seats) + 1)]

    def live(self):
        return [i for i, seat in enumerate(self.seats) if seat.hole and not seat.folded]

    def actionable(self):
        return [i for i in self.live() if self.seats[i].stack]

    @property
    def match_over(self):
        return self.phase == "showdown" and (
            not self.seats[0].stack or sum(seat.stack > 0 for seat in self.seats) < 2
        )

    # --- hand flow ----------------------------------------------------------
    def start_hand(self):
        if self.hand and (self.phase != "showdown" or self.match_over):
            raise ValueError("A new hand is unavailable")
        self.hand += 1
        self.version += 1
        self.deck = list(DECK)
        SystemRandom().shuffle(self.deck)
        self.board = []
        self.phase = "preflop"
        self.actions = []
        self.result = None
        self.actor = None
        self.acted_at = {}
        self.shown, self.optional, self.mucked, self.winners = set(), set(), set(), set()
        self.runout = False
        self.aggressor = None
        self.order = []
        self.price = self.increment = self.big_blind
        funded = [i for i in self.clockwise(self.button) if self.seats[i].stack]
        self.button = funded[0]
        for seat in self.seats:
            seat.hole, seat.folded, seat.bet, seat.paid = [], False, 0, 0
        self.start_stacks = [seat.stack for seat in self.seats]
        order = funded[1:] + funded[:1]
        for _ in range(2):
            for i in order:
                self.seats[i].hole.append(self.deck.pop())
        # Heads-up, the button posts the small blind.
        small, big = (funded[0], funded[1]) if len(funded) == 2 else funded[1:3]
        self.blinds = (small, big)
        self.contribute(small, min(self.small_blind, self.seats[small].stack))
        self.contribute(big, min(self.big_blind, self.seats[big].stack))
        self.advance(big)

    def contribute(self, i, chips):
        seat = self.seats[i]
        seat.stack -= chips
        seat.bet += chips
        seat.paid += chips

    def target(self, i):
        if len(self.actionable()) == 1:
            return max((self.seats[j].bet for j in self.live() if j != i), default=0)
        return self.price

    def legal(self, i):
        if i is None or i != self.actor:
            return {}
        seat = self.seats[i]
        due = max(0, self.target(i) - seat.bet)
        legal = {"fold": {}} if due else {}
        legal.update({"call": {"amount": min(due, seat.stack)}} if due else {"check": {}})
        maximum = seat.bet + seat.stack
        reopened = i not in self.acted_at or self.price - self.acted_at[i] >= self.increment
        if len(self.actionable()) > 1 and reopened and maximum > self.price:
            legal["raise"] = {"min": min(maximum, self.price + self.increment), "max": maximum}
        return legal

    def act(self, i, action, amount=0):
        legal = self.legal(i)
        if action not in legal:
            raise ValueError("Action unavailable")
        if action == "raise" and not legal[action]["min"] <= amount <= legal[action]["max"]:
            raise ValueError("Raise outside legal range")
        seat = self.seats[i]
        before = seat.paid
        if action == "fold":
            seat.folded = True
        elif action == "call":
            self.contribute(i, legal[action]["amount"])
        elif action == "raise":
            self.contribute(i, amount - seat.bet)
            self.increment = max(self.increment, amount - self.price)
            self.price = amount
            self.aggressor = i
        self.acted_at[i] = self.price
        self.actions.append({"hand": self.hand, "seat": i, "action": action, "chips": seat.paid - before,
                             "to": seat.bet, "phase": self.phase})
        self.version += 1
        self.advance(i)

    def advance(self, after):
        while True:
            live = self.live()
            self.actor = None
            if len(live) == 1:
                self.settle(False)
                return
            active = self.actionable()
            for i in self.clockwise(after):
                if i not in active:
                    continue
                behind = self.seats[i].bet < self.target(i)
                if behind or (len(active) > 1 and i not in self.acted_at):
                    self.actor = i
                    return
            if self.phase == "river":
                self.settle(True)
                return
            betting_closed = len(active) < 2
            if betting_closed:
                # All-in and called: every live hand is turned face up for the run-out.
                self.shown |= set(live)
            self.phase = STREETS[STREETS.index(self.phase) + 1]
            self.deck.pop()  # burn
            self.board.extend(self.deck.pop() for _ in range(3 if self.phase == "flop" else 1))
            for seat in self.seats:
                seat.bet = 0
            self.price, self.increment = 0, self.big_blind
            self.acted_at.clear()
            self.aggressor = None  # tracks the last raiser on the current street
            after = self.button
            if betting_closed and self.stepped:
                self.runout = True
                return

    def step_runout(self):
        if not self.runout:
            raise ValueError("No run-out in progress")
        self.runout = False
        self.version += 1
        self.advance(self.button)

    def show_order(self, live):
        start = self.aggressor if self.aggressor in live else None
        order = [i for i in self.clockwise(self.button) if i in live]
        if start is not None:
            k = order.index(start)
            order = order[k:] + order[:k]
        return order

    def settle(self, showdown):
        live = self.live()
        ranks = {i: rank_hand(self.seats[i].hole, self.board) for i in live} if showdown else {}
        if showdown and any(not self.seats[i].stack for i in live):
            # TDA: once a player is all in and betting is complete, all hands are tabled.
            self.shown |= set(live)
        totals = [seat.paid for seat in self.seats]
        pot = sum(totals)
        payouts, refunds = {}, {}
        previous = 0
        for level in sorted(set(totals) - {0}):
            contributors = [i for i, total in enumerate(totals) if total >= level]
            value = (level - previous) * len(contributors)
            previous = level
            if len(contributors) == 1:
                refunds[contributors[0]] = refunds.get(contributors[0], 0) + value
                continue
            eligible = [i for i in self.clockwise(self.button) if i in live and i in contributors]
            if not eligible:  # dead money only; give it to the best live hand
                eligible = [i for i in self.clockwise(self.button) if i in live]
            best = min(ranks.get(i, 0) for i in eligible)
            winners = [i for i in eligible if ranks.get(i, 0) == best]
            share, odd = divmod(value, len(winners))
            for offset, i in enumerate(winners):
                payouts[i] = payouts.get(i, 0) + share + (offset < odd)
        for i, seat in enumerate(self.seats):
            seat.stack += payouts.get(i, 0) + refunds.get(i, 0)
            seat.paid = seat.bet = 0
        self.winners = set(payouts)
        self.order = self.show_order(live)
        if showdown:
            # Winners must table their cards to claim the pot; losers may show or muck.
            self.shown |= self.winners
        # An uncontested winner may also show voluntarily. Hands already tabled
        # during an all-in run-out stay face up.
        self.optional = set(live) - self.shown
        self.result = {
            "payouts": [{"seat": i, "chips": chips} for i, chips in payouts.items()],
            "refunds": [{"seat": i, "chips": chips} for i, chips in refunds.items()],
            "pot": pot, "showdown": showdown,
        }
        self.phase = "showdown"
        self.actor = None
        self.runout = False

    def reveal(self, i, show):
        if self.phase != "showdown" or i not in self.optional:
            raise ValueError("No show or muck decision is pending")
        self.optional.discard(i)
        (self.shown if show else self.mucked).add(i)
        self.version += 1

    # --- views ---------------------------------------------------------------
    def shown_hands(self):
        order = self.order or self.clockwise(self.button)
        return [{"seat": i, "rank": describe(self.seats[i].hole, self.board)}
                for i in order if i in self.shown and self.seats[i].hole]

    def view(self, viewer):
        result = None
        if self.result:
            result = {**self.result, "hands": self.shown_hands(), "mucked": sorted(self.mucked),
                      "winners": sorted(self.winners)}
        return {
            "hand": self.hand, "version": self.version, "phase": self.phase, "actor": self.actor,
            "button": self.button, "blinds": [self.small_blind, self.big_blind],
            "board": list(self.board),
            "pot": self.result["pot"] if self.result else sum(seat.paid for seat in self.seats),
            "legal": self.legal(viewer), "actions": self.actions[-30:], "result": result,
            "match_over": self.match_over, "runout": self.runout,
            "choices": ["show", "muck"] if viewer is not None and viewer in self.optional else [],
            "players": [
                {"id": i, "name": seat.name, "stack": seat.stack, "bet": seat.bet,
                 "folded": seat.folded, "in_hand": bool(seat.hole),
                 "cards": list(seat.hole) if i == viewer or i in self.shown else []}
                for i, seat in enumerate(self.seats)
            ],
        }
