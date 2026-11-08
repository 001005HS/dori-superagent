# dori-superagent

**Dori는 당신의 채팅 안에 있습니다. Slack, Telegram, Discord에서 시키면 일마다 전용 코딩 에이전트 세션이 열리고, 머지까지 추적합니다. 머지 전에는 그 head에 대한 CLEAR 리뷰가 반드시 있어야 합니다.**

[English](README.md) | 한국어 | [简体中文](README.zh.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Italiano](README.it.md)

<p align="center">
  <img src="skills/dori-mode/assets/dori-avatar.png" alt="Dori" width="120">
</p>

Dori는 [Sisyphus Labs](https://sisyphuslabs.ai)가 만든 멀티 세션 코딩 에이전트 하네스입니다. 사용자와 이야기하는 세션은 리드 하나입니다. 요청 하나가 레인 하나가 됩니다. 레인은 herdr 탭 하나에서 도는 [omo](https://github.com/code-yeongyu/oh-my-openagent) 세션과 그 세션에 건네는 브리프이고, 증거를 실물에서 다시 읽기 전까지 닫히지 않습니다. 듀티 루프가 조용해진 레인을 계속 움직이고, 머지 게이트가 작업물과 `main` 사이에 서 있습니다.

`dori`라는 이름의 프로그램이 둘이고, 이 저장소는 둘 다 배포합니다. 머신마다 하나를 설치하거나, 하네스를 `bun src/cli.ts`로 돌리고 `dori`는 Dori mode에 맡기면 됩니다.

| 구성 | 무엇인가 | 언제 쓰나 |
|---|---|---|
| 하네스 (`src/`, `prompts/`) | 리드, 레인, 듀티 루프, 매시간 루프, 리뷰와 머지 게이트 | 한 머신에서 전체 루프를 돌리고 싶을 때 |
| Dori mode (`skills/dori-mode`) | 메신저 CLI: 보내기, 받기, 프레즌스, 완료 프로토콜 | 채팅에서 말을 걸고 싶을 때 |

## 무엇을 얻나

| 얻는 것 | 뜻 | 구현 위치 |
|---|---|---|
| 대기열이 아니라 병렬 작업 | 일마다 전용 탭과 전용 에이전트 세션이 열리고, 여러 개가 동시에 돕니다 | `dori start`, `src/lanes.ts` |
| 스스로 증명해야 하는 완료 | 레인은 `dori ready --evidence <링크>`로 끝나고, 리드는 그 링크를 실물에서 읽은 뒤에야 닫습니다 | `src/lanes.ts`의 `ready()`, `prompts/lane-footer.md` |
| 끊기지 않는 세션 | 작업 중인 pane에 보낸 메시지는 쌓였다가 pane이 idle이 되면 한 묶음으로 도착합니다 | `src/inbox.ts` |
| 침묵을 알아챔 | 10분과 20분에 재촉하고, 40분에 리드로 올립니다 | `src/duty.ts`의 `NUDGE_MINUTES` |
| 다음 일을 스스로 찾음 | 매시간 루프가 백로그에서 꺼내고, 레인 수와 호스트 한도를 지키고, 사람에게는 결정만 묻습니다 | `src/loop.ts`, [docs/hourly-loop.md](docs/hourly-loop.md) |
| 상태가 한곳에 남음 | 일마다 메시지 하나를, 다시 올리지 않고 그 자리에서 고칩니다 | `skills/dori-mode/scripts/src/messenger/`의 `edit` |
| 목소리는 하나 | 레인과 듀티 세션은 사용자에게 말하지 않고, 모든 것이 리드로 모입니다 | `prompts/lead.md`, `prompts/duty.md` |
| 사용자가 쓰는 방식으로 답함 | 쓰는 글에는 이모지를 쓰지 않고, 짧게, 그 스레드의 언어로 답합니다 | `skills/dori-mode/SKILL.md` |

![architecture](docs/architecture.png)

## 채팅에서 말 걸기

이 저장소가 구현한 채널은 셋입니다. 셋 다 글을 올리고, 그 자리에서 고치고, 스레드로 답합니다.

| 채널 | 보내기와 수정 | 받기 | 온라인 표시 | 설정하는 것 |
|---|---|---|---|---|
| Slack | 글 올리기, 스레드 답글, 그 자리에서 수정 | 스레드 뷰, 내가 올린 스레드, DM과 멘션 | 가능, 사용자 토큰일 때 | `DORI_SLACK_TOKEN`, 사용자 토큰이면 `DORI_SLACK_COOKIE`도 |
| Telegram | 글 올리기, 포럼 토픽에 답글, 그 자리에서 수정 | 주인 DM, 지정한 그룹의 토픽 하나, 수정, 미디어 file id | 봇에는 해당 없음 | `DORI_TELEGRAM_TOKEN`, `DORI_TELEGRAM_OWNER_ID`, 선택으로 `DORI_TELEGRAM_GROUP_ID`와 `DORI_TELEGRAM_TOPIC_ID` |
| Discord | 글 올리기, 스레드에 올리기, 그 자리에서 수정 | 이 저장소에는 없음 | 가능, gateway 연결 | `DORI_DISCORD_TOKEN` |

### Slack

사용자 토큰은 실제 멤버로 행동합니다. 유료 seat이 필요하고, 그 멤버가 보는 것은 다 보이고, `dori presence slack`으로 초록 점을 유지할 수 있습니다. 봇 토큰은 seat 비용이 없고, 초대받은 채널과 허용된 scope만 보이고, 앱으로 표시됩니다. 하나를 골라 기록해 두십시오. 이 선택이 온보딩에서 읽을 수 있는 범위를 정합니다.

```sh
export DORI_SLACK_TOKEN=xoxp-...
export DORI_SLACK_COOKIE=...          # `d` 쿠키, 사용자 토큰일 때만

dori send slack --to C0123456789 --text "PR #12 초록" --thread 1712345678.123456
dori send slack --to C0123456789 --edit 1712345678.123456 --text "PR #12 머지됨"
dori inbound slack --loop 1           # 새 메시지마다 INBOUND 한 줄
dori presence slack                   # 사용자 토큰: 온라인 표시 유지
```

Dori가 연 스레드에 멘션 없이 달린 답글도 도착합니다. 받기는 세 곳을 읽습니다. Slack의 스레드 뷰, Dori가 글을 올린 모든 스레드(`<stateDir>/slack-threads.json`에 기록), 그리고 읽지 않은 DM과 그룹 DM, 멘션입니다.

### Telegram

```sh
export DORI_TELEGRAM_TOKEN=...
export DORI_TELEGRAM_OWNER_ID=123456789      # 이 계정의 메시지만 요청입니다
export DORI_TELEGRAM_GROUP_ID=-1001234567890 # 선택: 그룹 하나
export DORI_TELEGRAM_TOPIC_ID=42             # 선택: 그 안의 포럼 토픽 하나

dori send telegram --to -1001234567890 --thread 42 --text "PR #12 초록"
dori inbound telegram --loop 1
```

받기는 주인으로 제한됩니다. 설정한 주인의 DM은 항상 통과하고, 그룹에서는 설정한 토픽만 통과하며, 봇 메시지는 절대 통과하지 않습니다. 수정은 별도 메시지로 도착합니다. 음성, 사진, 문서는 `file_id`를 담은 줄로 도착하니 Telegram의 `getFile`에 넘기면 됩니다. 내려받은 오디오는 `dori transcribe <파일>`이 `hooks.transcribe`를 거쳐 텍스트로 바꿉니다.

### Discord

```sh
export DORI_DISCORD_TOKEN=...

dori send discord --to 123456789012345678 --text "PR #12 초록"
dori presence discord                 # gateway에서 온라인 표시 유지
```

보내기는 됩니다. `--thread`로 넘긴 스레드에 올리는 것도 됩니다. 비어 있는 쪽은 받기입니다. `dori inbound`는 `slack`과 `telegram`만 받고, 이 저장소의 Discord gateway 연결은 identify와 heartbeat만 하며 들어온 메시지를 전달하지 않습니다. 플랫폼 쪽은 `references/setup.md`를 따라 Dori가 agent-messenger를 설치하고, 나머지는 해당 플랫폼의 현재 API를 직접 읽습니다.

### 라이브러리에는 있고 명령에는 없는 것

메신저 모듈은 import해서 쓰는 타입 지정 클래스이고, CLI가 드러내는 것보다 더 합니다.

- Slack 파일 업로드(업로드 URL을 받고 완료): `skills/dori-mode/scripts/src/messenger/slack.ts`
- Telegram 포럼 토픽(생성, 이름 변경, 닫기, 다시 열기), `Thinking…`으로 시작하는 드래프트 스트리밍, HTML 표: `skills/dori-mode/scripts/src/messenger/telegram.ts`
- Discord 스레드 생성, 이름 변경, 보관: `skills/dori-mode/scripts/src/messenger/discord.ts`

모듈 전체 목록은 [skills/dori-mode/references/scripts.md](skills/dori-mode/references/scripts.md)에 있습니다.

### 다른 채널은 없습니다

이 저장소에는 Teams, WhatsApp, LINE, WeChat, iMessage, KakaoTalk, Lark 지원이 없고, `dori send`는 모르는 채널을 거부합니다. Sisyphus Labs의 호스팅 제품에는 더 넓은 플랫폼 목록이 있지만, 이 README가 그대로 옮기는 각주도 같습니다. 배포되는 Dori mode가 다루는 것은 Telegram, Discord, Slack 셋입니다.

## 설치

[Bun](https://bun.sh) 1.4.4 이상, pane을 호스팅하는 터미널 멀티플렉서 [herdr](https://herdr.dev), 그 안에서 도는 코딩 에이전트 [omo](https://github.com/code-yeongyu/oh-my-openagent), 그리고 리뷰와 체크와 머지에 쓰는 GitHub CLI `gh`가 필요합니다.

### 하네스

```sh
git clone https://github.com/sisyphuslabs/dori-superagent
cd dori-superagent
bun install
bun link        # `dori`를 PATH에 올립니다. 하지 않으면 아래 예시의 `dori`를 `bun src/cli.ts`로 바꿔 쓰십시오
```

### Dori mode, 메신저 CLI

```sh
curl -fsSL https://raw.githubusercontent.com/sisyphuslabs/dori-superagent/main/install.sh | bash
```

이 스크립트는 저장소를 `~/.dori/src`에 클론하고, 스킬을 `~/.agents/skills/dori-mode`에 링크하고, Dori mode의 `dori`를 PATH에 올리고, `references/config.example.json`을 `~/.dori/config.json`으로 복사합니다. 그다음 그 파일을 고치십시오. 최소한 `leadPane`(`herdr pane current` 값), `laneWorkspace`, `defaultCwd`가 필요합니다.

## 빠른 시작

herdr와 hc를 둘 다 설치했다면 `~/.dori/config.json`에 `{ "runtime": "hc" }`(또는 `"herdr"`)를 넣어 런타임을 한 번 골라 두십시오(아래 예시는 herdr 표기이고, hc에서는 `hc:t1`처럼 찍힙니다).

herdr 서버를 켠 뒤 하네스를 올립니다.

```sh
dori up
# UP lead=w1:p1 duty=w1:p2 loop=w1:p3 hourly=w1:p4 home=~/.dori
```

`dori`라는 이름의 herdr 워크스페이스가 열리고, 그 안에 리드(omo 세션이고 시스템 프롬프트에 `prompts/lead.md`가 덧붙습니다)가, 그 아래에 듀티 세션과 듀티 루프, 매시간 루프가 놓입니다. 리드에게 말을 거십시오. 리드는 브리프(목표, 입력, 산출물, 정지 조건, 제약. [examples/brief.md](examples/brief.md) 참고)를 쓰고 레인을 직접 엽니다. 셸에서 열어도 됩니다.

```sh
dori start fix-flaky-login --brief examples/brief.md
# STARTED fix-flaky-login pane=w1:p5 brief=/Users/you/.dori/briefs/fix-flaky-login.md

dori status
# lead=w1:p1 duty=w1:p2 home=/Users/you/.dori
# fix-flaky-login         working  w1:p5    active 0m ago  start: examples/brief.md
```

레인 키는 `^[a-z][a-z0-9-]{1,40}$`와 맞아야 하고, 이미 열린 키는 거부됩니다. 레인 안에서 에이전트는 레인 규칙이 건네는 명령으로 보고하고 끝냅니다.

```sh
dori report fix-flaky-login --text '재현: 20회 중 1회 실패, 공유 세션 fixture'
dori report fix-flaky-login --status waiting --text 'WAITING: owner/repo#12 체크 대기'
dori ready fix-flaky-login --text '원인 수정, 체크 초록' --evidence https://github.com/owner/repo/pull/12
# READY fix-flaky-login
```

리드는 pane에서 `[READY fix-flaky-login]`을 읽고 게이트를 직접 돌립니다.

```sh
dori review owner/repo#12             # head에 고정한 새 omo 리뷰어, 영수증을 씁니다
dori merge owner/repo#12 --dry-run    # MERGE_OK owner/repo#12 head=<sha> (dry run) 또는 MERGE_REFUSED <이유>
dori merge owner/repo#12              # gh pr merge --squash --match-head-commit <sha>
dori done fix-flaky-login             # 레인의 탭을 닫습니다. READY 레인만 닫을 수 있습니다
```

`dori send <lead|duty|key|pane> --text '...'`는 pane으로 보내고, 바쁘면 쌓아 둡니다. `--text`를 빼면 표준입력에서 읽습니다. 에이전트가 받는 명령에는 `src/cli.ts`의 전체 경로가 붙고 `DORI_HOME`이 설정되므로, PATH에 있는 `dori`가 어느 쪽이든 상관없습니다.

## 동작 방식

![lane lifecycle](docs/lane-flow.png)

사용자와 이야기하는 세션은 리드뿐입니다. 리드는 요청을 브리프로 만들고, 레인을 열고, 레인이 보내온 것을 읽고, 머지합니다.

레인은 전용 탭의 에이전트 세션 하나이고, 브리프 하나와 레인 규칙(`prompts/lane-footer.md`)을 덧붙여 시작합니다. 진행은 `dori report`로 보고하고, 마지막은 `dori ready`로 끝냅니다. 증거 링크가 없으면 `dori ready`는 나가지 않습니다. 레인이 한 일은 모두 한 줄이 되어 리드에 도착합니다. `[START]`, `[REPORT]`, `[READY]`, `[LOST]`, `[ESCALATE]`입니다.

듀티 루프는 `dori duty --interval 60`이고, 듀티 세션 옆에서 도는 평범한 프로세스입니다. tick마다 idle이 된 pane에 쌓인 메시지를 풀고, 조용한 레인을 재촉하고, 리드로 올리고, pane이 사라진 레인을 lost로 표시합니다.

매시간 루프는 `dori loop`입니다. 한 시간에 한 번 백로그를 현실과 맞추고, 놓친 일을 점검하고, 아무 결정도 필요 없는 다음 항목을 시작하고, 열린 질문을 한 번씩 묻고, 보고를 하나 보냅니다. 머지하지 않고, push하지 않고, pane을 닫지 않습니다.

상태는 `~/.dori`(또는 `$DORI_HOME`) 아래 JSON입니다. `lanes/`, `inbox/`, `briefs/`, `receipts/`가 있고, 매시간 루프용 `backlog/`와 `loop/`, 정지 파일용 `duty/`가 있습니다. 하네스가 더하는 상주 프로세스는 이 두 루프뿐이고, 런타임 의존성은 Bun 하나뿐입니다.

### 머지 게이트

`dori merge`는 `gh`로 PR의 head SHA를 읽고, 이유를 이름으로 밝혀 거부합니다.

| 거부 | 뜻 |
|---|---|
| `no_receipt` | 이 head에 대한 CLEAR 리뷰 영수증이 없음 |
| `review_block` | 이 head의 영수증이 BLOCK |
| `no_checks` | 체크가 하나도 없음. 빈 목록은 초록이 아님 |
| `checks_red` | 실패한 체크가 있음 |
| `checks_all_skipped` | 모든 체크가 건너뛰어져 아무것도 통과하지 못함 |

영수증은 `dori review`만 씁니다. head에 고정한 `prompts/review.md`를 비대화형 omo로 돌리고, `VERDICT:` 줄을 내지 않는 리뷰어는 영수증을 남기지 않습니다. 리뷰 뒤에 push하면 head가 움직이므로 예전 영수증은 효력이 없습니다.

`~/.dori/config.json`의 `hooks.reviewCommand`로 내장 리뷰어를 직접 만든 명령으로 바꿀 수 있습니다. 같은 `VERDICT:` 줄을 내야 합니다.

## 런타임

세션은 herdr에서도, hc([herdr-core](https://releases.herdr.dev/core/install.sh))에서도 돌고, 한 홈 안에 두 런타임의 세션이 같이 있어도 됩니다. 하네스는 `src/runtime/`의 인터페이스 하나로 둘을 다룹니다. 저장된 레인과 역할은 자기를 연 런타임을 기억하기 때문에, 지금 어느 런타임이 선택돼 있든 그 세션에 대한 명령은 원래 런타임으로 갑니다. 런타임이 생기기 전에 쓰인 레인 기록은 herdr로 읽습니다. 동사 하나하나의 대응표를 포함한 전체 설계는 [`docs/runtime.md`](docs/runtime.md)에 있습니다.

새 세션은 `DORI_RUNTIME`이 가리키는 런타임에 열립니다. 이 값이 없으면 `$DORI_HOME/config.json`(기본값 `~/.dori/config.json`, Dori mode가 읽는 바로 그 파일)의 `"runtime": "herdr"` 또는 `"runtime": "hc"`를 따릅니다. 둘 다 없으면 Dori가 알아냅니다. hc 터미널 안(`HC_TERMINAL_ID`)이면 hc, herdr pane 안(`HERDR_PANE_ID`)이면 herdr, 그 밖에는 PATH에 있는 바이너리 하나를 씁니다. 바이너리가 둘 다 있거나 하나도 없으면 고치는 방법을 한 줄로 알려 주고 거절합니다. 짐작으로 고르면 아무도 보지 않는 곳에 세션이 열리기 때문입니다. `dori status`는 첫 줄에 `RUNTIME hc (from config)`처럼 선택 결과를 찍습니다.

hc에는 워크스페이스도 탭도 없습니다. Dori는 세션마다 터미널을 하나 열고 라벨을 붙입니다. `dori.group`(`DORI_HOME` 경로로 만든 16진수 8자), `dori.role`, `dori.name`, 레인이면 `dori.lane`까지입니다. 한 홈의 세션 목록은 `hc ls --label dori.group=<g>`로 보고, 세션 하나는 `hc attach <t>`로 엽니다.

hc에서 상태는 에이전트가 직접 보내는 OSC 7501 보고로만 알 수 있고, 최근 omo 빌드는 이 보고를 보냅니다. 한 번도 보고하지 않는 에이전트는 `unknown`으로 남고, 그 에이전트에게 가는 메시지는 inbox에서 기다립니다. `~/.config/herdr-core/config.toml`에 `notes = false`를 넣어 두십시오. 그래야 hc가 부모 에이전트에 스스로 무언가를 입력하지 않습니다. 듀티 루프는 어느 런타임에서든 홈마다 하나만 돕니다(`duty/lock`).

대상에는 `herdr:w1:p3`, `hc:t7`, 접두사 없는 `w1:p3`, `lead`, `duty`, 레인 키를 씁니다. 접두사 없는 `t7`은 레인 키로 읽고, hc 터미널로는 읽지 않습니다.

`dori migrate`는 세션을 다른 런타임으로 옮깁니다.

```sh
dori migrate --to hc --all --dry-run       # PLAN 줄만 찍고 아무것도 바꾸지 않음
dori migrate --to hc --lane fix-flaky-login
dori migrate --to herdr --role duty-loop
```

에이전트 세션이면 레인을 붙잡아 두고, 에이전트에게 인계 체크포인트를 쓰게 하고, 인계 브리프(원래 브리프, 체크포인트, 로그 끝부분, 마지막 화면 줄, 쌓인 메시지)를 만들고, 그 브리프로 새 세션을 엽니다. 새 세션이 idle이나 working을 보고하면 inbox를 옮기고(held 항목은 그대로 held), 기록을 새 세션으로 바꾸고, 옛 세션을 닫습니다. 세션마다 결과 한 줄이 나옵니다. `MIGRATED`, `SKIP`, `DEFERRED`(에이전트가 blocked였거나, `--wait-minutes`(기본 10분)가 지나도 working이었음), 그리고 `MIGRATE_ROLLBACK`입니다. 롤백은 새 세션을 닫고 inbox를 되돌린 뒤 3으로 끝납니다. `--resume`을 주면 브리프 대신 에이전트가 쓰던 세션 파일을 다시 엽니다. 옛 세션이 살아 있고, idle이나 done이고, 세션 경로가 기록돼 있을 때만 받아 줍니다.

지원하지 않는 것은 다른 머신의 세션(hc의 `--on`)과 hc의 창 배치입니다. Windows의 hc는 여기서 시험해 보지 않았습니다.

## 명령 목록

하네스, `src/cli.ts`입니다.

| 명령 | 하는 일 |
|---|---|
| `dori up [--cwd DIR]` | 리드, 듀티, 듀티 루프, 매시간 루프 pane을 엽니다 |
| `dori start <key> --brief FILE [--cwd DIR]` | 레인을 엽니다. 새 탭, 에이전트 세션, 브리프와 레인 규칙 |
| `dori report <key> --text T [--status working\|waiting]` | 레인이 진행 상황이나 대기를 기록합니다 |
| `dori ready <key> --text T --evidence LINK` | 레인이 끝납니다. 증거가 없으면 거부합니다 |
| `dori review <owner/repo#N> [--model M]` | 그 head에서 새 리뷰어를 돌려 영수증을 씁니다 |
| `dori merge <owner/repo#N> [--dry-run]` | CLEAR 영수증과 초록 체크를 확인한 뒤 squash 머지 |
| `dori done <key>` | 리드가 READY 레인을 닫습니다 |
| `dori status` | 역할과 열린 레인 전부 |
| `dori duty [--once] \| stop \| resume \| status` | 듀티 루프와 정지 스위치 |
| `dori loop [--once] \| stop \| resume \| status` | 매시간 루프와 정지 스위치 |
| `dori backlog add \| list \| decide \| drop \| import` | 매시간 루프가 꺼내는 대기열 |
| `dori send <target> --text T`와 `dori inbox list\|ack\|resend` | 전달, 대기, 보류된 전달의 처리 |
| `dori role <lead\|duty> [PANE]` | `dori up`을 쓰지 않았을 때 pane을 등록합니다 |

인자 없이 `bun src/cli.ts`를 실행하면 모든 플래그가 붙은 같은 목록이 나옵니다.

Dori mode, `skills/dori-mode/scripts/src/cli.ts`입니다.

| 명령 | 하는 일 |
|---|---|
| `dori launch <key> --title T --brief FILE --done "..."` | 레인을 엽니다. 실행 시간, 토큰, 비용 상한을 선택으로 붙입니다 |
| `dori claim-done`과 `dori object-done` | 5분 완료 흐름 |
| `dori close <key>` | `Done =` 신호를 실물에서 읽어 확인한 레인을 닫습니다 |
| `dori sync` / `dori boot` | 레지스트리와 실제 pane의 대조, 재시작 뒤의 읽기 전용 점검 |
| `dori freshness` / `dori dead-panes` / `dori guard` / `dori heavy` | 재촉, 감지, 호스트 부하 감시, 무거운 명령 제한 |
| `dori send` / `dori inbound` / `dori presence` / `dori transcribe` | 위의 메신저 명령 |
| `dori worklog` / `dori lesson` / `dori checkpoint` | 요청 기록, 저장소별 교훈, 완료한 단계 |

`dori launch --dry-run`은 레인이 받을 그대로의 브리프를 출력합니다.

## 확장하기

`~/.dori/config.json`의 라이프사이클 훅은 상태가 바뀔 때 직접 만든 프로그램을 부릅니다. argv 배열로 넘기고 `{key}`, `{text}`, `{evidence}`, `{repo}`, `{number}`, `{sha}`가 인자마다 채워지며, 셸을 거치지 않습니다.

| 훅 | 발생 시점 |
|---|---|
| `hooks.onReady` | 레인이 증거와 함께 끝났을 때 |
| `hooks.onReport` | 레인이 보고했을 때 |
| `hooks.onLost` | 레인의 pane이 사라졌을 때 |
| `hooks.reviewCommand` | 내장 리뷰어를 대체 |

멈춘 훅이 명령을 붙잡지는 못합니다. CLI는 아직 도는 훅을 최대 2초 기다리고 그렇다고 알립니다. `DORI_PROMPTS_DIR`로 프롬프트 파일 넷을 내 것으로 바꾸고, `DORI_AGENT_CMD`로 `omo`를 다른 에이전트로 바꾸고, `DORI_HOME`으로 상태 디렉터리를 옮깁니다.

## 컨테이너에서 실행하기

[examples/container](examples/container)는 gh, node, bun, herdr, omo, 하네스를 버전 고정으로 넣은 Ubuntu 이미지와 `dori` 서비스 하나, 상태 전부를 담는 이름 있는 볼륨을 만듭니다. 공개 이미지는 없습니다. 직접 빌드하고 그 안에서 한 번 로그인하십시오. [docs/container.md](docs/container.md)에 빌드, 재시작해도 남는 볼륨, 크기 산정이 있습니다.

## 테스트

```sh
bun run test        # ./test/의 275개 테스트
bun run test:skill  # skills/dori-mode/scripts의 308개 테스트
bun run ci          # Biome, tsc, knip, 250줄 래칫, 그다음 두 스위트
```

두 스위트 모두 모델도 네트워크도 쓰지 않습니다. 하네스는 가짜 herdr과 가짜 `gh`에, Dori mode는 가짜 herdr, git, `gh`에 대고 돕니다. 엔드투엔드 테스트 둘은 진짜 herdr 서버를 띄우고, `herdr`가 PATH에 없으면 스스로 건너뜁니다.

hc를 다루는 엔드투엔드 테스트도 둘 있습니다. `test/e2e-hc.test.ts`는 자기만의 `HC_SESSION`과 XDG 폴더로 진짜 hc 코어를 띄우고 omo 대신 OSC 7501을 보고하는 픽스처 에이전트를 쓰며, `test/e2e-migrate.test.ts`는 레인을 herdr에서 hc로 옮깁니다. 바이너리가 PATH에 없으면 각각 건너뜁니다.

## 텔레메트리

`dori`는 omo와 같은 방식으로 익명 사용량을 보냅니다. `https://t.omo.dev`로 OTLP/HTTP JSON을 보내고, `~/.dori/telemetry.json`에 둔 무작위 설치 id의 sha256만 내보냅니다. 기계를 떠나는 것은 개수와 고정된 enum입니다. 설치, 일간 활성, 레인 시작, 레인 ready, 리뷰 완료, 머지 판정, 한 시간에 한 번의 듀티 요약입니다. 경로, 저장소 이름, PR 번호, 레인 키, 브리프, 메시지나 그 밖의 텍스트는 보내지 않습니다. `DORI_TELEMETRY=0`으로 끄고(`DO_NOT_TRACK=1`도 됩니다), `DORI_TELEMETRY_ENDPOINT`로 보낼 곳을 바꿉니다. 텔레메트리 때문에 명령이 실패하는 일은 없습니다.

## 기여

기여자는 리뷰나 머지 전에 [기여자 라이선스 계약](CLA.md)에 한 번 서명합니다. 풀 리퀘스트에 `I have read the CLA Document and I hereby sign the CLA` 라고 댓글을 남기면 됩니다. 게이트, 테스트 명령, 풀 리퀘스트 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.

## 라이선스

이 프로젝트는 [Sustainable Use License](LICENSE) 1.0으로 제공되고, 서드파티 구성 요소는 각자의 라이선스를 따릅니다. 자기 사업의 내부 사용과 비상업적 사용이나 개인적 사용을 덮습니다. 상업적 사용에는 소유자의 라이선스가 필요합니다. `ba96abf` 이전 커밋은 배포 당시의 MIT 라이선스를 유지하고, 이 변경은 그 커밋부터 적용됩니다. `prompts/`의 프롬프트는 에이전트가 실제로 받는 지시이고, 믿기 전에 다 읽을 수 있을 만큼 짧습니다.
