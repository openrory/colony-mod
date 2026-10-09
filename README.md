# colony

A [Claude Code](https://code.claude.com) mod that shows a side pane with every agent and subagent in your session as a small pixel creature. At a glance you can see who is sleeping, who is working, who needs your answer, who has finished, and who is waiting for an outside event, and you can watch agents hand work to each other.

## What you see

| State | Look | Meaning |
|---|---|---|
| Idle | head down, floating `z` | the agent is asleep / has nothing to do |
| In progress | eyes open, moving | the agent is working |
| Pending | arms up, blinking `!` | the agent needs **you**: a question, or an approve/reject |
| Completed | arms in a V, tick | the agent finished |
| Failed / cancelled | fallen figure / boxed dot | the agent ended with an error or was stopped |
| Listening | antenna pulsing, `[source]` tag | the agent is waiting for an outside event (see limits) |
| Unknown | outline with `?` | the mod cannot tell what the agent is doing |

- **Size follows the model.** A Haiku agent is the smallest figure; Sonnet, Opus and Fable (rarely used) draw progressively bigger. A figure whose model is not known yet is the smallest size.
- **A darker fill shows context.** The body fills from the feet up in a darker shade of its state colour as the agent's context window fills. The fill is an estimate: the engine does not report a subagent's context window while it runs, so the mod estimates it from the agent's transcript and assumes a 200k window (1M for a `[1m]` model and for the 5.5 models).
- **Hover for details.** Point at a figure to see a card with its full title, state, model, tokens used and context estimate. The label under the figure is cut to fit; the card is not. Cost per agent is not shown, because the engine only reports cost for the whole session.
- **Working agents wander.** Agents that are working drift slowly side to side, sleeping and finished ones stay put, and agents that are talking walk toward each other.
- **Subagents** appear under the agent that started them, with a connector. Reusable agents (named agents and teammates) rest as a sleeping figure when they finish instead of being removed. Agents no orchestrator here started (a teammate in its own pane, for example) have no connector.
- **Eyes** show on awake figures; a sleeping figure's eyes are shut, drawn as two dashes, and a failed figure's are crossed.
- **Agents that are talking** (a subagent starting or returning a result, a message between agents, a parent waiting on a subagent) move closer together and exchange a stream of `0`s and `1`s. They drift apart when it ends.
- **Many agents:** older finished agents collapse into a `+N done` row. Agents that need you are never hidden.
- States are told apart by **shape and pose, not only colour**, and there is a reduced-motion option.

The mod only watches. It never changes your tools, prompts, permissions or output.

## Install

Type this at the prompt of a Claude Code **terminal** session:

```
/plugin install colony --marketplace openrory/colony-mod
```

Then:

1. Answer `y` to *Add marketplace?* (`github:openrory/colony-mod`).
2. Choose a scope. **User** keeps the mod active in every later session.
3. Set the options when asked (or accept the defaults).

You should see `Installed colony. Plugin is now active.` and it is active right away, with no restart.

> The install command is typed in a terminal session. The desktop app's Code tab answers that the command is not available there, but a mod installed from a terminal at user scope also draws in the desktop app.

### Try it without installing

```
git clone https://github.com/openrory/colony-mod.git
claude --plugin-dir ./colony-mod
```

## Use

- The pane opens by itself the first time a subagent appears or an agent needs your answer.
- `/colony` shows or hides the pane. If you close it yourself it stays closed until you run `/colony` again.
- When Claude Code cannot seat the pane (a narrow terminal, roughly under 144 columns), the mod does not draw it. It then shows a summary on the status line, such as `colony: 2 working, 1 needs you`, and a toast when something needs you. Widen the terminal, or run `/colony`, to see the pane.

## Options

| Option | Default | What it does |
|---|---|---|
| Reduced motion | off | static frames only; no animation timer |
| Retention seconds | 30 | how long finished agents stay in the pane before they are removed |
| Shared folder | empty | a folder you choose; set the **same** folder in every session to see all your sessions' agents in one pane. Empty means nothing is shared and nothing is read. See *Sharing across sessions* below |
| Other sessions folder | empty | absolute path of your Claude Code session files (for example `/Users/you/.claude/sessions`). When set, your other running sessions also appear as figures (their busy or idle state, name and folder on hover). Empty means the mod never reads other sessions |

Other sessions are shown as one figure each. Their own subagents are not visible from here, and a session that has quit can linger until its file is 6 hours old, because nothing in the file says whether it is still alive. The file format is not documented by Claude Code, so this may stop working after an update.

## Sharing across sessions

If you run several Claude Code sessions, you can open the pane in any of them and see **all** their agents and subagents together: each other session appears as a group beneath your own, with its agents, their states and the same 0s-and-1s exchanges. A group is marked `needs you` when one of its agents is waiting for your answer, and it dims with `stale` when its session stops updating.

**It is off by default.** To turn it on, set the **Shared folder** option to the same folder in every session (for example `/Users/you/.claude/colony`; create the folder first). Clear the option to turn it off again; the session then stops sharing and stops reading the others.

**What is shared.** Each session writes one small file, `<folder>/<session-id>.json`, every time something changes and about every 5 seconds as a heartbeat. It contains only:

- the session's name and working folder, and a version number and last-updated time
- for each agent: a short label (at most 40 characters), its state, its parent agent, its model, its token totals and what it is listening for
- which agents are currently exchanging information

It never contains your prompts, messages, tool inputs or outputs, or file contents. Only sessions that have set the same folder read these files, and nothing leaves your machine.

**Cleaning up.** When a session ends or sharing is turned off, its file is overwritten with a marker that holds no name, folder or agent information. The mods API cannot delete files, so these tiny marker files stay in the folder; they are ignored after a minute and are safe to delete by hand at any time.

**Sessions that do not share.** A session that has not set the shared folder (or does not have the mod) shows up only if you also set **Other sessions folder** (the older option above), and then as a single limited figure with no agent detail. The two options are independent.

## Update and uninstall

Use the plugin manager of your Claude Code build (`/plugin`) to update `colony` from the `colony-mod` marketplace or to uninstall it. To remove the marketplace as well, remove `colony-mod` from the marketplaces list in the same menu.

## Troubleshooting

| Message | Cause |
|---|---|
| `Marketplace file not found at …` | the repository you named has no `.claude-plugin/marketplace.json`; check `<owner>/<repo>` |
| `Plugin "colony" not found in marketplace …` | the name after `/plugin install` does not match the plugin name in the marketplace file |
| nothing appears | the terminal may be narrower than the pane needs; widen it or run `/colony` |

## Known limits

- **Listening is only what the mod can see.** The mods API cannot list triggers configured before the session. An agent shows as listening after it starts a `Monitor` or `RemoteTrigger`, and an inbound event (for example from GitHub) labels its source. A scheduled wake-up is the agent's own timer and does not count.
- **Which subagent is asking?** If the engine does not say which subagent raised a permission request, the mod attributes it to the most recently active agent.
- **Failed vs. completed subagents** depend on the engine's agent list being up to date when a subagent stops.
- **Sharing needs the mod in every session**, with the same Shared folder set in each. Updates reach other panes about a second late. It covers one user on one machine only.
- **You choose the folder.** The mods API gives the mod no home-directory path, so there is no default shared folder.
- **Very crowded panes:** if even the headers of many sessions do not fit, a group that needs you folds to its header (the `needs you` marker stays) before any group is dropped.
- The mods API is early access and may change between Claude Code releases.

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

Design documents live in [`specs/001-agent-colony-pane/`](specs/001-agent-colony-pane/).
