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
