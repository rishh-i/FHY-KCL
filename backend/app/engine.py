from dataclasses import dataclass, field
from random import SystemRandom

from treys import Card, Evaluator

RANKS = "23456789TJQKA"
DECK = tuple(rank + suit for rank in RANKS for suit in "shdc")
CARDS = {card: Card.new(card) for card in DECK}
EVALUATOR = Evaluator()
STREETS = ("preflop", "flop", "turn", "river")
SMALL_BLIND, BIG_BLIND = 5, 10


def rank_hand(hole, board):
    return EVALUATOR.evaluate([CARDS[c] for c in hole], [CARDS[c] for c in board])


@dataclass
class Seat:
    name: str
    stack: int = 500
    hole: list[str] = field(default_factory=list)
    folded: bool = False
    bet: int = 0
    paid: int = 0


class PokerTable:
    def __init__(self, opponents=3):
        self.seats = [Seat(name) for name in ("You", "Marlowe", "Vega", "Kit", "Noor", "Jules")[:opponents + 1]]
        self.button = -1
        self.hand = 0
        self.version = 0
        self.start_hand()

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
        self.price = self.increment = BIG_BLIND
        funded = [i for i in self.clockwise(self.button) if self.seats[i].stack]
        self.button = funded[0]
        for seat in self.seats:
            seat.hole, seat.folded, seat.bet, seat.paid = [], False, 0, 0
        order = funded[1:] + funded[:1]
        for _ in range(2):
            for i in order:
                self.seats[i].hole.append(self.deck.pop())
        small, big = (funded[0], funded[1]) if len(funded) == 2 else funded[1:3]
        self.contribute(small, min(SMALL_BLIND, self.seats[small].stack))
        self.contribute(big, min(BIG_BLIND, self.seats[big].stack))
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
        if i != self.actor or i is None:
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
        self.acted_at[i] = self.price
        self.actions.append({"seat": i, "action": action, "chips": seat.paid - before, "phase": self.phase})
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
            self.phase = STREETS[STREETS.index(self.phase) + 1]
            self.deck.pop()
            self.board.extend(self.deck.pop() for _ in range(3 if self.phase == "flop" else 1))
            for seat in self.seats:
                seat.bet = 0
            self.price, self.increment = 0, BIG_BLIND
            self.acted_at.clear()
            after = self.button

    def settle(self, showdown):
        live = self.live()
        ranks = {i: rank_hand(self.seats[i].hole, self.board) for i in live} if showdown else {}
        totals = [seat.paid for seat in self.seats]
        payouts, refunds = {}, {}
        previous = 0
        for level in sorted(set(totals) - {0}):
            contributors = [i for i, total in enumerate(totals) if total >= level]
            value = (level - previous) * len(contributors)
            previous = level
            if len(contributors) == 1:
                refunds[contributors[0]] = value
                continue
            eligible = [i for i in self.clockwise(self.button) if i in live and i in contributors]
            best = min((ranks.get(i, 0) for i in eligible))
            winners = [i for i in eligible if ranks.get(i, 0) == best]
            share, odd = divmod(value, len(winners))
            for offset, i in enumerate(winners):
                payouts[i] = payouts.get(i, 0) + share + (offset < odd)
        for i, seat in enumerate(self.seats):
            seat.stack += payouts.get(i, 0) + refunds.get(i, 0)
            seat.paid = seat.bet = 0
        self.result = {
            "payouts": [{"seat": i, "chips": chips} for i, chips in payouts.items()],
            "refunds": [{"seat": i, "chips": chips} for i, chips in refunds.items()],
            "hands": [{"seat": i, "rank": EVALUATOR.class_to_string(EVALUATOR.get_rank_class(rank))}
                      for i, rank in ranks.items()],
        }
        self.phase = "showdown"

    def view(self, viewer):
        shown = {hand["seat"] for hand in self.result["hands"]} if self.result else set()
        return {
            "hand": self.hand, "version": self.version, "phase": self.phase, "actor": self.actor,
            "button": self.button, "board": list(self.board), "pot": sum(seat.paid for seat in self.seats),
            "legal": self.legal(viewer), "actions": self.actions[-24:], "result": self.result,
            "match_over": self.match_over,
            "players": [
                {"id": i, "name": seat.name, "stack": seat.stack, "bet": seat.bet,
                 "folded": seat.folded, "in_hand": bool(seat.hole),
                 "cards": list(seat.hole) if i == viewer or i in shown else []}
                for i, seat in enumerate(self.seats)
            ],
        }
