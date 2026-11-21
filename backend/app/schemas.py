from typing import Literal

from pydantic import BaseModel, Field, model_validator

ActionName = Literal["fold", "check", "call", "raise"]
Phase = Literal["preflop", "flop", "turn", "river", "showdown"]
Pace = Literal["fast", "normal", "slow"]
Chatter = Literal["quiet", "normal", "chatty"]


class Settings(BaseModel):
    opponents: int = Field(3, ge=3, le=5, strict=True)
    small_blind: int = Field(5, ge=1, le=10_000, strict=True)
    big_blind: int = Field(10, ge=2, le=20_000, strict=True)
    stack: int = Field(1000, ge=20, le=2_000_000, strict=True)
    pace: Pace = "normal"
    live_thoughts: bool = False
    chatter: Chatter = "normal"

    @model_validator(mode="after")
    def sensible(self):
        if self.small_blind > self.big_blind:
            raise ValueError("The small blind cannot exceed the big blind")
        if not 20 * self.big_blind <= self.stack <= 500 * self.big_blind:
            raise ValueError("Starting stacks must be between 20 and 500 big blinds")
        return self


class SettingsPatch(BaseModel):
    pace: Pace | None = None
    live_thoughts: bool | None = None
    chatter: Chatter | None = None


class Action(BaseModel):
    action: ActionName
    amount: int = Field(0, ge=0, strict=True)
    version: int = Field(ge=0, strict=True)


class ShowChoice(BaseModel):
    choice: Literal["show", "muck"]
    version: int = Field(ge=0, strict=True)


class Message(BaseModel):
    text: str = Field(min_length=1, max_length=240)


class TurnToken(BaseModel):
    version: int = Field(ge=0, strict=True)


class PublicMessage(BaseModel):
    id: int
    hand: int
    seat: int
    to: int | None
    text: str


class PlayerView(BaseModel):
    id: int
    name: str
    stack: int
    bet: int
    folded: bool
    in_hand: bool
    cards: list[str]


class PlayedAction(BaseModel):
    hand: int
    seat: int
    action: ActionName
    chips: int
    to: int
    phase: Phase


class Award(BaseModel):
    seat: int
    chips: int


class ShownHand(BaseModel):
    seat: int
    rank: str


class Result(BaseModel):
    payouts: list[Award]
    refunds: list[Award]
    hands: list[ShownHand]
    mucked: list[int]
    winners: list[int]
    pot: int
    showdown: bool


class SeatStats(BaseModel):
    seat: int
    name: str
    stack: int
    net: int
    hands: int
    vpip: int
    pfr: int
    won: int
    showdowns: int
    showdowns_won: int
    biggest_pot: int


class HandRecord(BaseModel):
    hand: int
    board: list[str]
    pot: int
    showdown: bool
    winners: list[Award]
    deltas: list[int]
    hands: list[ShownHand]
    your_cards: list[str]


class ThoughtLog(BaseModel):
    id: int
    seat: int
    hand: int
    phase: str | None
    kind: Literal["decision", "talk", "read", "style", "showdown"]
    title: str
    details: list[str]
    talk_changed: bool = False


class GameState(BaseModel):
    id: str
    seq: int
    hand: int
    version: int
    phase: Phase
    actor: int | None
    button: int
    blinds: list[int]
    board: list[str]
    pot: int
    legal: dict[ActionName, dict[str, int]]
    actions: list[PlayedAction]
    result: Result | None
    match_over: bool
    runout: bool
    choices: list[Literal["show", "muck"]]
    players: list[PlayerView]
    messages: list[PublicMessage]
    thinking: int | None
    settings: Settings
    stats: list[SeatStats]
    history: list[HandRecord]
    logs: list[ThoughtLog]
    locked_logs: int
