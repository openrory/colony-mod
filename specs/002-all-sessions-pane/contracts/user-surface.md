# Contract: user-facing surface (all sessions)

| Surface | Behaviour |
|---|---|
| `userConfig` option `sharedFolder` (string, default empty) | empty: sharing off, nothing written or read (FR-002). Absolute folder path: this session writes its summary there and its pane shows all sessions found there (US4). Turning it off writes one `ended` summary and stops. The README states exactly what is shared (FR-008, contracts/shared-summary.md) |
| README | has a section stating exactly what is shared, where, and how to turn sharing off and clean up old files (FR-008) |
