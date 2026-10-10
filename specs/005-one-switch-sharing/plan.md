# Implementation Plan: One Switch for Sharing, Clear Option Names

**Branch**: `005-one-switch-sharing` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

The mod keeps its two folders but one switch, `shareSessions`, controls both. Defaults come from the Claude folder (the configured Claude folder if set, else `<home>/.claude`): `colony` for sharing (spec 002) and `sessions` for Claude's session files (spec 003). The settings keys stay as they are; only titles and descriptions change. Constitution: still the unfilled template; PASS.

## Design

- `src/runtime.ts`: add `sessionsFolderFor({ shareSessions, sessionsDirectory, configDir, home })`, same shape and rules as the existing `sharedFolderFor` (override wins, otherwise the switch decides, otherwise empty; trailing slashes stripped; empty when the Claude folder is unknown). Default is `<configDir or home/.claude>/sessions`.
- `hooks/register.tsx`: `resolveSharedFolder` becomes `resolveFolders` and resolves both folders once at session start with the same two variable reads (string literals); the peer reader uses the resolved sessions folder instead of the raw option. No other behaviour changes.
- `.claude-plugin/plugin.json`: keys unchanged. Titles and descriptions: `shareSessions` "Share with my other sessions"; `sharedFolder` "Sharing folder (optional)"; `sessionsDirectory` "Claude session files folder (optional)".
- README options table and "Sharing across sessions" rewritten around the one switch; specs 002 and 003 get a note pointing at this spec where their option rules are superseded.
- Version 0.3.0 (behaviour change: the switch now also shows non-sharing sessions).

## Project Structure

```text
specs/005-one-switch-sharing/   spec.md, plan.md, tasks.md, checklists/
src/runtime.ts                   sessionsFolderFor + tests
hooks/register.tsx               resolveFolders; peer reader uses the resolved folder
.claude-plugin/plugin.json       titles, descriptions, version
README.md, docs/PUBLISHING.md    docs and release note
tests/runtime.test.ts, tests/register.test.ts
```
