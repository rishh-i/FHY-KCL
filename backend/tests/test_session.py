import asyncio
import random

import httpx
from fastapi.testclient import TestClient

from app.agents import Decision, LLMPokerAgent, RuleBasedPokerAgent
from app.engine import PokerTable
from app.main import app


def test_play_speak_complete_and_recall(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "false")

    async def passive(self, view):
        return Decision(action="check" if "check" in view["legal"] else "call")

    monkeypatch.setattr(RuleBasedPokerAgent, "decide", passive)
    with TestClient(app) as client:
        state = client.post("/api/games").json()
        path = "/api/games/" + state["id"]
        with client.websocket_connect("/ws/games/" + state["id"]) as socket:
            def until(predicate):
                for _ in range(100):
                    packet = socket.receive_json()
                    state = packet["state"]
                    if predicate(state):
                        return state
                raise AssertionError("Expected state did not arrive")

            state = until(lambda view: view["actor"] == 0)
            assert all(not p["cards"] for p in state["players"][1:])
            turn = state["version"]
            assert client.post(path + "/messages", json={"text": "Marlowe, I have two aces."}).status_code == 200
            state = until(lambda view: any(msg["seat"] == 1 for msg in view["messages"]))
            assert state["version"] == turn and state["actor"] == 0
            assert client.post(path + "/actions", json={"version": turn, "action": "raise", "amount": 500}).status_code == 200
            assert client.post(path + "/actions", json={"version": turn, "action": "call"}).status_code == 409
            state = until(lambda view: view["phase"] == "showdown")
            assert sum(p["stack"] for p in state["players"]) == 2000
            state = client.post(path + "/restart", json={"version": state["version"]}).json()
            assert state["hand"] == 1 and state["messages"] == []

            # The starter can finish an ordinary hand and keep the same session.
            state = until(lambda view: view["actor"] == 0)
            assert client.post(path + "/messages", json={"text": "Marlowe, I have two kings."}).status_code == 200
            until(lambda view: any(msg["seat"] == 1 for msg in view["messages"]))
            while state["phase"] != "showdown":
                choice = "check" if "check" in state["legal"] else "call"
                assert client.post(path + "/actions", json={"version": state["version"], "action": choice}).status_code == 200
                old = state["version"]
                state = until(lambda view: view["version"] > old and (view["actor"] == 0 or view["result"]))
            assert client.post(path + "/next", json={"version": state["version"]}).status_code == 200
            assert client.post(path + "/messages", json={"text": "Marlowe, I have two queens."}).status_code == 200
            state = until(lambda view: any(msg["hand"] == 2 and msg["seat"] == 1 for msg in view["messages"]))
            assert "kings" in state["messages"][-1]["text"] and "hand 1" in state["messages"][-1]["text"]
            assert client.get(path).json()["hand"] == 2


def test_speech_can_change_a_legal_decision_and_memories_are_independent():
    first, second = RuleBasedPokerAgent(1), RuleBasedPokerAgent(2)
    view = {"hand": 1, "pot": 50, "legal": {"call": {"amount": 50}, "fold": {}},
            "players": [{"id": 0, "in_hand": True, "folded": False}]}
    first.trust = .55
    first.rng = random.Random(8)
    assert first.fallback(view, .565).action == "call"
    first.observe("speech", {"hand": 1, "seat": 0, "text": "I have a pair of aces"})
    first.rng = random.Random(8)
    assert first.fallback(view, .565).action == "fold"
    assert not second.claims and second.speech_pressure(view) == 0


def test_provider_errors_and_illegal_model_actions_fall_back(monkeypatch):
    table = PokerTable()
    agent = LLMPokerAgent(table.actor)
    agent.config = {"timeout": 1, "url": "http://unused", "key": "test", "model": "test"}
    view = table.view(table.actor)

    async def fail(*args, **kwargs):
        raise httpx.ConnectError("fake offline provider")

    async def illegal(*args, **kwargs):
        request = httpx.Request("POST", agent.config["url"])
        return httpx.Response(200, request=request, json={
            "choices": [{"message": {"content": '{"action":"raise","amount":1}'}}]
        })

    for response in (fail, illegal):
        monkeypatch.setattr(httpx.AsyncClient, "post", response)
        decision = asyncio.run(agent.decide(view))
        assert decision.action in view["legal"]
        if decision.action == "raise":
            assert view["legal"]["raise"]["min"] <= decision.amount <= view["legal"]["raise"]["max"]
