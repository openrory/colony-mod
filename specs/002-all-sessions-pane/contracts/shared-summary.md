# Contract: shared summary (this feature)

One JSON file per session in the user's shared folder (option `sharedFolder`), named `<sessionId>.json`. Written by that session's mod only; read by every session's pane. Plain data; contains no conversation content (FR-003).

```json
{
  "version": 1,
  "sessionId": "6839952c-cc28-41e7-977e-4156f8d7ad56",
  "name": "colony-mod",
  "folder": "/Users/you/projects/colony-mod",
  "updatedAt": 1791536256952,
  "ended": false,
  "agents": [
    { "id": "main", "label": "main", "parentId": null, "state": "in-progress",
      "listenSource": null, "model": "claude-sonnet-5-5", "tokens": { "in": 1200, "out": 500 } },
    { "id": "a1b2", "label": "US2 layout", "parentId": "main", "state": "pending",
      "listenSource": null, "model": "claude-haiku-5-5", "tokens": null }
  ],
  "exchanges": [ { "from": "main", "to": "a1b2" } ]
}
```

## Rules
- **Allow-list only**: exactly the fields above. Anything else is dropped by the writer. Labels are truncated to 40 characters; no prompts, messages, tool inputs or outputs, or file contents. The only path shared is `folder`.
- **Limits**: at most 100 agents; the writer drops the oldest completed agents first.
- **Writer cadence**: on change at most once per second, plus a heartbeat every 5 s while any agent is active (R4). On a clean end or when sharing is switched off: one final write containing only `{ "version": 1, "sessionId": ..., "updatedAt": ..., "ended": true, "agents": [] }`, with no name and no folder.
- **Reader rules**: ignore invalid JSON, a `version` other than 1, or failed validation (FR-008); treat `ended: true` as removed; stale at 10 s and removed at 60 s since the newer of `updatedAt` and the file's modification time; skip the reader's own `sessionId`.
- **Compatibility**: unknown extra fields are ignored. A change older readers cannot interpret bumps `version`.
- **Trust**: files are user-writable data; the reader never executes anything from them and caps label length when drawing.
