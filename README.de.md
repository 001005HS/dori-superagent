# dori-superagent

**Dori wohnt in deinem Chat. Sag ihm in Slack, Telegram oder Discord, was zu tun ist, und jeder Auftrag bekommt seine eigene Coding-Agent-Sitzung, die bis zum Merge verfolgt wird. Vor dem Merge braucht es ein CLEAR-Review genau auf diesem head.**

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh.md) | [日本語](README.ja.md) | Deutsch | [Italiano](README.it.md)

<p align="center">
  <img src="assets/og.png" alt="Ein Mesh über alle deine Maschinen, verbunden über einen verschlüsselten Relay, der nichts speichert." width="880">
</p>

<p align="center">
  <img src="skills/dori-mode/assets/dori-avatar.png" alt="Dori" width="120">
</p>

Dori ist ein Harness für Coding-Agenten mit vielen Sitzungen, von [Sisyphus Labs](https://sisyphuslabs.ai). Mit dir spricht genau eine lead-Sitzung. Eine Anfrage wird zu einer lane: eine [omo](https://github.com/code-yeongyu/oh-my-openagent)-Sitzung in einem eigenen [herdr](https://github.com/herdrdev/herdr)-Tab mit einem eigenen geschriebenen brief, und sie bleibt offen, bis ihre Belege am lebenden Objekt nachgelesen sind. Eine duty-Schleife hält stille lanes in Bewegung, ein Merge-Gate steht zwischen der Arbeit und `main`.

Zwei Programme heißen `dori`, und dieses Repository liefert beide. Installiere eines pro Maschine, oder starte das Harness mit `bun src/cli.ts` und überlass `dori` dem Dori mode.

| Teil | Was es ist | Wann du es nimmst |
|---|---|---|
| Das Harness (`src/`, `prompts/`) | lead, lanes, duty-Schleife, Stundenschleife, Review- und Merge-Gate | du willst die ganze Schleife auf einer Maschine |
| Dori mode (`skills/dori-mode`) | die Messenger-CLI: senden, empfangen, Präsenz, Done-Protokoll | du willst aus dem Chat mit ihm reden |

## Was du bekommst

| Du bekommst | Was das heißt | Wo es steckt |
|---|---|---|
| Arbeit parallel statt in der Schlange | jeder Auftrag öffnet einen eigenen Tab und eine eigene Agent-Sitzung, mehrere laufen gleichzeitig | `dori start`, `src/lanes.ts` |
| Ein Done, das sich beweisen muss | eine lane endet mit `dori ready --evidence <Link>`, und der lead schließt sie erst, wenn dieser Link am lebenden Objekt nachgelesen ist | `ready()` in `src/lanes.ts`, `prompts/lane-footer.md` |
| Keine unterbrochenen Sitzungen | eine Nachricht an einen beschäftigten Pane wird eingereiht und als ein Bündel zugestellt, sobald der Pane idle ist | `src/inbox.ts` |
| Stille fällt auf | ein Anstoß nach 10 und nach 20 Minuten, eine Eskalation an den lead nach 40 | `NUDGE_MINUTES` in `src/duty.ts` |
| Es findet die nächste Aufgabe selbst | die Stundenschleife zieht aus einem backlog, hält lane- und Host-Grenzen ein und fragt dich nur nach Entscheidungen | `src/loop.ts`, [docs/hourly-loop.md](docs/hourly-loop.md) |
| Status an einer Stelle | eine Nachricht pro Auftrag, an Ort und Stelle bearbeitet statt neu gepostet | `edit` in `skills/dori-mode/scripts/src/messenger/` |
| Eine Stimme | lanes und die duty-Sitzung sprechen nie mit dir, alles landet beim lead | `prompts/lead.md`, `prompts/duty.md` |
| Antwortet so, wie du schreibst | keine Emojis im Geschriebenen, kurze Nachrichten, die Sprache des Threads | `skills/dori-mode/SKILL.md` |

![architecture](docs/architecture.png)

## Sprich aus deinem Chat mit ihm

Dieses Repository implementiert drei Kanäle. Jeder postet, bearbeitet eine Nachricht an Ort und Stelle und antwortet im Thread.

| Kanal | Senden und Bearbeiten | Empfangen | Als online zeigen | Was du setzt |
|---|---|---|---|---|
| Slack | posten, im Thread antworten, an Ort und Stelle bearbeiten | Threads-Ansicht, Threads in denen du gepostet hast, DMs und Erwähnungen | ja, mit einem User-Token | `DORI_SLACK_TOKEN`, für ein User-Token zusätzlich `DORI_SLACK_COOKIE` |
| Telegram | posten, in ein Forum-Thema antworten, an Ort und Stelle bearbeiten | DMs des Owners, ein Gruppenthema, Bearbeitungen, file ids von Medien | für einen Bot nicht zutreffend | `DORI_TELEGRAM_TOKEN`, `DORI_TELEGRAM_OWNER_ID`, optional `DORI_TELEGRAM_GROUP_ID` und `DORI_TELEGRAM_TOPIC_ID` |
| Discord | posten, in einen Thread posten, an Ort und Stelle bearbeiten | in diesem Repository nicht enthalten | ja, über eine Gateway-Verbindung | `DORI_DISCORD_TOKEN` |

### Slack

Ein User-Token handelt als echtes Mitglied: es braucht einen bezahlten Seat, sieht alles was dieses Mitglied sieht, und `dori presence slack` hält den grünen Punkt. Ein Bot-Token kostet keinen Seat, sieht nur eingeladene Kanäle und zeigt sich als App. Entscheide dich und halte es fest, denn davon hängt ab, was das Onboarding lesen darf.

```sh
export DORI_SLACK_TOKEN=xoxp-...
export DORI_SLACK_COOKIE=...          # das `d`-Cookie, nur beim User-Token

dori send slack --to C0123456789 --text "PR #12 ist grün" --thread 1712345678.123456
dori send slack --to C0123456789 --edit 1712345678.123456 --text "PR #12 ist gemergt"
dori inbound slack --loop 1           # INBOUND-Zeilen, eine pro neuer Nachricht
dori presence slack                   # User-Token: als online sichtbar bleiben
```

Auch eine Antwort ohne Erwähnung unter einem Thread, den Dori eröffnet hat, kommt an. Der Empfang liest drei Stellen: die Threads-Ansicht von Slack, jeden Thread in dem Dori gepostet hat (festgehalten in `<stateDir>/slack-threads.json`), und ungelesene DMs, Gruppen-DMs und Erwähnungen.

### Telegram

```sh
export DORI_TELEGRAM_TOKEN=...
export DORI_TELEGRAM_OWNER_ID=123456789      # nur dieses Konto ist ein Auftrag
export DORI_TELEGRAM_GROUP_ID=-1001234567890 # optional: eine Gruppe
export DORI_TELEGRAM_TOPIC_ID=42             # optional: ein Forum-Thema darin

dori send telegram --to -1001234567890 --thread 42 --text "PR #12 ist grün"
dori inbound telegram --loop 1
```

Der Empfang ist auf den Owner begrenzt: DMs des eingestellten Owners kommen immer durch, in einer Gruppe nur das eingestellte Thema, Bot-Nachrichten nie. Bearbeitungen kommen als eigene Nachricht. Eine Sprachnachricht, ein Foto oder ein Dokument kommt als Zeile mit ihrer `file_id`, die du an Telegrams `getFile` gibst; `dori transcribe <Datei>` macht aus heruntergeladenem Audio über `hooks.transcribe` Text.

### Discord

```sh
export DORI_DISCORD_TOKEN=...

dori send discord --to 123456789012345678 --text "PR #12 ist grün"
dori presence discord                 # über das Gateway als online sichtbar bleiben
```

Das Senden funktioniert, auch in einen Thread, den du als `--thread` übergibst. Der Empfang ist die Lücke: `dori inbound` kennt nur `slack` und `telegram`, und die Discord-Gateway-Verbindung in diesem Repository identifiziert sich und sendet Heartbeats, stellt aber keine eingehende Nachricht zu. Für die Plattformseite steht in `references/setup.md`, dass Dori agent-messenger installiert; den Rest liest du aus der aktuellen API deiner Plattform.

### Auch in der Bibliothek, nicht auf einem Befehl

Jedes Messenger-Modul ist eine typisierte Klasse zum Importieren, und sie kann mehr als die CLI zeigt:

- Slack-Datei-Upload (Upload-URL holen, dann abschließen) in `skills/dori-mode/scripts/src/messenger/slack.ts`
- Telegram-Forum-Themen (anlegen, umbenennen, schließen, wieder öffnen), Draft-Streaming mit einem `Thinking…`-Start und HTML-Tabellen in `skills/dori-mode/scripts/src/messenger/telegram.ts`
- Discord-Thread anlegen, umbenennen und archivieren in `skills/dori-mode/scripts/src/messenger/discord.ts`

Die vollständige Modulliste steht in [skills/dori-mode/references/scripts.md](skills/dori-mode/references/scripts.md).

### Keine weiteren Kanäle

Dieses Repository hat keine Unterstützung für Teams, WhatsApp, LINE, WeChat, iMessage, KakaoTalk oder Lark, und `dori send` weist einen Kanal ab, den es nicht kennt. Sisyphus Labs veröffentlicht für das gehostete Produkt eine längere Plattformliste, mit derselben Fußnote, die dieses README übernimmt: das ausgelieferte Dori mode deckt Telegram, Discord und Slack ab.

## Installation

Du brauchst [Bun](https://bun.sh) 1.4.4 oder neuer, [herdr](https://herdr.dev) als Terminal-Multiplexer, der die Panes beherbergt, [omo](https://github.com/code-yeongyu/oh-my-openagent) als Coding-Agent darin, und die GitHub-CLI `gh` für Review, Checks und Merge.

### Das Harness

```sh
git clone https://github.com/sisyphuslabs/dori-superagent
cd dori-superagent
bun install
bun link        # legt `dori` auf deinen PATH; sonst unten `bun src/cli.ts` statt `dori`
```

### Dori mode, die Messenger-CLI

```sh
curl -fsSL https://raw.githubusercontent.com/sisyphuslabs/dori-superagent/main/install.sh | bash
```

Das klont dieses Repository nach `~/.dori/src`, verlinkt den Skill nach `~/.agents/skills/dori-mode`, legt das `dori` von Dori mode auf deinen PATH und kopiert `references/config.example.json` nach `~/.dori/config.json`. Danach bearbeitest du die Datei: mindestens `leadPane` (aus `herdr pane current`), `laneWorkspace` und `defaultCwd`.

## Schnellstart

Starte den Server von herdr und fahre dann das Harness hoch:

```sh
dori up
# UP lead=w1:p1 duty=w1:p2 loop=w1:p3 hourly=w1:p4 home=~/.dori
```

Es öffnet sich ein herdr-Workspace namens `dori` mit dem lead darin, einer omo-Sitzung, die `prompts/lead.md` an ihren Systemprompt angehängt bekommt, und darunter die duty-Sitzung, die duty-Schleife und die Stundenschleife. Sprich mit dem lead. Er schreibt einen brief (Ziel, Eingaben, Lieferobjekt, Abbruchbedingung, Einschränkungen, siehe [examples/brief.md](examples/brief.md)) und öffnet lanes selbst, oder du öffnest eine aus der Shell:

```sh
dori start fix-flaky-login --brief examples/brief.md
# STARTED fix-flaky-login pane=w1:p5 brief=/Users/you/.dori/briefs/fix-flaky-login.md

dori status
# lead=w1:p1 duty=w1:p2 home=/Users/you/.dori
# fix-flaky-login         working  w1:p5    active 0m ago  start: examples/brief.md
```

Ein lane-Key passt auf `^[a-z][a-z0-9-]{1,40}$`, und ein bereits offener Key wird abgewiesen. In der lane meldet und beendet sich der Agent mit den Befehlen, die ihm die lane-Regeln geben:

```sh
dori report fix-flaky-login --text 'reproduziert: 1 Fehler in 20 Läufen, geteiltes Session-Fixture'
dori report fix-flaky-login --status waiting --text 'WAITING: Checks auf owner/repo#12'
dori ready fix-flaky-login --text 'Ursache behoben, Checks grün' --evidence https://github.com/owner/repo/pull/12
# READY fix-flaky-login
```

Der lead liest `[READY fix-flaky-login]` in seinem Pane und fährt das Gate selbst:

```sh
dori review owner/repo#12             # frischer omo-Reviewer auf dem head, schreibt ein Receipt
dori merge owner/repo#12 --dry-run    # MERGE_OK owner/repo#12 head=<sha> (dry run), oder MERGE_REFUSED <Grund>
dori merge owner/repo#12              # gh pr merge --squash --match-head-commit <sha>
dori done fix-flaky-login             # schließt den Tab der lane; nur eine READY-lane lässt sich schließen
```

`dori send <lead|duty|key|pane> --text '...'` stellt an einen Pane zu oder reiht ein, solange er beschäftigt ist. Ohne `--text` liest der Befehl aus stdin. Die Befehle, die die Agenten bekommen, werden mit dem vollen Pfad zu `src/cli.ts` und gesetztem `DORI_HOME` gerendert, damit sie nie davon abhängen, welches `dori` in deinem PATH liegt.

## Wie es funktioniert

![lane lifecycle](docs/lane-flow.png)

Der lead ist die einzige Sitzung, die mit dir spricht. Er macht aus einer Anfrage einen brief, öffnet eine lane, liest, was lanes zurückschicken, und mergt.

Eine lane ist eine Agent-Sitzung in einem eigenen Tab, gestartet mit einem brief und den angehängten lane-Regeln (`prompts/lane-footer.md`). Sie meldet Meilensteine mit `dori report` und endet mit `dori ready`, das ohne Beleg-Link nicht rausgeht. Alles, was eine lane tut, erreicht den lead als eine Zeile: `[START]`, `[REPORT]`, `[READY]`, `[LOST]`, `[ESCALATE]`.

Die duty-Schleife ist `dori duty --interval 60`, ein gewöhnlicher Prozess neben einer duty-Sitzung. Bei jedem Tick schüttet sie eingereihte Nachrichten in Panes, die idle geworden sind, stößt stille lanes an, eskaliert an den lead und markiert eine lane, deren Pane verschwunden ist, als verloren.

Die Stundenschleife ist `dori loop`. Einmal pro Stunde gleicht sie das backlog mit der Wirklichkeit ab, prüft übersehene Arbeit, startet den nächsten Eintrag, der keine Entscheidung braucht, stellt jede offene Frage einmal und schickt einen Bericht. Sie mergt nie, pusht nie und schließt nie einen Pane.

Der Zustand liegt als JSON unter `~/.dori` (oder `$DORI_HOME`): `lanes/`, `inbox/`, `briefs/`, `receipts/`, dazu `backlog/` und `loop/` für die Stundenschleife und `duty/` für ihre Stoppdatei. Die einzigen Dauprozesse, die das Harness hinzufügt, sind diese zwei Schleifen, und die einzige Laufzeitabhängigkeit ist Bun.

### Das Merge-Gate

`dori merge` liest den head-SHA der PR mit `gh` und weist mit einem benannten Grund ab:

| Ablehnung | Bedeutung |
|---|---|
| `no_receipt` | kein CLEAR-Review-Receipt für genau diesen head |
| `review_block` | das Receipt auf diesem head sagt BLOCK |
| `no_checks` | die Checkliste ist leer, und eine leere Liste ist nie grün |
| `checks_red` | ein Check ist fehlgeschlagen |
| `checks_all_skipped` | alle Checks wurden übersprungen, also ist nichts durchgelaufen |

Receipts schreibt `dori review`, sonst nichts. Es lässt ein frisches, nicht interaktives omo auf `prompts/review.md` gegen den head laufen, und ein Reviewer ohne `VERDICT:`-Zeile schreibt kein Receipt. Ein Push nach dem Review verschiebt den head, damit gilt das alte Receipt nicht mehr.

`hooks.reviewCommand` in `~/.dori/config.json` ersetzt den eingebauten Reviewer durch deinen eigenen Befehl, der dieselbe `VERDICT:`-Zeile ausgeben muss.

## Befehlsübersicht

Das Harness, `src/cli.ts`:

| Befehl | Tut |
|---|---|
| `dori up [--cwd DIR]` | öffnet die Panes für lead, duty, duty-Schleife und Stundenschleife |
| `dori start <key> --brief FILE [--cwd DIR]` | öffnet eine lane: neuer Tab, Agent-Sitzung, brief plus lane-Regeln |
| `dori report <key> --text T [--status working\|waiting]` | eine lane hält einen Meilenstein oder ein Warten fest |
| `dori ready <key> --text T --evidence LINK` | eine lane endet, ohne Beleg verweigert |
| `dori review <owner/repo#N> [--model M]` | frischer Reviewer auf dem head, schreibt ein Receipt |
| `dori merge <owner/repo#N> [--dry-run]` | CLEAR-Receipt plus grüne Checks, dann Squash-Merge |
| `dori done <key>` | der lead schließt eine READY-lane |
| `dori status` | Rollen und jede offene lane |
| `dori duty [--once] \| stop \| resume \| status` | die duty-Schleife und ihr Notaus |
| `dori loop [--once] \| stop \| resume \| status` | die Stundenschleife und ihr Notaus |
| `dori backlog add \| list \| decide \| drop \| import` | die Warteschlange, aus der die Stundenschleife zieht |
| `dori send <target> --text T` und `dori inbox list\|ack\|resend` | zustellen, einreihen und eine zurückgehaltene Zustellung auflösen |
| `dori role <lead\|duty> [PANE]` | einen Pane registrieren, wenn du `dori up` nicht benutzt hast |

`bun src/cli.ts` ohne Argumente druckt dieselbe Liste mit allen Flags.

Dori mode, `skills/dori-mode/scripts/src/cli.ts`:

| Befehl | Tut |
|---|---|
| `dori launch <key> --title T --brief FILE --done "..."` | öffnet eine lane, optional mit Grenzen für Wanduhr, Tokens und Kosten |
| `dori claim-done` und `dori object-done` | der 5-Minuten-Done-Flow |
| `dori close <key>` | schließt eine lane, deren `Done =`-Signale am lebenden Objekt nachgelesen sind |
| `dori sync` / `dori boot` | Registry gegen lebende Panes; die Nur-Lese-Prüfung nach einem Neustart |
| `dori freshness` / `dori dead-panes` / `dori guard` / `dori heavy` | anstoßen, erkennen, Hostlast beobachten, schwere Befehle begrenzen |
| `dori send` / `dori inbound` / `dori presence` / `dori transcribe` | die Messenger-Befehle von oben |
| `dori worklog` / `dori lesson` / `dori checkpoint` | Anfragen des leads, Lehren pro Repository, abgeschlossene Schritte |

`dori launch --dry-run` gibt den brief so aus, wie die lane ihn bekommt.

## Erweitern

Lifecycle-Hooks in `~/.dori/config.json` rufen bei einem Übergang dein eigenes Programm auf, als argv-Array mit `{key}`, `{text}`, `{evidence}`, `{repo}`, `{number}` und `{sha}`, pro Argument gefüllt und nie durch eine Shell:

| Hook | Feuert |
|---|---|
| `hooks.onReady` | eine lane endet mit Beleg |
| `hooks.onReport` | eine lane meldet |
| `hooks.onLost` | der Pane einer lane verschwindet |
| `hooks.reviewCommand` | ersetzt den eingebauten Reviewer |

Ein hängender Hook hält keinen Befehl offen: die CLI wartet höchstens zwei Sekunden auf noch laufende Hooks und sagt das auch. `DORI_PROMPTS_DIR` tauscht die vier Prompt-Dateien gegen deine, `DORI_AGENT_CMD` tauscht `omo` gegen ein anderes Agent-Binary, und `DORI_HOME` verschiebt das Zustandsverzeichnis.

## Im Container betreiben

[examples/container](examples/container) baut ein Ubuntu-Image mit gepinntem gh, node, bun, herdr, omo und Harness, einem `dori`-Service und benannten Volumes für jeden Teil des Zustands. Ein veröffentlichtes Image gibt es nicht: du baust es lokal und meldest dich einmal darin an. [docs/container.md](docs/container.md) beschreibt den Build, die Volumes, die einen Neustart überleben, und die Dimensionierung.

## Tests

```sh
bun run test        # 275 Tests in ./test/
bun run test:skill  # 308 Tests in skills/dori-mode/scripts
bun run ci          # Biome, tsc, knip, die 250-Zeilen-Ratsche, dann beide Suiten
```

Keine der beiden Suiten braucht ein Modell oder das Netz: das Harness läuft gegen ein Fake-herdr und ein Fake-`gh`, Dori mode gegen Fake-herdr, git und `gh`. Zwei End-to-End-Tests starten einen echten herdr-Server und überspringen sich selbst, wenn `herdr` nicht im PATH liegt.

## Telemetrie

`dori` sendet anonyme Nutzungszahlen so wie omo: OTLP/HTTP-JSON an `https://t.omo.dev`, mit einer zufälligen Installations-ID in `~/.dori/telemetry.json`, von der nur der sha256 rausgeht. Was die Maschine verlässt, sind Zählungen und feste Enums: installiert, täglich aktiv, lane gestartet, lane ready, Review abgeschlossen, Merge entschieden und eine stündliche duty-Zusammenfassung. Nie gesendet: Pfade, Repository-Namen, PR-Nummern, lane-Keys, briefs, Nachrichten oder sonstiger Text. Abschalten mit `DORI_TELEMETRY=0` (`DO_NOT_TRACK=1` wirkt auch), umleiten mit `DORI_TELEMETRY_ENDPOINT`. Telemetrie lässt nie einen Befehl scheitern.

## Mitmachen

Wer beiträgt, unterzeichnet einmal die [Contributor License Agreement](CLA.md), bevor ein Pull Request geprüft oder gemergt wird, mit einem Kommentar im Pull Request: `I have read the CLA Document and I hereby sign the CLA`. Gates, Testbefehle und die Regeln für Pull Requests stehen in [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

Das Projekt steht unter der [Sustainable Use License](LICENSE) in Version 1.0, Drittanbieter-Komponenten unter ihren eigenen Lizenzen. Sie deckt die interne Nutzung im eigenen Geschäftsbetrieb sowie nicht-kommerzielle oder persönliche Nutzung ab. Kommerzielle Nutzung braucht eine Lizenz vom Inhaber. Commits vor `ba96abf` behalten die MIT-Lizenz, unter der sie erschienen sind; die Änderung gilt ab diesem Commit. Die Prompts in `prompts/` sind die Anweisungen, die die Agenten wirklich bekommen, und sie sind kurz genug, um sie vor dem Vertrauen zu lesen.
