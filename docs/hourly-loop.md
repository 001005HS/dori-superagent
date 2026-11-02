# Hourly loop

`dori loop` is an always-on process that wakes once an hour, checks the harness against reality, and starts the next piece of work that needs nobody's decision. `dori up` starts it in a pane under the duty loop. The duty loop works in minutes (nudges, inbox flushes). The hourly loop works in hours: it decides what runs next.

## Where the next work comes from

A local backlog under `$DORI_HOME/backlog/`: one `<id>.json` and one `<id>.md` brief per item, where the item id becomes the lane key. Items are added by the lead (`dori backlog add`) or imported from GitHub issues carrying a label (`dori backlog import owner/repo --label dori`). The loop reads only the local backlog. GitHub is one source that feeds it.

An item that needs a person carries a `decision` (the question). While it is set, the item is never started. `dori backlog decide <id> --text ANSWER` clears it and appends the answer to the item's brief, so the lane that later runs it sees the answer. `dori backlog drop <id>` retires the item.

## One run, in order

0. Gate. A stop file means do nothing at all. A live lock held by another process means skip. A run less than an interval ago means skip, unless `--force`.
1. Sync. A running item whose lane is done becomes done. One whose lane was lost goes back to open with one more attempt, and after 2 lost attempts it gets a decision ("retry, re-brief or drop?"). One whose lane is READY with a merged PR becomes done. An open item imported from an issue that is now closed is dropped.
2. Audit. Read-only checks: a working or waiting lane with no report for 3 hours, a READY lane not closed after 2 hours, a lane whose pane is gone.
3. Pull. Free slots = `--max-lanes` (default 3) minus open lanes, and at most `--max-starts` (default 2) per run. Nothing starts when the 1-minute load is above the core count (or `--max-load`) or free memory is under 10%. Candidates are open items with no decision, ordered by priority (1 first), then age, then id.
4. Ask. Each open decision is asked once through the lead as a `[DECIDE <id>]` line, with at most one reminder after 6 hours.
5. Record and report. The run is written to `loop/runs/<time>.json` (the newest 168 are kept) and `loop/last-run.json`, then one `[LOOP ...]` message goes to the lead: lanes against the limit, backlog counts, host load and memory, and each non-empty section.

## Safety

- The loop's only side effects are opening lanes (`dori start`), messages to the lead, and its own files. It never merges, never pushes, never closes a pane and never edits a lane record. Its `gh` calls are reads.
- Only the lead talks to the human. Questions reach the human through the lead.
- Kill switch: `dori loop stop [--text WHY]` writes `loop/stop`. Until `dori loop resume`, every run does nothing. The backlog can still be edited while it is stopped.
- One loop at a time: the lock is created atomically and is taken over only when its process is dead, and the last-run stamp keeps a second loop or a cron `--once` from running the same hour twice.
- A failing `gh` or herdr call becomes a finding in the record and the run goes on. A failed lane start stops pulling for that run.
