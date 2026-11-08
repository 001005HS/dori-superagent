# dori-superagent

**Dori lives in your chat. Tell him what to do in Slack, Telegram or Discord, and each job gets its own coding-agent session, tracked until the work is merged, with a CLEAR review at the exact head required before anything lands.**

English | [한국어](README.ko.md) | [简体中文](README.zh.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Italiano](README.it.md)

<p align="center">
  <img src="skills/dori-mode/assets/dori-avatar.png" alt="Dori" width="120">
</p>

Dori is a multi-session coding-agent harness from [Sisyphus Labs](https://sisyphuslabs.ai). One lead session talks to you. A request becomes a lane, which is one [omo](https://github.com/code-yeongyu/oh-my-openagent) session in its own [herdr](https://github.com/herdrdev/herdr) tab with its own written brief, and it stays open until its evidence reads back live. A duty loop keeps silent lanes moving. A merge gate stands between the work and `main`.

Two programs share the name `dori`, and this repository ships both. Install one per machine, or run the harness as `bun src/cli.ts` and leave `dori` to Dori mode.

| Piece | What it is | Reach for it when |
|---|---|---|
| The harness (`src/`, `prompts/`) | lead, lanes, duty loop, hourly loop, review and merge gate | you want the whole loop on one machine |
| Dori mode (`skills/dori-mode`) | the messenger CLI: send, receive, presence, done protocol | you want to talk to it from chat |

## What you get

| You get | What it means | Where it lives |
|---|---|---|
| Parallel work, not a queue | every job opens its own tab and its own agent session; several run at once | `dori start`, `src/lanes.ts` |
| A done that has to prove itself | a lane ends with `dori ready --evidence <link>`, and the lead closes it only after that link reads back | `ready()` in `src/lanes.ts`, `prompts/lane-footer.md` |
| No interrupted sessions | a message to a working pane is queued and delivered as one batch when the pane goes idle | `src/inbox.ts` |
| Silence gets noticed | a nudge at 10 and 20 minutes, an escalation to the lead at 40 | `NUDGE_MINUTES` in `src/duty.ts` |
| It finds the next task itself | the hourly loop pulls from a backlog, respects lane and host limits, and asks you only for decisions | `src/loop.ts`, [docs/hourly-loop.md](docs/hourly-loop.md) |
| Status that stays in one place | one message per job, edited in place instead of re-posted | `edit` in `skills/dori-mode/scripts/src/messenger/` |
| One voice | lanes and the duty session never talk to you; everything reaches the lead | `prompts/lead.md`, `prompts/duty.md` |

![architecture](docs/architecture.png)

## Talk to it from your chat

This repository implements three channels. Each one posts, edits a message in place, and threads a reply.

| Channel | Send and edit | Receive | Show as online | What you set |
|---|---|---|---|---|
| Slack | post, reply in a thread, edit in place | threads view, threads you posted in, DMs and mentions | yes, with a user token | `DORI_SLACK_TOKEN`, plus `DORI_SLACK_COOKIE` for a user token |
| Telegram | post, reply into a forum topic, edit in place | owner DMs, one group topic, edits, media file ids | not applicable to a bot | `DORI_TELEGRAM_TOKEN`, `DORI_TELEGRAM_OWNER_ID`, optionally `DORI_TELEGRAM_GROUP_ID` and `DORI_TELEGRAM_TOPIC_ID` |
| Discord | post, post into a thread, edit in place | not in this repository | yes, a gateway connection | `DORI_DISCORD_TOKEN` |

### Slack

A user token acts as a real member: it needs a paid seat, it sees everything that member sees, and `dori presence slack` can hold the green dot. A bot token costs no seat, sees only channels it was invited to, and shows as an app. Pick one and record it, because it decides what onboarding can read.

```sh
export DORI_SLACK_TOKEN=xoxp-...
export DORI_SLACK_COOKIE=...          # the `d` cookie, user token only

dori send slack --to C0123456789 --text "PR #12 is green" --thread 1712345678.123456
dori send slack --to C0123456789 --edit 1712345678.123456 --text "PR #12 merged"
dori inbound slack --loop 1           # INBOUND lines, one per new message
dori presence slack                   # user token: stay shown as online
```

An untagged reply under a thread Dori started still arrives. Inbound reads Slack's threads view, every thread Dori posted in (recorded in `<stateDir>/slack-threads.json`), and unread DMs, group DMs and mentions.

### Telegram

```sh
export DORI_TELEGRAM_TOKEN=...
export DORI_TELEGRAM_OWNER_ID=123456789      # only this account is a request
export DORI_TELEGRAM_GROUP_ID=-1001234567890 # optional: one group
export DORI_TELEGRAM_TOPIC_ID=42             # optional: one forum topic inside it

dori send telegram --to -1001234567890 --thread 42 --text "PR #12 is green"
dori inbound telegram --loop 1
```

Inbound is owner-gated: DMs from the configured owner always pass; in a group, only the configured topic does; bot messages never do. Edits arrive as their own message. A voice note, photo or document arrives as a line carrying its `file_id`, which you hand to Telegram's `getFile`; `dori transcribe <file>` then turns downloaded audio into text through `hooks.transcribe`.

### Discord

```sh
export DORI_DISCORD_TOKEN=...

dori send discord --to 123456789012345678 --text "PR #12 is green"
dori presence discord                 # stay shown as online on the gateway
```

Outbound works, including posting into a thread you pass as `--thread`. Receiving is the gap: `dori inbound` accepts `slack` or `telegram` only, and the Discord gateway connection in this repository identifies and heartbeats without dispatching an inbound message. `references/setup.md` has the Dori install agent-messenger for the platform side and read your platform's current API for the rest.

### Also in the library, not on a command

Each messenger module is a typed class you can import, and it does more than the CLI exposes:

- Slack file upload (upload URL, then complete) at `skills/dori-mode/scripts/src/messenger/slack.ts`.
- Telegram forum topics (create, rename, close, reopen), draft streaming with a `Thinking…` start, and HTML tables at `skills/dori-mode/scripts/src/messenger/telegram.ts`.
- Discord thread create, rename and archive at `skills/dori-mode/scripts/src/messenger/discord.ts`.

The full module list is in [skills/dori-mode/references/scripts.md](skills/dori-mode/references/scripts.md).

### No other channels

This repository has no Teams, WhatsApp, LINE, WeChat, iMessage, KakaoTalk or Lark support, and `dori send` refuses a channel it does not know. Sisyphus Labs publishes a wider platform list for its hosted product, with the same footnote this README keeps: the shipped Dori mode covers Telegram, Discord and Slack.

## Install

You need [Bun](https://bun.sh) 1.4.4 or newer, [herdr](https://herdr.dev) (the terminal multiplexer that hosts the panes), [omo](https://github.com/code-yeongyu/oh-my-openagent) (the coding agent that runs in them), and the GitHub CLI `gh` for review, checks and the merge.

### The harness

```sh
git clone https://github.com/sisyphuslabs/dori-superagent
cd dori-superagent
bun install
bun link        # puts `dori` on your PATH; without it, use `bun src/cli.ts` below
```

### Dori mode, the messenger CLI

```sh
curl -fsSL https://raw.githubusercontent.com/sisyphuslabs/dori-superagent/main/install.sh | bash
```

That clones this repository to `~/.dori/src`, links the skill into `~/.agents/skills/dori-mode`, puts Dori mode's `dori` on your PATH, and copies `references/config.example.json` to `~/.dori/config.json`. Then edit that file: at least `leadPane` (from `herdr pane current`), `laneWorkspace` and `defaultCwd`.

## Quickstart

Start herdr's server, then bring the harness up:

```sh
dori up
# UP lead=w1:p1 duty=w1:p2 loop=w1:p3 hourly=w1:p4 home=~/.dori
```

A herdr workspace named `dori` opens with the lead in it, an omo session that gets `prompts/lead.md` appended to its system prompt, and the duty session, the duty loop and the hourly loop under it. Talk to the lead. It writes a brief (goal, inputs, deliverable, stop condition, constraints; see [examples/brief.md](examples/brief.md)) and opens lanes itself, or you open one from the shell:

```sh
dori start fix-flaky-login --brief examples/brief.md
# STARTED fix-flaky-login pane=w1:p5 brief=/Users/you/.dori/briefs/fix-flaky-login.md

dori status
# lead=w1:p1 duty=w1:p2 home=/Users/you/.dori
# fix-flaky-login         working  w1:p5    active 0m ago  start: examples/brief.md
```

A lane key matches `^[a-z][a-z0-9-]{1,40}$`, and a key that is already open is refused. Inside the lane, the agent reports and finishes with the commands the lane rules hand it:

```sh
dori report fix-flaky-login --text 'reproduced: 1 failure in 20 runs, shared session fixture'
dori report fix-flaky-login --status waiting --text 'WAITING: checks on owner/repo#12'
dori ready fix-flaky-login --text 'root cause fixed, checks green' --evidence https://github.com/owner/repo/pull/12
# READY fix-flaky-login
```

The lead reads `[READY fix-flaky-login]` in its pane and runs the gate itself:

```sh
dori review owner/repo#12             # a fresh omo reviewer pinned to the head; writes a receipt
dori merge owner/repo#12 --dry-run    # MERGE_OK owner/repo#12 head=<sha> (dry run), or MERGE_REFUSED <why>
dori merge owner/repo#12              # gh pr merge --squash --match-head-commit <sha>
dori done fix-flaky-login             # closes the lane's tab; only a READY lane can be closed
```

`dori send <lead|duty|key|pane> --text '...'` delivers to a pane or queues while it is busy. `--text` can be left off to read from stdin. The commands the agents receive are rendered with the full path to `src/cli.ts` and `DORI_HOME` set, so the agents never depend on which `dori` is on your PATH.

## How it works

![lane lifecycle](docs/lane-flow.png)

The lead is the only session that talks to you. It turns a request into a brief, opens a lane, reads what lanes send back, and merges.

A lane is one agent session in its own tab, started with one brief and the lane rules appended to it (`prompts/lane-footer.md`). It reports milestones with `dori report` and finishes with `dori ready`, which refuses to go out without an evidence link. Everything a lane does reaches the lead as one line: `[START]`, `[REPORT]`, `[READY]`, `[LOST]`, `[ESCALATE]`.

The duty loop is `dori duty --interval 60`, a plain process next to a duty session. Each tick it flushes queued messages into panes that went idle, nudges lanes that have been silent, escalates to the lead, and marks a lane whose pane vanished as lost.

The hourly loop is `dori loop`. Once an hour it syncs the backlog against reality, audits missed work, starts the next item that needs nobody's decision, asks each open question once, and sends one report. It never merges, never pushes and never closes a pane.

State is JSON on disk under `~/.dori` (or `$DORI_HOME`): `lanes/`, `inbox/`, `briefs/`, `receipts/`, plus `backlog/` and `loop/` for the hourly loop and `duty/` for its stop file. The only long-running processes the harness adds are those two loops, and the only runtime dependency is Bun.

### The merge gate

`dori merge` reads the PR's head SHA with `gh` and refuses for a named reason:

| Refusal | Meaning |
|---|---|
| `no_receipt` | no CLEAR review receipt for this exact head |
| `review_block` | the receipt at this head says BLOCK |
| `no_checks` | the check list is empty, and an empty list is never green |
| `checks_red` | a check failed |
| `checks_all_skipped` | every check was skipped, so nothing passed |

`dori review` writes those receipts and nothing else does. It runs a fresh non-interactive omo on `prompts/review.md` pinned to the head, and a reviewer that prints no `VERDICT:` line writes no receipt. A push after the review moves the head, so the old receipt no longer applies.

`hooks.reviewCommand` in `~/.dori/config.json` replaces the built-in reviewer with your own command, which must print the same `VERDICT:` line.

## Command reference

The harness, `src/cli.ts`:

| Command | Does |
|---|---|
| `dori up [--cwd DIR]` | open the lead, duty, duty loop and hourly loop panes |
| `dori start <key> --brief FILE [--cwd DIR]` | open a lane: new tab, agent session, brief plus lane rules |
| `dori report <key> --text T [--status working\|waiting]` | a lane records a milestone or a wait |
| `dori ready <key> --text T --evidence LINK` | a lane finishes; refuses without evidence |
| `dori review <owner/repo#N> [--model M]` | fresh reviewer at the exact head, writes a receipt |
| `dori merge <owner/repo#N> [--dry-run]` | CLEAR receipt plus green checks, then a squash merge |
| `dori done <key>` | the lead closes a READY lane |
| `dori status` | roles and every open lane |
| `dori duty [--once] \| stop \| resume \| status` | the duty loop and its kill switch |
| `dori loop [--once] \| stop \| resume \| status` | the hourly loop and its kill switch |
| `dori backlog add \| list \| decide \| drop \| import` | the queue the hourly loop pulls from |
| `dori send <target> --text T` and `dori inbox list\|ack\|resend` | deliver, queue, and resolve a held delivery |
| `dori role <lead\|duty> [PANE]` | register a pane when you did not use `dori up` |

`bun src/cli.ts` with no arguments prints the same list with every flag.

Dori mode, `skills/dori-mode/scripts/src/cli.ts`:

| Command | Does |
|---|---|
| `dori launch <key> --title T --brief FILE --done "..."` | open a lane, with optional wall, token and cost ceilings |
| `dori claim-done` and `dori object-done` | the 5-minute done flow |
| `dori close <key>` | closes a lane whose `Done =` signals read back live |
| `dori sync` / `dori boot` | registry against live panes; the read-only check after a restart |
| `dori freshness` / `dori dead-panes` / `dori guard` / `dori heavy` | nudge, detect, watch host load, gate heavy commands |
| `dori send` / `dori inbound` / `dori presence` / `dori transcribe` | the messenger commands above |
| `dori worklog` / `dori lesson` / `dori checkpoint` | the lead's record of requests, lessons per repo, completed steps |

`dori launch --dry-run` prints the brief as the lane would receive it.

## Extend it

Lifecycle hooks in `~/.dori/config.json` call your own program on a transition, as an argv array with `{key}`, `{text}`, `{evidence}`, `{repo}`, `{number}` and `{sha}` filled per argument, never through a shell:

| Hook | Fires on |
|---|---|
| `hooks.onReady` | a lane finishes with evidence |
| `hooks.onReport` | a lane reports |
| `hooks.onLost` | a lane's pane disappears |
| `hooks.reviewCommand` | replaces the built-in reviewer |

A hook that hangs cannot hold a command open: the CLI waits at most two seconds for hooks still running and says so. `DORI_PROMPTS_DIR` swaps the four prompt files for your own, `DORI_AGENT_CMD` swaps `omo` for another agent binary, and `DORI_HOME` moves the state directory.

## Run it in a container

[examples/container](examples/container) builds an Ubuntu image with gh, node, bun, herdr, omo and the harness pinned, one `dori` service, and named volumes for every piece of state. There is no published image: you build it locally and log in once inside it. [docs/container.md](docs/container.md) covers the build, the volumes that survive a restart, and the sizing.

## Tests

```sh
bun run test        # 275 tests in ./test/
bun run test:skill  # 308 tests in skills/dori-mode/scripts
bun run ci          # Biome, tsc, knip, the 250-line ratchet, then both suites
```

Neither suite needs a model or the network: the harness runs against a fake herdr and a fake `gh`, and Dori mode against fake herdr, git and `gh`. Two end-to-end tests start a real herdr server and skip themselves when `herdr` is not on PATH.

## Telemetry

`dori` sends anonymous usage counts the way omo does: OTLP/HTTP JSON to `https://t.omo.dev`, with a random install id kept in `~/.dori/telemetry.json` and only its sha256 sent. What leaves the machine is counts and fixed enums: installed, daily active, lane started, lane ready, review completed, merge decided, and one hourly duty summary. Never sent: paths, repo names, PR numbers, lane keys, briefs, messages or any other text. Turn it off with `DORI_TELEMETRY=0` (`DO_NOT_TRACK=1` also works), and point it elsewhere with `DORI_TELEMETRY_ENDPOINT`. Telemetry never makes a command fail.

## License

MIT, see [LICENSE](LICENSE). The prompts in `prompts/` are the instructions the agents actually receive, and they are short enough to read before you trust them.
