# The Last Table

A single-player 3D Texas Hold'em trainer. You sit at a table with three to five AI opponents (Marlowe, Vega, Kit, Noor and Jules), play with the normal poker controls, and talk to the table through the microphone or the chat field. Each opponent keeps its own memory, reads on every other player and a playing style that drifts with the game. After each hand you can open the thought logs and see why each one acted, including when table talk changed a decision. The game uses fictional chips only.

## Run locally

Use Python 3.11 or later and Node.js 22 or later. From the project root, set up and start the backend:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt      # Windows: .venv\Scripts\python
cp backend/.env.example backend/.env
cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal, from the project root:

```sh
cd frontend
npm ci
npm run dev
```

Open [the local game](http://localhost:5173). Vite proxies HTTP and WebSocket traffic to FastAPI.

### IntelliJ IDEA

Open the project root. Create a Python run configuration for module `uvicorn` with parameters `app.main:app --reload --host 127.0.0.1 --port 8000`, working directory `backend` and the project's `.venv` interpreter. Create an npm configuration for `frontend/package.json` with script `dev`. Launch both.

## Playing

**Lobby.** Choose the stakes (1/2 up to 100/200), the starting stack (30, 100 or 200 big blinds), the number of opponents, how chatty the table is, the AI pacing and when thought logs unlock. Nothing carries over between tables: there is no global bankroll. The **game tracker** below the setup lists every table you have played on this device with hands played, result in chips and big blinds, finishing place and biggest pot. You can resume a table that is still open on the server.

**At the table:**

- **Actions.** Fold, check, call or raise, with a slider and ½-pot, pot and all-in presets. Only legal actions are shown.
- **Pacing.** Opponents take time to think: longer on close decisions, with pauses when new cards are dealt and while all-in boards run out street by street. Switch between Brisk, Natural and Deliberate at any time from the top bar.
- **Talk.** Anything you say is heard by the whole table. A message that names nobody, or addresses everyone ("who's bluffing?"), gets answers from two or three players. Naming someone ("Vega, you're bluffing") makes sure they answer, and others may join in. Opponents also talk among themselves. They needle each other, drop true or false hints about their own hands, and warn each other off. Other opponents treat those lines as untrusted claims, just like yours.
- **Showdown.** Winning hands are tabled. If any player is all in when the betting ends, every live hand is tabled. Otherwise losing players choose to show or muck, and an uncontested winner may show voluntarily. You get **Show** and **Muck** buttons when the choice is yours. **Next hand** mucks for you if you haven't chosen.
- **Thought logs** (brain icon). Each decision lists the opponent's cards, equity, pot odds, current style and why it has drifted (tilt, table dynamics, bluffs that worked or got caught), its reads on other players, and every piece of table talk it weighed. When talk flips an action, the entry is tagged *Talk changed this* and states what it would have done without it. Logs for the current hand stay locked until the hand ends, unless you chose **Live** thoughts in the lobby (study mode, which reveals AI cards as they act).
- **Tracker** (chart icon). A per-table leaderboard with stack, net in big blinds, VPIP, PFR, pots won and showdowns won, plus a hand history.
- **First-person view.** Your arms push chips in for calls and raises, tap the table to check, slide your cards away to fold, and lift them to show. Opponents lean in, push chips, rest a hand on their chin while thinking and turn toward whoever they are talking to. Drag the scene to look around; the camera button resets the view.

### How the opponents decide

Each opponent starts from a hidden tendency (how tight, aggressive, bluff-prone, talkative and suggestible it is), randomised slightly every game. That tendency is never shown during a hand and moves with tilt, losses, whether its bluffs succeed, and how loose or aggressive the table has been. On every decision it:

1. Estimates equity by sampling unknown cards, then discounts it for raises it is facing.
2. Adjusts for its read on the aggressor (how often they play and whether they have been caught bluffing).
3. Weighs table talk from live players by how much it trusts that speaker. Trust rises or falls when a claim is checked against cards shown at showdown, and it remembers those events and can quote them back later.
4. Compares the result with pot odds and its style to fold, call, value-raise, trap, bluff or semi-bluff, and validates the action against the engine.

## Optional language model

By default every opponent is local and works offline. To let an external model choose actions and write replies, edit `backend/.env` and restart FastAPI.

| Variable | Value |
| --- | --- |
| `AI_ENABLED` | `true` |
| `AI_PROVIDER` | `openai` or `openai-compatible` |
| `AI_MODEL` | A model that supports Chat Completions JSON mode |
| `AI_API_KEY` | A key for the configured provider |
| `AI_BASE_URL` | API base URL ending in the provider's version prefix (required for `openai-compatible`) |
| `AI_TIMEOUT` | Per-request timeout in seconds, default `4` |

The model receives the acting opponent's own analysis, reads and talk effects, and returns an action with a short explanation that is added to the thought log. An invalid, unavailable or slow model falls back to the local decision. Conversational requests contain public information only.

## Voice

Use desktop Chrome or Edge on localhost. Hold the microphone button while talking, then release it; the keyboard equivalent is to focus the mic and hold Space or Enter. If recognition is unavailable or permission is denied, use the typed field. Opponent voices are off initially and can be turned on with the speaker button. [SpeechRecognition browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition#browser_compatibility)

## Rules and limits

- No-limit Hold'em with configurable blinds and stacks. A raise amount is the total street bet. Short all-in raises, side pots, split pots and uncalled refunds are handled by the server, which is the sole authority on cards, turns and chips. [Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/)
- Speech never changes game state. It is parsed only for claims, accusations, questions and taunts, and treated as untrusted.
- Sessions live in server memory. A refresh reconnects to the same table, while a server restart closes it; the lobby tracker keeps your results. Run one backend process.

## Verification

From the project root:

```sh
(cd backend && ../.venv/bin/python -m pytest -q)
(cd frontend && npm run build)
```

The tests cover dealing, configurable stakes, legal actions, betting order and streets, ties, side pots and refunds, show/muck rules, tabling hands on all-ins, stepped run-outs, private-card isolation, stale turns, WebSocket updates, thought logs staying locked until the hand ends, talk changing a decision (with the counterfactual recorded), claims being checked against shown cards, recall across hands, prompt-injection-style messages, and model fallback.
