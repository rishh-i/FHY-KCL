import pytest

from app.engine import DECK, PokerTable, rank_hand


def passive(table):
    while table.actor is not None or table.runout:
        if table.runout:
            table.step_runout()
            continue
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


def test_configurable_stakes_and_stacks():
    table = PokerTable(opponents=5, small_blind=25, big_blind=50, stack=5000)
    assert len(table.seats) == 6
    assert sorted(seat.paid for seat in table.seats)[-2:] == [25, 50]
    assert sum(seat.stack + seat.paid for seat in table.seats) == 30000
    with pytest.raises(ValueError):
        PokerTable(small_blind=20, big_blind=10)


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
    assert table.actions[-1]["hand"] == 1 and "to" in table.actions[-1]
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
    # Every split winner had to show; nobody is left with a choice.
    assert table.shown == {0, 1, 2, 3} and not table.optional


def test_side_pots_and_uncalled_refund():
    table = PokerTable()
    for seat, paid, hole in zip(table.seats, [20, 50, 80, 100],
                                [["As", "Ad"], ["Ks", "Kd"], ["Qs", "Qd"], ["Js", "Jd"]]):
        seat.hole = hole
        seat.stack, seat.paid = 0, paid
    table.board = ["2s", "3d", "4c", "8d", "9h"]
    table.settle(True)
    assert [seat.stack for seat in table.seats] == [80, 90, 60, 20]
    assert table.result["pot"] == 250


def test_short_raise_does_not_reopen():
    table = PokerTable()
    table.seats[1].stack = 20
    table.act(3, "raise", 20)
    table.act(0, "call")
    table.act(1, "raise", 25)
    table.act(2, "call")
    assert table.actor == 3
    assert set(table.legal(3)) == {"fold", "call"}


def test_fold_win_keeps_cards_hidden_but_winner_may_show():
    table = PokerTable()
    for i in [3, 0, 1]:
        table.act(i, "fold")
    state = table.view(0)
    assert state["phase"] == "showdown"
    assert state["result"]["payouts"] == [{"seat": 2, "chips": 10}]
    assert state["players"][2]["cards"] == [] and state["result"]["hands"] == []
    assert table.view(2)["choices"] == ["show", "muck"]
    table.reveal(2, True)
    assert table.view(0)["players"][2]["cards"] == table.seats[2].hole
    assert table.view(0)["result"]["hands"][0]["seat"] == 2
    with pytest.raises(ValueError):
        table.reveal(2, False)


def rigged_showdown():
    table = PokerTable()
    holes = [["As", "Ad"], ["Ks", "Kd"], ["7c", "2h"], ["8c", "3h"]]
    for seat, hole in zip(table.seats, holes):
        seat.hole = hole
    table.deck[-12:] = ["4h", "Jc", "9d", "5s", "Tc", "6d", "2s", "Qh", "3c", "4d", "5c", "6c"][::-1]
    passive(table)
    return table


def test_losers_choose_to_show_or_muck():
    table = rigged_showdown()
    assert table.winners == {0} and table.shown == {0}
    assert table.optional == {1, 2, 3}
    table.reveal(1, True)
    table.reveal(2, False)
    view = table.view(0)
    assert view["players"][1]["cards"] == ["Ks", "Kd"]
    assert view["players"][2]["cards"] == [] and view["players"][3]["cards"] == []
    assert view["result"]["mucked"] == [2]
    # Unshown hands never leak their rank.
    assert sorted(h["seat"] for h in view["result"]["hands"]) == [0, 1]
    assert table.view(3)["choices"] == ["show", "muck"] and table.view(0)["choices"] == []


def test_river_all_in_tables_every_live_hand():
    table = PokerTable()
    passive_until = ["preflop", "flop", "turn"]
    while table.phase in passive_until:
        table.act(table.actor, "check" if "check" in table.legal(table.actor) else "call")
    shover = table.actor
    table.act(shover, "raise", table.legal(shover)["raise"]["max"])
    while table.actor is not None:
        table.act(table.actor, "call")
    assert table.phase == "showdown"
    assert table.shown == set(table.live()) and not table.optional


def test_all_in_runout_is_stepped_and_tabled():
    table = PokerTable(stepped=True)
    table.act(3, "raise", 500)
    table.act(0, "call")
    table.act(1, "fold")
    table.act(2, "fold")
    assert table.runout and table.phase == "flop" and len(table.board) == 3
    assert table.shown == {0, 3}
    assert table.view(1)["players"][0]["cards"] == table.seats[0].hole
    table.step_runout()
    assert table.phase == "turn" and table.runout
    table.step_runout()
    assert table.phase == "river" and table.runout
    table.step_runout()
    assert table.phase == "showdown" and not table.runout
    assert sum(seat.stack for seat in table.seats) == 2000
    assert not table.optional and table.shown == {0, 3}
