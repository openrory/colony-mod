# Contract: user-facing surface (all sessions)

| Surface | Behaviour |
|---|---|
| `userConfig` option `shareSessions` (boolean, default false, "Share with my other sessions") | off: sharing off, nothing written or read (FR-002). On: this session writes its summary to the shared folder and its pane shows all sessions found there (US4). Turning it off writes one `ended` summary and stops |
| `userConfig` option `sharedFolder` (string, default empty, optional) | empty: the folder is `<config dir>/colony` (config dir = `CLAUDE_CONFIG_DIR`, else `<home>/.claude`), used only when sharing is on. Absolute folder path: that folder is used instead. A non-empty value also turns sharing on (0.2.0 compatibility). The folder is resolved once at session start (`sharedFolderFor` in `src/runtime.ts`) |
| README | states exactly what is shared (FR-008, contracts/shared-summary.md) |
| README | has a section stating exactly what is shared, where, and how to turn sharing off and clean up old files (FR-008) |
