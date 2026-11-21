import pytest

from app.engine import DECK, PokerTable, rank_hand


def passive(table):
    while table.actor is not None:
        actor = table.actor
        table.act(actor, "check" if "check" in table.legal(actor) else "call")


def test_deal_and_private_observations():
    table = PokerTable()
    dealt = [card for seat in table.seats for card in seat.hole]
    assert len(DECK) == len(set(DECK)) == 52
    assert len(dealt) == 8
    assert len(set(dealt + table.deck)) == 52
    for viewer in range(4):
        assert [p["id"] for p in table.view(viewer)["players"] if p["cards"]] == [viewer]


def test_betting_order_and_streets():
    table = PokerTable()
    for actor in [3, 0, 1, 2]:
        assert table.actor == actor
        table.act(actor, "check" if actor == 2 else "call")
    for phase, size in [("flop", 3), ("turn", 4), ("river", 5)]:
        assert table.phase == phase and len(table.board) == size
        for actor in [1, 2, 3, 0]:
            assert table.actor == actor
            table.act(actor, "check")
    assert table.phase == "showdown"
    assert sum(seat.stack for seat in table.seats) == 2000
    table.start_hand()
    assert table.button == 1 and table.hand == 2


def test_invalid_actions_are_atomic():
    table = PokerTable()
    before = table.view(0)
    for seat, action, amount in [(0, "call", 0), (3, "check", 0), (3, "raise", 19)]:
        with pytest.raises(ValueError):
            table.act(seat, action, amount)
    assert table.view(0) == before


def test_evaluator_and_split():
    assert rank_hand(["As", "Ad"], ["2s", "3d", "4c", "8d", "9h"]) < rank_hand(
        ["Ks", "Kd"], ["2s", "3d", "4c", "8d", "9h"]
    )
    table = PokerTable()
    for _ in range(4):
        table.act(table.actor, "check" if table.actor == 2 else "call")
    for i, seat in enumerate(table.seats):
        seat.hole = list(DECK[i * 4:i * 4 + 2])
    table.board = ["As", "Ks", "Qs"]
    table.deck[-4:] = ["Ts", "2c", "Js", "3c"]
    passive(table)
    assert {p["chips"] for p in table.result["payouts"]} == {10}
    assert len(table.result["payouts"]) == 4


def test_side_pots_and_uncalled_refund():
    table = PokerTable()
    for seat, paid, hole in zip(table.seats, [20, 50, 80, 100],
                                [["As", "Ad"], ["Ks", "Kd"], ["Qs", "Qd"], ["Js", "Jd"]]):
        seat.hole = hole
        seat.stack, seat.paid = 0, paid
    table.board = ["2s", "3d", "4c", "8d", "9h"]
    table.settle(True)
    assert [seat.stack for seat in table.seats] == [80, 90, 60, 20]


def test_short_raise_does_not_reopen():
    table = PokerTable()
    table.seats[1].stack = 20
    table.act(3, "raise", 20)
    table.act(0, "call")
    table.act(1, "raise", 25)
    table.act(2, "call")
    assert table.actor == 3
    assert set(table.legal(3)) == {"fold", "call"}


def test_fold_win_keeps_cards_hidden():
    table = PokerTable()
    for i in [3, 0, 1]:
        table.act(i, "fold")
    state = table.view(0)
    assert state["phase"] == "showdown"
    assert state["result"]["payouts"] == [{"seat": 2, "chips": 10}]
    assert state["players"][2]["cards"] == []
