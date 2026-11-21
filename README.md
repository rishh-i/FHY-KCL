# The Last Table

Sit down at a 3D Texas Hold'em table with Marlowe, Vega, and Kit. Make your moves with the poker controls and use the microphone or chat field to bluff, ask questions, or call someone out. Each opponent keeps its own model of what happened at the table. The game uses fictional chips.

## Run locally

Use Python 3.11 or later and Node.js 22 or later. From the project root, set up and start the backend:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
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

Open [the local game](http://localhost:5173). Vite proxies HTTP and WebSocket traffic to FastAPI. If port 5173 is occupied, open the URL Vite prints.

### IntelliJ IDEA

Open the project root. You can run the commands above in two built-in terminal tabs. With Python and Node.js run configurations available, select the project's `.venv` interpreter and create a Python configuration for module `uvicorn`, parameters `app.main:app --reload --host 127.0.0.1 --port 8000`, and working directory `backend`. Create an npm configuration for `frontend/package.json` using script `dev`. Launch both configurations.

## Optional language model

The default configuration uses local opponents. To enable an external model, edit `backend/.env` and restart FastAPI.

| Variable | Value |
| --- | --- |
| `AI_ENABLED` | `true` |
| `AI_PROVIDER` | `openai` or `openai-compatible` |
| `AI_MODEL` | A model that supports Chat Completions JSON mode |
| `AI_API_KEY` | A key for the configured provider |
| `AI_BASE_URL` | API base URL ending in the provider's version prefix, required for `openai-compatible` |
| `AI_TIMEOUT` | Per-request timeout in seconds, default `4` |
| `TABLE_OPPONENTS` | Number of opponents, default `3`, range `3–5` |

An invalid, unavailable, or slow model falls back to a legal local decision. The backend sends public table talk to the configured provider and includes the acting opponent's private cards in its decision request only. Model-generated conversational replies receive public information. Occasional action banter is generated locally from the action, with card claims chosen independently of the opponent's hand.

## Voice and demo

Use desktop Chrome on localhost for the demo. Hold the microphone button while talking, then release it. The keyboard equivalent is to focus the mic and hold Space or Enter. Browser support and permission settings vary. Try the typed field if recognition fails, permissions are denied, or you are using another browser. The browser or operating system may use its own remote speech service. The FastAPI server receives the transcript as text and keeps recent messages in RAM. Opponent audio is off initially and can be enabled using the speaker button. [SpeechRecognition browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition#browser_compatibility)

1. Join the table and use the available Check, Call, Raise, or Fold controls.
2. Say “Marlowe, I have two aces,” and wait for the reply. The words enter the agents' observations and may shift their estimate of how strong your hand is.
3. Complete the hand and choose **Next hand**.
4. Try “Marlowe, I have two kings.” The local opponents share what was said publicly, so the responder can recall the aces claim even if Marlowe folded.
5. Drag the scene to look around or use the camera button to return to the default view.

## Rules and limits

- No-limit Hold'em uses 5/10 blinds and 500 starting chips. The dealer moves among funded seats. A raise amount is the total street bet. Short all-in raises, side pots, split pots, and uncalled refunds are handled by the server. [Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/)
- Only live hands are exposed at a contested showdown. Each opponent's decision context includes its own cards, observed table actions, conversation, and independent memories.
- The local opponents estimate equity by sampling unknown cards. Offline speech analysis recognizes English rank claims such as “two aces,” “pocket kings,” and “pair of queens.” Other remarks can draw a response without necessarily shifting a betting decision.
- Sessions and transcripts live in server memory. A refresh in the same tab reconnects, while a server restart clears sessions. Run one backend process for this local demo.

## Verification

From the project root:

```sh
(cd backend && ../.venv/bin/python -m pytest -q)
(cd frontend && npm run build)
```

The tests cover dealing, legal actions, betting order and streets, ties, side pots and refunds, private-card isolation, stale turns, WebSocket updates, recall across hands, the effect of speech on a decision, and model fallback.
