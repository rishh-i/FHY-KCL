import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from anyio import create_task_group
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect

from .agents import Decision, create_agent
from .engine import PokerTable
from .schemas import Action, GameState, Message, TurnToken

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logger = logging.getLogger(__name__)


class Session:
    def __init__(self):
        self.id = uuid4().hex
        self.lock = asyncio.Lock()
        self.listeners = set()
        self.seq = 0
        self.turn_task = self.reply_task = None
        self.restart()

    def restart(self):
        previous = self.table.version if hasattr(self, "table") else 0
        for task in (self.turn_task, self.reply_task):
            if task:
                task.cancel()
        self.turn_task = self.reply_task = None
        opponents = int(os.getenv("TABLE_OPPONENTS", "3"))
        if not 3 <= opponents <= 5:
            raise ValueError("TABLE_OPPONENTS must be between 3 and 5")
        self.table = PokerTable(opponents)
        self.table.version += previous
        self.restart_version = self.table.version
        self.agents = {i: create_agent(i) for i in range(1, len(self.table.seats))}
        self.messages = []
        self.thinking = None

    def snapshot(self):
        return {**self.table.view(0), "id": self.id, "seq": self.seq,
                "messages": list(self.messages), "thinking": self.thinking}

    def publish(self, event):
        self.seq += 1
        packet = {"event": event, "state": self.snapshot()}
        for listener in self.listeners:
            if listener.full():
                listener.get_nowait()
            listener.put_nowait(packet)

    def say(self, seat, line):
        data = {"id": self.seq + 1, "hand": self.table.hand, "seat": seat, "text": line}
        self.messages = [*self.messages[-23:], data]
        self.observe("speech", data)
        self.publish("AI_SPOKE" if seat else "PLAYER_SPOKE")

    def observe(self, event, data):
        for agent in self.agents.values():
            agent.observe(event, data)

    def play(self, actor, decision):
        previous = self.table.phase
        self.table.act(actor, decision.action, decision.amount)
        self.observe("action", {**self.table.actions[-1], "hand": self.table.hand})
        if self.table.result:
            self.observe("result", self.table.view(None))
        self.publish("ROUND_COMPLETE" if self.table.result else (
            "COMMUNITY_CARDS_REVEALED" if previous != self.table.phase else "PLAYER_ACTION"
        ))

    def schedule(self):
        if self.table.actor in self.agents and (self.turn_task is None or self.turn_task.done()):
            self.turn_task = asyncio.create_task(self.run_turns())

    async def run_turns(self):
        while True:
            async with self.lock:
                actor = self.table.actor
                if actor not in self.agents:
                    return
                agent = self.agents[actor]
                token = self.table.version
                self.thinking = actor
                agent.pending = True
                self.publish("AI_THINKING")
            try:
                await asyncio.sleep(.65)
                async with self.lock:
                    if token != self.table.version:
                        return
                    view = self.table.view(actor)
                try:
                    decision = await agent.decide(view)
                except Exception:
                    logger.exception("AI decision failed")
                    decision = agent.fallback(view, agent.equity(view))
                async with self.lock:
                    if token != self.table.version:
                        return
                    self.thinking = None
                    legal = self.table.legal(actor)
                    try:
                        self.play(actor, decision)
                    except ValueError:
                        self.play(actor, Decision(action="check" if "check" in legal else "call"))
                    line = agent.reaction(self.table.actions[-1]["action"])
                    if line:
                        self.say(actor, line)
                        if self.table.hand > 1 and agent.rng.random() < .24:
                            other = next((i for i in self.table.live() if i in self.agents and i != actor), None)
                            if other is not None:
                                line = self.agents[other].fresh(["That sounded rehearsed.", "I'll judge by the chips.", "You sound certain."])
                                if line:
                                    self.say(other, line)
            finally:
                agent.pending = False

    async def respond(self, agent, view, message, table):
        try:
            line = await agent.reply(view, message)
        except Exception:
            logger.exception("AI conversation failed")
            return
        async with self.lock:
            if table is self.table and view["hand"] == table.hand and line.strip():
                self.say(agent.seat, line.strip())


sessions: dict[str, Session] = {}


@asynccontextmanager
async def lifespan(_app):
    yield
    tasks = [task for session in sessions.values()
             for task in (session.turn_task, session.reply_task) if task and not task.done()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    sessions.clear()


app = FastAPI(title="The Last Table", lifespan=lifespan)


def lookup(game_id):
    session = sessions.get(game_id)
    if session is None:
        raise HTTPException(404, "Table session expired")
    return session


def require_version(session, token):
    if token != session.table.version:
        raise HTTPException(409, "The table has moved on")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/games", status_code=201, response_model=GameState)
async def new_game():
    session = Session()
    sessions[session.id] = session
    session.schedule()
    return session.snapshot()


@app.get("/api/games/{game_id}", response_model=GameState)
async def get_game(game_id: str):
    return lookup(game_id).snapshot()


@app.post("/api/games/{game_id}/actions", response_model=GameState)
async def act(game_id: str, action: Action):
    session = lookup(game_id)
    async with session.lock:
        require_version(session, action.version)
        try:
            session.play(0, action)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        session.schedule()
        return session.snapshot()


@app.post("/api/games/{game_id}/next", response_model=GameState)
async def next_hand(game_id: str, token: TurnToken):
    session = lookup(game_id)
    async with session.lock:
        require_version(session, token.version)
        try:
            session.table.start_hand()
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        if session.table.result:
            session.observe("result", session.table.view(None))
        session.publish("CARDS_DEALT")
        session.schedule()
        return session.snapshot()


@app.post("/api/games/{game_id}/restart", response_model=GameState)
async def restart(game_id: str, token: TurnToken):
    session = lookup(game_id)
    async with session.lock:
        # Restart is independent of turn progression but cannot be replayed across restarts.
        if token.version < session.restart_version:
            raise HTTPException(409, "The table has already restarted")
        session.restart()
        session.publish("GAME_STARTED")
        session.schedule()
        return session.snapshot()


@app.post("/api/games/{game_id}/messages", response_model=GameState)
async def message(game_id: str, message: Message):
    session = lookup(game_id)
    text = message.text.strip()
    if not text:
        raise HTTPException(422, "Enter a message first")
    async with session.lock:
        if session.reply_task and not session.reply_task.done():
            raise HTTPException(429, "An opponent is already answering")
        session.say(0, text)
        participants = [i for i in session.table.live() if i in session.agents] or list(session.agents)
        speaker = next((i for i in participants if session.table.seats[i].name.lower() in text.lower()), None)
        if speaker is None:
            speaker = participants[(session.table.hand - 1) % len(participants)]
        agent = session.agents[speaker]
        session.reply_task = asyncio.create_task(session.respond(agent, session.table.view(speaker), text, session.table))
        return session.snapshot()


@app.websocket("/ws/games/{game_id}")
async def stream(socket: WebSocket, game_id: str):
    session = sessions.get(game_id)
    await socket.accept()
    if session is None:
        await socket.close(code=4404)
        return
    listener = asyncio.Queue(maxsize=16)
    session.listeners.add(listener)
    listener.put_nowait({"event": "SNAPSHOT", "state": session.snapshot()})

    try:
        async with create_task_group() as tasks:
            async def send():
                try:
                    while True:
                        await socket.send_json(await listener.get())
                except (WebSocketDisconnect, OSError):
                    tasks.cancel_scope.cancel()

            tasks.start_soon(send)
            try:
                while True:
                    await socket.receive_text()
            except WebSocketDisconnect:
                tasks.cancel_scope.cancel()
    finally:
        session.listeners.discard(listener)
