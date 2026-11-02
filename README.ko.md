# dori-superharness-exp

약 660줄의 TypeScript로 만든, 여러 세션을 능동적으로 굴리는 코딩 에이전트 하네스입니다. [herdr](https://github.com/herdrdev/herdr)와 [omo](https://github.com/code-yeongyu/oh-my-openagent) 위에서 돌아갑니다.

[English](README.md) | 한국어 | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

사람과 대화하는 세션은 리드 하나뿐입니다. 작업은 하나하나 레인(lane)으로 돕니다. 레인은 자기 herdr 탭 안에서 돌아가는 omo 세션 하나로, 글로 적힌 브리프를 받아 시작하고 증거가 붙은 READY로 끝납니다. 듀티 루프는 조용해진 레인을 깨우고, 리드에게 올리고, 바쁜 pane에 갈 메시지는 읽을 수 있을 때까지 쥐고 있습니다. 머지는 정확한 head에서 받은 CLEAR 리뷰 영수증과 녹색 체크를 요구하는 게이트를 지나야 합니다.

## 왜 만들었나

DeepSeek이 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)을 공개했고(첫 커밋 2026-10-31), 하루쯤 뒤에 "Exploring Super-agent Design: Towards a More Autonomous Agent System"이라는 글을 냈습니다. 설계는 이렇습니다. 사람과만 대화하고 일을 나눠 주는 오래 사는 Router 세션, 티켓마다 하나씩 격리된 Worker 세션, 턴마다 묶어서 넣는 이벤트 트리거, 그리고 watchdog. README에는 리서치 프로토타입이라고 적혀 있고, 내건 철학은 "take as little human attention as possible, and give as much value as possible"입니다.

저희는 같은 모양을 여섯 달쯤 공개된 자리에서 돌려 왔습니다.

- 2026-04-18: omo에 팀 모드가 들어갔습니다. 터미널 pane마다 에이전트 세션 하나, 각자 worktree 하나입니다([f1268c0](https://github.com/code-yeongyu/oh-my-openagent/commit/f1268c0), [e303fee](https://github.com/code-yeongyu/oh-my-openagent/commit/e303fee)).
- 2026-05-06: Dori라는 이름이 omo README에 올라갔습니다([#3807](https://github.com/code-yeongyu/oh-my-openagent/pull/3807)).
- 2026-10-07: 이 저장소가 `omo-dori-mode-experimental`이라는 이름으로 Dori 모드를 공개했습니다([ce53e4d](https://github.com/sisyphuslabs/dori-superharness-exp/commit/ce53e4d)). 에이전트 하나가 일마다 herdr 탭에 에이전트 세션을 따로 띄워 맡기고, 일이 끝난 뒤에만 닫습니다. git 히스토리는 공개돼 있습니다.
- 2026-10-31: DeepSeek 프로토타입의 첫 커밋.
- 2026-11-01 무렵: DeepSeek의 글.

저희가 매일 일하는 방식이 이것입니다. omo는 star가 7만 개를 넘었습니다. 2026-10-03부터 2026-11-02까지 31일 동안 [작성자의 GitHub 기여 그래프](https://github.com/code-yeongyu)에는 38,656건이 찍혀 있습니다. 하루 평균 약 1,250건이고, 2026-10-16에 2,227건, 2026-10-29에 2,001건이 최고치입니다. 하루 최대 약 2,000건이고, 이 셋업의 풀 버전이 그 세션들을 굴립니다.

이 저장소 루트에 있는 하네스는 그중 최소 버전입니다. herdr와 omo만으로 돌아가는 데 필요한 부분만 있고, 다른 것은 붙어 있지 않습니다.

## 구조

![architecture](docs/architecture.png)

역할은 셋이고, 각각 herdr pane 안의 omo 세션입니다. herdr가 워크스페이스, 탭, pane을 만들고, pane 안의 omo를 에이전트로 알아보고, 그 상태(idle, working, blocked, done)를 CLI로 알려 줍니다. dori는 pane에 무엇을 하기 전에 먼저 그 상태를 읽습니다.

리드는 사람과 대화하는 유일한 세션입니다. 요청을 브리프로 옮기고, `dori start`로 레인을 열고, 레인이 보내는 것을 읽고, 머지합니다.

레인은 자기 herdr 탭 안의 omo 세션 하나입니다. 브리프 하나와 그 뒤에 붙은 레인 규칙(`prompts/lane-footer.md`)으로 시작합니다. `dori report`로 중간 결과를 보고하고 `dori ready`로 끝내는데, `dori ready`는 증거 링크가 없으면 거절합니다.

듀티 루프는 `dori duty --interval 60`입니다. 듀티 omo 세션 옆 pane에서 도는 평범한 프로세스입니다. 틱마다 idle이 된 pane에 쌓인 메시지를 넣고, 조용한 레인을 깨우고, 리드에게 올리고, pane이 사라진 레인을 lost로 표시합니다.

상태는 `~/.dori`(또는 `$DORI_HOME`) 아래 JSON 파일입니다. `lanes/`, `inbox/`, `briefs/`, `receipts/`. 하네스가 더하는 상주 프로세스는 듀티 루프 하나이고, 런타임 의존성은 Bun 말고 없습니다.

![lane lifecycle](docs/lane-flow.png)

`dori start <key> --brief FILE`은 브리프와 레인 규칙을 `~/.dori/briefs/<key>.md`에 쓰고, 탭을 열고, `omo 'Read your brief at <path> and execute it. Your lane key is <key>.'`를 실행하고, 레인을 `working`으로 기록한 뒤 리드에게 `[START <key>]`를 보냅니다. 그 뒤로 레인은 보고하고(`[REPORT <key>]`, 자기 pane 밖의 무언가에 막혔으면 `[REPORT <key> WAITING]`), 증거 링크를 붙인 `[READY <key>]`로 끝냅니다. 리드는 증거를 확인하고, PR이 있으면 `dori review`와 `dori merge`를 돌리고, `dori done <key>`로 레인을 닫습니다. 레인이 가만히 있으면 10분과 20분에 nudge가 가고 40분에 리드로 올라갑니다(`[ESCALATE <key>]`). READY 전에 pane이 사라지면 `[LOST <key>]`로 보고됩니다.

## DeepSeek super-agent와의 대응

| DeepSeek super-agent | dori | 이 저장소에서 |
|---|---|---|
| Router 세션: 사람과 대화하고 일을 나눠 줌 | LEAD 세션: 사람과 대화하는 유일한 세션. 레인을 열고 머지함 | `prompts/lead.md`, `src/cli.ts`의 `up()` |
| Worker 세션, 티켓마다 하나 | LANE: 작업마다 omo 세션 하나, 자기 herdr 탭과 자기 브리프 | `src/harness.ts`의 `startLane()`, `prompts/lane-footer.md` |
| Ticket + Mandate | 브리프 파일 + 레인 규칙 푸터, 그리고 증거가 꼭 붙어야 하는 READY | `~/.dori/briefs/<key>.md`, `src/harness.ts`의 `ready()` |
| 트리거 배칭: 이벤트를 턴마다 묶음 | pane 인박스: 바쁜 pane에 보낸 메시지는 큐에 들어가고, idle이 되면 한 묶음으로 도착 | `src/harness.ts`의 `send()`, `flushInbox()`; `src/store.ts`의 `inbox/` |
| Watchdog | DUTY 루프: 인박스를 비우고, 10/20분에 nudge, 40분에 에스컬레이션, 사라진 pane 감지 | `src/harness.ts`의 `dutyTick()`, `prompts/duty.md`, `prompts/nudge.md` |
| Admission matrix, `maxWorkers`(기본 3) | 없음. `dori start`는 이미 열린 키만 거절함 | `src/harness.ts`의 `startLane()` |
| 프로토타입에 없음 | 게이트 머지: 정확한 head SHA의 CLEAR 리뷰 영수증 + 녹색 체크. 빈 체크 목록은 녹색이 아님 | `src/harness.ts`의 `review()`, `mergeGate()`, `prompts/review.md`, `src/store.ts`의 `receipts/` |
| 프로토타입에 없음 | 한 목소리 규칙: 레인과 듀티는 사람과 대화하지 않음 | `prompts/lead.md`, `prompts/duty.md`, `prompts/lane-footer.md` |
| 프로토타입에 없음 | 전문 답변 장부: 레인마다 최종 답변, 증거 링크, 로그를 디스크에 보관 | `src/store.ts`의 `Lane.final`, `Lane.log` |

## 빠른 시작

Bun 1.3 이상, herdr, omo, GitHub CLI `gh`가 필요합니다. `gh`는 PR의 head SHA, 체크, 머지에 씁니다.

```sh
git clone https://github.com/sisyphuslabs/dori-superharness-exp
cd dori-superharness-exp
bun install
bun link   # `dori`를 PATH에 올립니다. 아래의 `dori` 자리에 `bun src/cli.ts`를 써도 됩니다
```

herdr를 켜고, 셸에서:

```sh
dori up
# UP lead=w1:p1 duty=w1:p2 loop=w1:p3 home=~/.dori
```

`dori`라는 herdr 워크스페이스가 열리고 pane 셋이 생깁니다. 리드 pane(시스템 프롬프트 뒤에 `prompts/lead.md`를 붙인 omo), 듀티 pane(`prompts/duty.md`를 붙인 omo), 그 아래 듀티 루프입니다. 리드 pane에 말을 걸면 리드가 브리프(목표, 입력, 산출물, 종료 조건, 제약. [`examples/brief.md`](examples/brief.md) 참고)를 쓰고 레인을 엽니다. 셸에서 직접 열어도 됩니다.

```sh
dori start fix-flaky-login --brief examples/brief.md
# STARTED fix-flaky-login pane=w1:p4 brief=~/.dori/briefs/fix-flaky-login.md
dori status
# lead=w1:p1 duty=w1:p2 home=~/.dori
# fix-flaky-login          working  w1:p4    active 0m ago  start: examples/brief.md
```

레인 키는 `^[a-z][a-z0-9-]{1,40}$`에 맞아야 하고, 이미 열린 키는 거절됩니다.

레인 안에서 omo는 레인 규칙이 알려 준 명령으로 보고하고 끝냅니다.

```sh
dori report fix-flaky-login --text 'reproduced: 1 failure in 20 runs, shared session fixture'
dori report fix-flaky-login --status waiting --text 'WAITING: checks on owner/repo#12'
dori ready fix-flaky-login --text 'root cause fixed in owner/repo#12, checks green' --evidence https://github.com/owner/repo/pull/12
```

리드는 `[READY fix-flaky-login]`을 받으면:

```sh
dori review owner/repo#12            # head SHA에 고정된 새 omo 리뷰어. 영수증을 쓰고, CLEAR면 exit 0
dori merge owner/repo#12 --dry-run   # MERGE_OK ... (dry run), 아니면 MERGE_REFUSED <이유>와 exit 2
dori merge owner/repo#12             # gh pr merge --squash --match-head-commit <sha>
dori done fix-flaky-login            # 레인의 pane을 닫습니다. READY인 레인만 닫힙니다
```

`dori send <lead|duty|key|pane> --text '...'`는 pane에 메시지를 전달하고, pane이 바쁘면 큐에 넣습니다. `dori role <lead|duty> [PANE]`은 `dori up`을 쓰지 않았을 때 pane을 직접 등록합니다. `--text`를 빼면 stdin에서 읽습니다. 에이전트에게 주는 명령은 `src/cli.ts`의 전체 경로와 `DORI_HOME`이 채워진 채로 렌더링되므로, 에이전트 쪽 PATH에 `dori`가 없어도 됩니다. 환경 변수: `DORI_HOME`(상태 디렉터리, 기본 `~/.dori`), `DORI_AGENT_CMD`(기본 `omo`), `DORI_HERDR_SESSION`(이름 붙인 herdr 세션), `DORI_CMD`(에이전트에게 알려 줄 dori 호출 명령).

## 하네스가 강제하는 것

목소리는 하나입니다. 사람과 대화하는 세션은 리드뿐입니다(`prompts/lead.md`). 레인 규칙은 사람에게 갈 사실은 모두 리드로 보내라고 하고(`prompts/lane-footer.md` 3번), 듀티 세션은 머지도 하지 않고 사람과 대화도 하지 않습니다(`prompts/duty.md`). 레인이 하는 일은 모두 리드 pane에 프롬프트로 도착합니다. `[START]`, `[REPORT]`, `[READY]`, `[LOST]`, `[ESCALATE]`.

READY에는 증거가 있어야 합니다. `dori ready`는 `--evidence` 링크가 하나도 없거나 최종 답변 텍스트가 없으면 거절합니다(`src/harness.ts`의 `ready()`). 텍스트와 링크는 레인 레코드의 `final`에 저장되고, `dori done`은 `ready`가 아닌 레인을 거절하므로, 기록된 답변 없이 닫히는 레인은 없습니다.

바쁜 pane은 방해받지 않습니다. `dori send`는 먼저 herdr에 pane의 에이전트 상태를 묻습니다. `idle`, `done`, 또는 그냥 셸이면 지금 전달하고, 그 밖의 상태면 `~/.dori/inbox/`에 큐로 넣고 `QUEUED`를 출력합니다. 듀티 루프는 pane이 idle이 되면 큐를 한 메시지로 전달하는데, 그 메시지는 "N messages arrived while you were busy"로 시작합니다(`src/harness.ts`의 `send()`와 `flushInbox()`). `dori done`도 같은 식으로 기다립니다. herdr가 working이나 blocked라고 알려 주는 pane은 닫지 않습니다.

10분, 20분, 40분에 nudge합니다. `src/harness.ts`의 `NUDGE_MINUTES = [10, 20, 40]`입니다. 10분 동안 보고가 없고 pane도 working이 아닌 레인은 자기 pane에서 `prompts/nudge.md`를 받습니다. 20분에 한 번 더 받습니다. 40분이 되면 듀티 루프는 nudge를 멈추고 리드에게 `[ESCALATE <key>]`를 보냅니다. `working` pane은 idle 시계를 되돌리고, `--status waiting`으로 보고한 레인이나 pane이 `blocked`인 레인은 건드리지 않고, 새 보고가 오면 nudge 횟수가 0으로 돌아가고, pane이 사라지면 `[LOST <key>]`로 보고됩니다.

머지에는 정확한 head의 CLEAR 영수증과 녹색 체크가 필요합니다. `dori merge`는 `gh`로 PR의 head SHA를 읽고, 그 SHA에 대한 `CLEAR` 영수증이 `~/.dori/receipts/`에 있어야 넘어갑니다. 영수증은 `dori review`만 씁니다. `dori review`는 그 SHA에 고정된 `prompts/review.md`로 새 비대화형 omo(`omo -p --no-session`, 필요하면 `--model`)를 돌리고, 리뷰어가 `VERDICT:` 줄을 출력하지 않으면 영수증을 쓰지 않습니다. 그다음 `gh pr checks`가 체크를 하나 이상 돌려줘야 하고, 모든 체크가 `pass`나 `skipping`이어야 하고, 그중 하나 이상은 `pass`여야 합니다. 빈 체크 목록은 "an empty check list is never green"으로 거절됩니다. 머지 자체는 `gh pr merge --squash --match-head-commit <sha>`입니다. 리뷰 뒤에 push하면 head SHA가 바뀌어 영수증이 맞지 않으므로 머지가 거절됩니다(`src/harness.ts`의 `review()`와 `mergeGate()`).

## Dori 모드 (`skills/dori-mode`)

Dori 모드는 메신저를 마주보는 반쪽으로, 2026-10-07에 이 저장소에서 공개됐습니다. 코딩 에이전트 세션 하나를 메신저로 말을 거는, 늘 켜져 있는 에이전트로 바꿉니다. 그 세션은 일마다 herdr 탭에 에이전트 세션을 따로 띄워 맡기고, 자기가 띄운 세션을 모두 레지스트리에 기록하고, 일이 끝났다는 것이 증명된 뒤에만 닫습니다. 머지된 PR, 닫힌 이슈, 배포된 버전, 또는 스스로 돌려 볼 수 있는 체크가 그 증명입니다. 스킬(`skills/dori-mode/SKILL.md`와 `references/`)과 자체 Bun + TypeScript CLI로 구성되고, CLI 이름도 `dori`입니다.

```sh
curl -fsSL https://raw.githubusercontent.com/sisyphuslabs/dori-superharness-exp/main/install.sh | bash
```

이 명령은 저장소를 `~/.dori/src`에 받고, 스킬을 `~/.agents/skills/dori-mode`에 링크하고, `bun link`로 Dori 모드의 `dori`를 PATH에 올리고, 예시 설정을 `~/.dori/config.json`에 복사합니다. 명령, 설정, 라우팅, done 프로토콜은 [`skills/dori-mode/SKILL.md`](skills/dori-mode/SKILL.md)와 그 [`references/`](skills/dori-mode/references/)에 있습니다.

하네스와 Dori 모드는 둘 다 `dori`라는 명령을 내놓습니다. 한 머신에는 하나만 설치하거나, 하네스를 `bun src/cli.ts`로 실행하고 `dori`는 Dori 모드에 맡기면 됩니다. 하네스의 프롬프트는 `src/cli.ts`의 전체 경로로 자기 명령을 부르므로, 하네스가 띄운 에이전트는 PATH의 `dori`가 어느 쪽인지에 영향을 받지 않습니다.

## 이것이 아닌 것

최소 실험입니다. 하네스는 Bun 위의 TypeScript 약 660줄이고 런타임 의존성이 없으며, 저희의 프로덕션 스택은 아닙니다. 일부러 뺀 것은 머신 간 메시, heavy-slot 스케줄링, 채팅과 티켓 트래커 브리지, 테스트 스위트 전체에 대한 영수증입니다. 여기 있는 것은 herdr와 omo만으로 돌아가는 부분입니다. 역할, 레인, 인박스, 듀티 루프, 그리고 리뷰와 머지 게이트. `skills/dori-mode`의 Dori 모드는 자체 메신저 기능, 호스트 가드, heavy-slot 러너를 가진 별개의 CLI이고, 하네스는 거기서 아무것도 import하지 않습니다.

## 테스트

저장소 루트에서 `bun test ./test/`를 실행하면 하네스의 테스트 9개가 돌고, 모델은 호출하지 않습니다. 그냥 `bun test`를 치면 Dori 모드의 테스트까지 함께 돕니다.

단위 테스트 8개(`test/harness.test.ts`)는 가짜 herdr(`test/fake.ts`)를 상대로 돕니다. `herdr`와 `gh` 바이너리를 대신하는 레코더로, 에이전트 상태를 바꿀 수 있는 pane들을 들고 있고, 테스트가 움직이는 시계가 있습니다. 레인 시작과 READY, 바쁜 리드의 큐와 묶음 전달, 알 수 없는 대상 거절, 10분과 20분의 nudge와 40분의 에스컬레이션과 WAITING 레인 제외, working과 lost 상태, 머지 게이트의 모든 분기(영수증 없음, BLOCK, 빈 체크 목록, 빨간 체크, 전부 skip, CLEAR + 녹색), VERDICT 줄이 없는 리뷰어를 다룹니다.

엔드투엔드 테스트 1개(`test/e2e.test.ts`)는 격리된 이름의 세션에서 진짜 herdr 서버를 띄우고, 워크스페이스를 만들고, 리드 pane을 등록하고, omo 대신 `test/fixtures/fake-agent.sh`를 에이전트로 쓰는 레인을 시작합니다. 그 스크립트는 브리프를 읽고 `dori report`와 `dori ready`를 호출하고, 테스트는 `[START]`, `[REPORT]`, `[READY]`가 리드 pane에 도착하는지와 `dori done`이 레인을 닫는지 확인합니다. `herdr`가 PATH에 없으면 건너뜁니다. `bun run typecheck`는 `tsc --noEmit`을 돌립니다.

Dori 모드에는 가짜 herdr, git, gh를 상대로 하는 자체 테스트 68개가 있습니다.

```sh
cd skills/dori-mode/scripts && bun install && bun test
```

## 라이선스

MIT, [LICENSE](LICENSE)를 보세요.
