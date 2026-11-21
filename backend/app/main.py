import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from random import Random
from uuid import uuid4

from anyio import create_task_group
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect

from .agents import Decision, create_agent
from .engine import PokerTable
from .schemas import Action, GameState, Message, Settings, SettingsPatch, ShowChoice, TurnToken
from .talk import parse

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logger = logging.getLogger(__name__)

# Seconds. "think" is the base range per decision; close decisions add up to "tank".
PACE = {
    "fast": {"think": (.7, 1.2), "tank": .8, "street": .8, "runout": 1.1, "reply": (.5, 1.0)},
    "normal": {"think": (1.4, 2.4), "tank": 1.8, "street": 1.3, "runout": 1.7, "reply": (.9, 1.8)},
    "slow": {"think": (2.5, 3.8), "tank": 2.8, "street": 1.9, "runout": 2.3, "reply": (1.3, 2.4)},
}
CHATTER = {"quiet": .45, "normal": 1.0, "chatty": 1.6}
MAX_LOGS = 500


class Session:
    def __init__(self, settings: Settings | None = None):
        self.id = uuid4().hex
        self.lock = asyncio.Lock()
        self.listeners = set()
        self.seq = 0
        self.turn_task = self.runout_task = self.convo_task = None
        self.reactions: set[asyncio.Task] = set()
        self.rng = Random()
        self.settings = settings or Settings()
        self.restart()

    # --- lifecycle -----------------------------------------------------------
    def tasks(self):
        return [t for t in (self.turn_task, self.runout_task, self.convo_task, *self.reactions) if t]

    def restart(self, settings: Settings | None = None):
        previous = self.table.version if hasattr(self, "table") else 0
        for task in self.tasks():
            task.cancel()
        self.turn_task = self.runout_task = self.convo_task = None
        self.reactions = set()
        if settings:
            self.settings = settings
        s = self.settings
        self.table = PokerTable(s.opponents, s.small_blind, s.big_blind, s.stack, stepped=True)
        self.table.version += previous
        self.restart_version = self.table.version
        self.agents = {i: create_agent(i, self.table.seats[i].name, s.big_blind)
                       for i in range(1, len(self.table.seats))}
        for agent in self.agents.values():
            agent.emit = self.record
            agent.chatter = CHATTER[s.chatter]
        self.messages, self.logs, self.history = [], [], []
        self.log_seq = 0
        self.thinking = None
        self.pause = .6
        self.stats = {i: dict(hands=0, vpip=0, pfr=0, won=0, showdowns=0, showdowns_won=0, biggest_pot=0)
                      for i in range(len(self.table.seats))}
        self.finished = 0
        self.begin_hand()

    def begin_hand(self):
        t = self.table
        dealt = [i for i, seat in enumerate(t.seats) if seat.hole]
        for i in dealt:
            self.stats[i]["hands"] += 1
        self.flags = {i: {"vpip": False, "pfr": False} for i in dealt}
        self.announced = set()
        self.observe("hand_start", {"hand": t.hand, "dealt": dealt,
                                    "names": {i: seat.name for i, seat in enumerate(t.seats)}})

    @property
    def pace(self):
        return PACE[self.settings.pace]

    # --- journal ---------------------------------------------------------------
    def record(self, entry):
        self.log_seq += 1
        self.logs.append({"id": self.log_seq, "talk_changed": False, "phase": None, **entry})
        del self.logs[:-MAX_LOGS]

    def visible_logs(self):
        """Thoughts about the current hand stay hidden until it ends, unless live thoughts are on."""
        t = self.table
        open_hand = t.result is None and not self.settings.live_thoughts
        visible = [e for e in self.logs if not (open_hand and e["hand"] >= t.hand)]
        return visible[-80:], len(self.logs) - len([e for e in self.logs if not (open_hand and e["hand"] >= t.hand)])

    # --- state -------------------------------------------------------------------
    def leaderboard(self):
        return [{"seat": i, "name": seat.name, "stack": seat.stack, "net": seat.stack - self.settings.stack,
                 **self.stats[i]} for i, seat in enumerate(self.table.seats)]

    def snapshot(self):
        logs, locked = self.visible_logs()
        return {**self.table.view(0), "id": self.id, "seq": self.seq,
                "messages": [{k: m[k] for k in ("id", "hand", "seat", "to", "text")} for m in self.messages],
                "thinking": self.thinking, "settings": self.settings.model_dump(), "stats": self.leaderboard(),
                "history": self.history[-40:], "logs": logs, "locked_logs": locked}

    def publish(self, event):
        self.seq += 1
        packet = {"event": event, "state": self.snapshot()}
        for listener in self.listeners:
            if listener.full():
                listener.get_nowait()
            listener.put_nowait(packet)

    def observe(self, event, data):
        for agent in self.agents.values():
            agent.observe(event, data)

    def names(self):
        # Seat 0 is "You", which would match every "you"; it is never addressed by name.
        return {i: seat.name for i, seat in enumerate(self.table.seats) if i}

    def say(self, seat, text, to=None, intent=None, info=None):
        info = info or parse(text, self.names())
        if to is None and len(info["addressed"]) == 1 and info["addressed"][0] != seat:
            to = info["addressed"][0]
        data = {"id": self.seq + 1, "hand": self.table.hand, "seat": seat, "to": to, "text": text,
                "intent": intent, "info": info}
        self.messages = [*self.messages[-39:], data]
        self.observe("speech", data)
        self.publish("AI_SPOKE" if seat else "PLAYER_SPOKE")
        return data

    # --- game flow -------------------------------------------------------------
    def play(self, actor, decision):
        previous = self.table.phase
        self.table.act(actor, decision.action, decision.amount)
        action = self.table.actions[-1]
        flags = self.flags.setdefault(actor, {"vpip": False, "pfr": False})
        if action["phase"] == "preflop" and action["action"] in ("call", "raise") and not flags["vpip"]:
            flags["vpip"] = True
            self.stats[actor]["vpip"] += 1
        if action["phase"] == "preflop" and action["action"] == "raise" and not flags["pfr"]:
            flags["pfr"] = True
            self.stats[actor]["pfr"] += 1
        self.observe("action", action)
        self.after_change(previous)

    def after_change(self, previous):
        t = self.table
        if t.result and self.finished != t.hand:
            self.finish_hand()
        self.publish("ROUND_COMPLETE" if t.result else
                     "COMMUNITY_CARDS_REVEALED" if previous != t.phase else "PLAYER_ACTION")
        if t.runout:
            self.start_runout()

    def announce(self, seat):
        t = self.table
        if seat in self.announced:
            return
        self.announced.add(seat)
        self.observe("reveal", {"hand": t.hand, "seat": seat, "cards": list(t.seats[seat].hole),
                                "board": list(t.board), "actions": list(t.actions)})
        if self.history and self.history[-1]["hand"] == t.hand:
            self.history[-1]["hands"] = t.shown_hands()

    def finish_hand(self):
        t = self.table
        self.finished = t.hand
        deltas = [seat.stack - start for seat, start in zip(t.seats, t.start_stacks)]
        for i in sorted(t.optional):
            if i in self.agents:
                show, why = self.agents[i].show_or_muck(t.view(i), won=i in t.winners)
                t.reveal(i, show)
                self.record({"seat": i, "hand": t.hand, "kind": "showdown",
                             "title": "Showed cards" if show else "Mucked", "details": [why]})
        showdown = t.result["showdown"]
        live = t.live()
        for i in live:
            if showdown:
                self.stats[i]["showdowns"] += 1
                self.stats[i]["showdowns_won"] += i in t.winners
        for award in t.result["payouts"]:
            self.stats[award["seat"]]["won"] += 1
            self.stats[award["seat"]]["biggest_pot"] = max(self.stats[award["seat"]]["biggest_pot"], t.result["pot"])
        self.history.append({"hand": t.hand, "board": list(t.board), "pot": t.result["pot"], "showdown": showdown,
                             "winners": t.result["payouts"], "deltas": deltas, "hands": t.shown_hands(),
                             "your_cards": list(t.seats[0].hole)})
        for i in sorted(t.shown):
            self.announce(i)
        self.observe("result", {"hand": t.hand, "deltas": dict(enumerate(deltas)), "pot": t.result["pot"],
                                "winners": sorted(t.winners)})

    def schedule(self):
        t = self.table
        if t.runout:
            self.start_runout()
        elif t.actor in self.agents and (self.turn_task is None or self.turn_task.done()):
            self.turn_task = asyncio.create_task(self.run_turns())

    def start_runout(self):
        if self.runout_task is None or self.runout_task.done():
            self.runout_task = asyncio.create_task(self.run_runout())

    async def run_runout(self):
        while True:
            await asyncio.sleep(self.pace["runout"])
            async with self.lock:
                t = self.table
                if not t.runout:
                    return
                previous = t.phase
                t.step_runout()
                self.after_change(previous)
                if not t.runout:
                    return

    async def run_turns(self):
        loop = asyncio.get_running_loop()
        while True:
            pause, self.pause = self.pause, 0
            if pause:
                await asyncio.sleep(pause)
            async with self.lock:
                table = self.table
                actor = table.actor
                if actor not in self.agents or table.runout:
                    return
                agent = self.agents[actor]
                token = table.version
                self.thinking = actor
                agent.pending = True
                view = table.view(actor)
                self.publish("AI_THINKING")
            street_changed = False
            try:
                started = loop.time()
                agent.last = None  # never talk about a previous decision's context
                try:
                    decision, difficulty = await agent.decide(view)
                except Exception:
                    logger.exception("AI decision failed")
                    decision, difficulty = Decision(action="check" if "check" in view["legal"] else "fold"), 0
                low, high = self.pace["think"]
                wait = self.rng.uniform(low, high) + self.pace["tank"] * difficulty
                await asyncio.sleep(max(0., wait - (loop.time() - started)))
                async with self.lock:
                    if table is not self.table or token != table.version:
                        return
                    self.thinking = None
                    previous = table.phase
                    try:
                        self.play(actor, decision)
                    except ValueError:
                        legal = table.legal(actor)
                        decision = Decision(action="check" if "check" in legal else "fold")
                        self.play(actor, decision)
                    self.chatter_after(agent, decision)
                    street_changed = previous != table.phase
                    if table.runout or table.result:
                        return
            finally:
                agent.pending = False
                if self.thinking == actor:
                    self.thinking = None
            if street_changed:
                self.pause = self.pace["street"]

    def chatter_after(self, agent, decision):
        last = getattr(agent, "last", None)
        if not last:
            return
        c, kind = last
        try:
            said = agent.after_action(self.table.view(agent.seat), decision, kind, c)
        except Exception:
            logger.exception("AI table talk failed")
            return
        if not said:
            return
        self.say(agent.seat, said["text"], to=said["to"], intent=said["intent"])
        honesty = {True: "honest", False: "deceptive", None: "pressure"}[said["honest"]]
        agent.note("talk", f"Said: “{said['text']}”", [f"Intent: {said['intent'].replace('_', ' ')} ({honesty}).",
                                                      said["why"]])
        if said["to"] in self.agents and (self.convo_task is None or self.convo_task.done()):
            info = parse(said["text"], self.names())
            task = asyncio.create_task(self.converse(agent.seat, said["text"], info, [said["to"]], self.table, 1))
            self.reactions.add(task)
            task.add_done_callback(self.reactions.discard)

    # --- conversation ----------------------------------------------------------
    def responders(self, info, speaker):
        live = set(self.table.live())
        chosen = [s for s in info["addressed"] if s in self.agents and s != speaker]
        if info["everyone"] or not chosen:
            others = [s for s in self.agents if s not in chosen and s != speaker]
            self.rng.shuffle(others)
            extra = [s for s in others if self.rng.random() < self.agents[s].wants_reply(info, False, s in live)]
            # Talk aimed at the whole table always draws more than one voice.
            wanted = (2 if not chosen else 0) - len(extra)
            rest = sorted((s for s in others if s not in extra),
                          key=lambda s: -(self.agents[s].base["talk"] + self.rng.random() * .4))
            chosen += extra + rest[:max(0, wanted)]
        return chosen[:3]

    async def converse(self, speaker, text, info, responders, table, budget=4):
        for seat in responders:
            if budget <= 0:
                return
            await asyncio.sleep(self.rng.uniform(*self.pace["reply"]))
            agent = self.agents.get(seat)
            if table is not self.table or agent is None:
                return
            try:
                line, intent = await agent.reply(table.view(seat), text, info, speaker)
            except Exception:
                logger.exception("AI conversation failed")
                continue
            async with self.lock:
                if table is not self.table:
                    return
                said = self.say(seat, line.strip()[:180], to=speaker, intent=intent)
                if intent in ("memory", "believe_strong", "doubt_strong", "believe_weak", "doubt_weak"):
                    agent.note("talk", f"Answered {agent.ref(speaker)}", [f"“{line}”",
                               f"Response type: {intent.replace('_', ' ')}."])
            budget -= 1
            # Other opponents sometimes jump in on what this one just said.
            if budget > 0 and self.rng.random() < .3 * CHATTER[self.settings.chatter]:
                others = [s for s in self.agents if s not in (seat, speaker)]
                if not others:
                    continue
                other = self.rng.choice(others)
                await asyncio.sleep(self.rng.uniform(*self.pace["reply"]))
                if table is not self.table:
                    return
                try:
                    line, intent = self.agents[other].react(seat, said["text"], said["info"])
                except Exception:
                    logger.exception("AI reaction failed")
                    continue
                async with self.lock:
                    if table is not self.table:
                        return
                    # Agree/disagree lines talk about the other player, so they go to the table.
                    self.say(other, line, to=None if intent == "react" else seat, intent=intent)
                budget -= 1


sessions: dict[str, Session] = {}


@asynccontextmanager
async def lifespan(_app):
    yield
    tasks = [task for session in sessions.values() for task in session.tasks() if not task.done()]
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
async def new_game(settings: Settings | None = None):
    session = Session(settings)
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
        previous = session.table.phase
        try:
            session.play(0, Decision(action=action.action, amount=action.amount))
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        session.pause = session.pace["street"] if previous != session.table.phase else .35
        session.schedule()
        return session.snapshot()


@app.post("/api/games/{game_id}/showdown", response_model=GameState)
async def showdown(game_id: str, choice: ShowChoice):
    session = lookup(game_id)
    async with session.lock:
        require_version(session, choice.version)
        try:
            session.table.reveal(0, choice.choice == "show")
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        if choice.choice == "show":
            session.announce(0)
        session.publish("SHOWDOWN")
        return session.snapshot()


@app.post("/api/games/{game_id}/next", response_model=GameState)
async def next_hand(game_id: str, token: TurnToken):
    session = lookup(game_id)
    async with session.lock:
        require_version(session, token.version)
        table = session.table
        if table.phase == "showdown" and 0 in table.optional:
            table.reveal(0, False)
        try:
            table.start_hand()
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        session.begin_hand()
        session.pause = session.pace["street"]
        session.publish("CARDS_DEALT")
        session.schedule()
        return session.snapshot()


@app.post("/api/games/{game_id}/restart", response_model=GameState)
async def restart(game_id: str, token: TurnToken):
    session = lookup(game_id)
    async with session.lock:
        if token.version < session.restart_version:
            raise HTTPException(409, "The table has already restarted")
        session.restart()
        session.publish("GAME_STARTED")
        session.schedule()
        return session.snapshot()


@app.post("/api/games/{game_id}/settings", response_model=GameState)
async def update_settings(game_id: str, patch: SettingsPatch):
    session = lookup(game_id)
    async with session.lock:
        session.settings = session.settings.model_copy(update=patch.model_dump(exclude_none=True))
        for agent in session.agents.values():
            agent.chatter = CHATTER[session.settings.chatter]
        session.publish("SETTINGS_CHANGED")
        return session.snapshot()


@app.post("/api/games/{game_id}/messages", response_model=GameState)
async def message(game_id: str, message: Message):
    session = lookup(game_id)
    text = message.text.strip()
    if not text:
        raise HTTPException(422, "Enter a message first")
    async with session.lock:
        info = parse(text, session.names())
        session.say(0, text, info=info)
        responders = session.responders(info, 0)
        if session.convo_task and not session.convo_task.done():
            session.convo_task.cancel()  # a new remark supersedes the conversation in progress
        session.convo_task = asyncio.create_task(session.converse(0, text, info, responders, session.table))
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
                except (WebSocketDisconnect, OSError, RuntimeError):
                    tasks.cancel_scope.cancel()

            tasks.start_soon(send)
            try:
                while True:
                    await socket.receive_text()
            except WebSocketDisconnect:
                tasks.cancel_scope.cancel()
    finally:
        session.listeners.discard(listener)
