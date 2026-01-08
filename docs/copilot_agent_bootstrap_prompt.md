## 1. Copilot Agent Bootstrap Prompt

```
You are building a local-network, multiplayer web version of the dice game Farkle.

This repository contains multiple design documents that are AUTHORITATIVE. You must follow them exactly and must not invent rules, state, or events that contradict them.

Primary goals:
- Server-authoritative game logic
- One TV client (display-only after start)
- Multiple phone clients (one per player)
- Single game at a time, in-memory only

You must:
- Implement the server state exactly as specified
- Enforce all legality rules on the server
- Treat clients as views/controllers only
- Use SSE + REST API for real-time updates
- Broadcast full GameState snapshots after every meaningful state change

Before implementing any logic, read and internalize these documents:

1. docs/design.md
2. docs/server-state-schema.md
3. docs/sse-rest-api-schema.md
4. docs/dice-scoring-rules.md
5. docs/turn-lifecycle-walkthrough.md

If any ambiguity appears during implementation, you must resolve it by referring back to these documents, not by inventing behavior.

Implementation priorities:
1. Server state model and invariants
2. Dice scoring engine with tests
3. SSE + REST API handlers
4. TV client rendering
5. Phone client UI and actions

Do not add persistence, authentication, spectators, or multiple games.
```

---

## 2. Recommended Repository Structure

```text
farkle/
├─ server/
│  ├─ index.js              # Server entry point
│  ├─ gameEngine.js         # Pure game logic & state transitions
│  ├─ scoring.js            # Dice scoring implementation
│  ├─ state.js              # ServerState initialization & helpers
│  ├─ sseHandlers.js        # SSE + REST API handlers
│  └─ eventLog.js           # Optional in-memory debug log
│
├─ public/
│  ├─ tv/
│  │  ├─ index.html
│  │  ├─ tv.js
│  │  └─ tv.css
│  │
│  ├─ phone/
│  │  ├─ index.html
│  │  ├─ phone.js
│  │  └─ phone.css
│  │
│  └─ shared.css            # Shared styling variables
│
├─ docs/
│  ├─ design.md
│  ├─ server-state-schema.md
│  ├─ sse-rest-api-schema.md
│  ├─ dice-scoring-rules.md
│  └─ turn-lifecycle-walkthrough.md
│
├─ package.json
└─ README.md
```

---

## 3. Mapping Canvas Documents → Repo Files

The following table shows how each Canvas document should be saved into the repository. These filenames should be treated as canonical references by Copilot Agent.

| Canvas Document Title | Recommended Path |
|----------------------|------------------|
| Multiplayer Farkle – Initial Design Specification | `docs/design.md` |
| Farkle Server State Schema | `docs/server-state-schema.md` |
| Farkle SSE + REST API Schema | `docs/sse-rest-api-schema.md` |
| Farkle Dice Scoring Rules | `docs/dice-scoring-rules.md` |
| Farkle Turn Lifecycle Walkthrough | `docs/turn-lifecycle-walkthrough.md` |

---

## 4. Implementation Guidance for Copilot

- `gameEngine.js` should contain pure functions operating on GameState
- `scoring.js` must implement rules exactly as described in `dice-scoring-rules.md`
- `sseHandlers.js` must enforce phase, player identity, and turn ownership
- Clients must render exclusively from `game_state` events
- No client may infer state transitions locally

---

## 5. Non-Negotiables

- Do NOT persist state to disk
- Do NOT add features not explicitly described
- Do NOT change rules for convenience
- Do NOT optimize prematurely

Correctness and fidelity to the specification are more important than brevity.

---

## 6. Success Criteria

The implementation is considered correct when:

- A full game can be played end-to-end without desynchronization
- Phone refreshes do not break turns
- TV reloads rehydrate state correctly
- All dice scoring matches classic Farkle rules
- Illegal actions are rejected and logged
