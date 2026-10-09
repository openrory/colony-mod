# Contract: user-facing surface

| Surface | Behaviour |
|---|---|
| `/colony` command | toggles the pane; reopening clears the user-hidden flag |
| Auto-open | on first subagent or first pending, unless user-hidden (FR-001); if the terminal is too narrow (`isPlaced: false`), fall back to a status-line entry (`colony: 2 working, 1 needs you`) and a toast on pending |
| `userConfig` option `reducedMotion` (boolean, default false) | static frames, tick timer stopped (FR-017) |
| `userConfig` option `retentionSeconds` (number, default 30) | completed retention (FR-015) |
| Side effects | none on tools, prompts or permissions (FR-016) |

## Distribution contract (FR-019)

| Item | Requirement |
|---|---|
| `.claude-plugin/marketplace.json` | `{ "name": "colony-mod", "owner": { "name": "<author>" }, "plugins": [{ "name": "colony", "source": "./" }] }`; the plugin `name` MUST equal `plugin.json`'s `name` |
| Install line (in README, in a code block) | `/plugin install colony --marketplace <owner>/<repo>` followed by: answer `y` to *Add marketplace?*, choose a scope (user scope for every session), set options |
| Update / uninstall | documented in README using the plugin manager commands of the installed build |
| Try without installing | `git clone <repo-url>` then `claude --plugin-dir <folder>` |
| Troubleshooting | the two error messages from research R11 and the 144-column pane width note |
| Not in scope | publishing to any registry other than GitHub |
