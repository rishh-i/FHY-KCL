from typing import Literal

from pydantic import BaseModel, Field

ActionName = Literal["fold", "check", "call", "raise"]
Phase = Literal["preflop", "flop", "turn", "river", "showdown"]


class Action(BaseModel):
    action: ActionName
    amount: int = Field(0, ge=0, strict=True)
    version: int = Field(ge=0, strict=True)


class Message(BaseModel):
    text: str = Field(min_length=1, max_length=240)


class TurnToken(BaseModel):
    version: int = Field(ge=0, strict=True)


class PublicMessage(BaseModel):
    id: int
    hand: int
    seat: int
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
    seat: int
    action: ActionName
    chips: int
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


class GameState(BaseModel):
    id: str
    seq: int
    hand: int
    version: int
    phase: Phase
    actor: int | None
    button: int
    board: list[str]
    pot: int
    legal: dict[ActionName, dict[str, int]]
    actions: list[PlayedAction]
    result: Result | None
    match_over: bool
    players: list[PlayerView]
    messages: list[PublicMessage]
    thinking: int | None
