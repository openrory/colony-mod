# Publishing colony

Repository: https://github.com/openrory/colony-mod

## First publish

1. Choose a license and add the `LICENSE` file (done: MIT).
2. Check everything locally: `claude plugin validate .` and `claude plugin test .` must pass.
3. Initialise git if needed and push to the GitHub repository:
   ```
   git init
   git add .
   git commit -m "Initial release"
   git branch -M main
   git remote add origin https://github.com/openrory/colony-mod.git
   git push -u origin main
   ```
4. Make sure the repository is public. A marketplace is read from the default branch.
5. Test it as a stranger would, in a clean session, using only the README:
   ```
   /plugin install colony --marketplace openrory/colony-mod
   ```
   Answer `y`, pick user scope, then run `/colony`. This is the check in `specs/001-agent-colony-pane/quickstart.md` ("Sharing check").

## Releasing an update

1. Change the code, then run validate and test.
2. Bump `version` in `.claude-plugin/plugin.json` (users are updated by version).
3. Commit, push, and optionally tag: `git tag v0.1.1 && git push --tags`.

## If install fails

- `Marketplace file not found at …`: `.claude-plugin/marketplace.json` is missing from the default branch.
- `Plugin "colony" not found in marketplace …`: the plugin `name` in `marketplace.json` must equal `name` in `.claude-plugin/plugin.json`.

## Releasing 0.2.1

Adds the **Share with my other sessions** switch and a default shared folder, `<your Claude folder>/colony`, so users no longer type a path. Sharing stays off by default. Users who set **Shared folder** in 0.2.0 keep sharing with no change. No migration is needed. After pushing, check `/plugin` in a session with 0.2.0 installed, then switch the option on in two sessions and confirm both files appear in `<your Claude folder>/colony`.

## Releasing 0.2.0

Adds the **Shared folder** option and the all-sessions pane (spec 002). No migration is needed: the option is empty by default, so existing installs behave as before. After pushing, check the update path with `/plugin` in a session that has 0.1.0 installed, then run the "All-sessions checks" in `specs/002-all-sessions-pane/quickstart.md` with two sessions.

## Releasing 0.2.2

Fixes phantom figures when the *Other sessions folder* and the shared folder are the same: the mod's own summary files (including ended markers) are no longer read as sessions (spec 004). No option, default or file format changes, so no migration is needed.

## Releasing 0.3.0

One switch for sharing (spec 005): **Share with my other sessions** now also shows other running sessions as limited figures, read from `<your Claude folder>/sessions`, so the separate *Other sessions folder* option is no longer needed. Options are renamed (*Sharing folder (optional)*, *Claude session files folder (optional)*); their keys do not change, so existing settings keep working, and a user who set only the session files folder sees no change. No migration is needed. After pushing, check `/plugin` in a session with 0.2.2 installed, then switch the option on in two sessions and confirm both files appear in `<your Claude folder>/colony` and that a session with the switch off shows as a limited figure.
