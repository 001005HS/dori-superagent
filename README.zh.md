# dori-superagent

**Dori 就住在你的聊天里。在 Slack、Telegram 或 Discord 里交代一件事，每个任务都会得到自己的编程 Agent 会话，并一路跟到合并为止。合并之前，必须在该 head 拿到 CLEAR 评审回执。**

[English](README.md) | [한국어](README.ko.md) | 简体中文 | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Italiano](README.it.md)

<p align="center">
  <img src="skills/dori-mode/assets/dori-avatar.png" alt="Dori" width="120">
</p>

Dori 是 [Sisyphus Labs](https://sisyphuslabs.ai) 的多会话编程 Agent harness。和你对话的只有一个 lead 会话。一个请求变成一条 lane：在独立 herdr 标签页里跑的一个 [omo](https://github.com/code-yeongyu/oh-my-openagent) 会话，配一份写好的 brief，证据在实机上读回之前不会关闭。duty 循环让沉默的 lane 继续动起来，合并门禁站在成果和 `main` 之间。

有两个程序都叫 `dori`，本仓库两个都发布。每台机器装一个，或者用 `bun src/cli.ts` 跑 harness，把 `dori` 留给 Dori mode。

| 组成 | 是什么 | 什么时候用它 |
|---|---|---|
| harness（`src/`、`prompts/`） | lead、lane、duty 循环、每小时循环、评审与合并门禁 | 想在一台机器上跑完整套循环 |
| Dori mode（`skills/dori-mode`） | 消息平台 CLI：发送、接收、在线状态、完成协议 | 想从聊天里跟它说话 |

## 你会得到什么

| 你会得到 | 含义 | 实现在哪 |
|---|---|---|
| 并行干活，而不是排队 | 每个任务开自己的标签页和 Agent 会话，可以同时跑好几个 | `dori start`、`src/lanes.ts` |
| 必须自证的完成 | lane 用 `dori ready --evidence <链接>` 收尾，lead 只有在该链接实机读回后才关闭它 | `src/lanes.ts` 里的 `ready()`、`prompts/lane-footer.md` |
| 会话不被打断 | 发给忙碌窗格的消息先排队，等窗格空闲后一次性送达 | `src/inbox.ts` |
| 沉默会被发现 | 10 分钟和 20 分钟各催一次，40 分钟上报给 lead | `src/duty.ts` 里的 `NUDGE_MINUTES` |
| 自己找下一件事 | 每小时循环从 backlog 取活，遵守 lane 数和主机上限，只把需要决策的事问你 | `src/loop.ts`、[docs/hourly-loop.md](docs/hourly-loop.md) |
| 状态只有一个地方 | 每个任务一条消息，就地编辑，不重复刷屏 | `skills/dori-mode/scripts/src/messenger/` 里的 `edit` |
| 只有一个声音 | lane 和 duty 会话都不直接跟你说话，一切都汇到 lead | `prompts/lead.md`、`prompts/duty.md` |
| 按你的写法回答 | 写出来的内容不用 emoji，句子短，用该话题的语言 | `skills/dori-mode/SKILL.md` |

![architecture](docs/architecture.png)

## 从聊天里跟它说话

本仓库实现了三个渠道。三者都能发帖、就地编辑、在话题里回复。

| 渠道 | 发送与编辑 | 接收 | 显示在线 | 需要设置 |
|---|---|---|---|---|
| Slack | 发帖、话题内回复、就地编辑 | 话题视图、你发过的话题、私信与提及 | 可以，仅限用户令牌 | `DORI_SLACK_TOKEN`，用户令牌还需 `DORI_SLACK_COOKIE` |
| Telegram | 发帖、回复论坛话题、就地编辑 | 主人私信、指定群的一个话题、编辑、媒体 file id | 机器人不适用 | `DORI_TELEGRAM_TOKEN`、`DORI_TELEGRAM_OWNER_ID`，可选 `DORI_TELEGRAM_GROUP_ID` 与 `DORI_TELEGRAM_TOPIC_ID` |
| Discord | 发帖、发到话题、就地编辑 | 本仓库未实现 | 可以，走 gateway 连接 | `DORI_DISCORD_TOKEN` |

### Slack

用户令牌以真实成员身份出现：需要付费席位，该成员能看到的内容它都能看到，`dori presence slack` 还能维持绿色在线点。机器人令牌不占席位，只看到被邀请的频道和授予的 scope，显示为应用。二选一并记下来，因为它决定了 onboarding 能读到什么。

```sh
export DORI_SLACK_TOKEN=xoxp-...
export DORI_SLACK_COOKIE=...          # `d` cookie，仅用户令牌需要

dori send slack --to C0123456789 --text "PR #12 已全绿" --thread 1712345678.123456
dori send slack --to C0123456789 --edit 1712345678.123456 --text "PR #12 已合并"
dori inbound slack --loop 1           # 每条新消息一行 INBOUND
dori presence slack                   # 用户令牌：保持在线显示
```

Dori 发起的话题下，即使没人 @ 也能收到。接收会读三个地方：Slack 的话题视图、Dori 发过言的每个话题（记录在 `<stateDir>/slack-threads.json`），以及未读的私信、群私信和提及。

### Telegram

```sh
export DORI_TELEGRAM_TOKEN=...
export DORI_TELEGRAM_OWNER_ID=123456789      # 只有这个账号算请求
export DORI_TELEGRAM_GROUP_ID=-1001234567890 # 可选：一个群
export DORI_TELEGRAM_TOPIC_ID=42             # 可选：群里的一个论坛话题

dori send telegram --to -1001234567890 --thread 42 --text "PR #12 已全绿"
dori inbound telegram --loop 1
```

接收有主人限制：配置的主人的私信一定通过；群里只有配置的话题通过；机器人消息永不通过。编辑会作为独立消息到达。语音、图片、文件会以携带 `file_id` 的一行到达，你把它交给 Telegram 的 `getFile`；下载好的音频再交给 `dori transcribe <文件>`，它通过 `hooks.transcribe` 转成文字。

### Discord

```sh
export DORI_DISCORD_TOKEN=...

dori send discord --to 123456789012345678 --text "PR #12 已全绿"
dori presence discord                 # 在 gateway 上保持在线
```

发送能用，包括发到你用 `--thread` 指定的话题。缺口在接收：`dori inbound` 只接受 `slack` 和 `telegram`，本仓库里的 Discord gateway 连接只做 identify 和心跳，不派发收到的消息。平台那一侧按 `references/setup.md` 装 agent-messenger，其余部分直接读各平台当前 API。

### 在库里，但不在命令上

每个消息模块都是可 import 的类型化类，能力比 CLI 暴露的更多：

- Slack 文件上传（先取上传 URL，再 complete）：`skills/dori-mode/scripts/src/messenger/slack.ts`
- Telegram 论坛话题（创建、改名、关闭、重开）、以 `Thinking…` 开头的草稿流式输出、HTML 表格：`skills/dori-mode/scripts/src/messenger/telegram.ts`
- Discord 话题创建、改名、归档：`skills/dori-mode/scripts/src/messenger/discord.ts`

完整模块清单在 [skills/dori-mode/references/scripts.md](skills/dori-mode/references/scripts.md)。

### 没有别的渠道

本仓库不支持 Teams、WhatsApp、LINE、WeChat、iMessage、KakaoTalk 或 Lark，`dori send` 会直接拒绝它不认识的渠道。Sisyphus Labs 的托管产品有更长的平台列表，但脚注和这份 README 一致：已发布的 Dori mode 覆盖 Telegram、Discord 和 Slack。

## 安装

需要 [Bun](https://bun.sh) 1.4.4 或更新、负责托管窗格的终端复用器 [herdr](https://herdr.dev)、跑在里面的编程 Agent [omo](https://github.com/code-yeongyu/oh-my-openagent)，以及用于评审、检查和合并的 GitHub CLI `gh`。

### harness

```sh
git clone https://github.com/sisyphuslabs/dori-superagent
cd dori-superagent
bun install
bun link        # 把 `dori` 放进 PATH；不做的话，把下面的 dori 换成 bun src/cli.ts
```

### Dori mode，消息平台 CLI

```sh
curl -fsSL https://raw.githubusercontent.com/sisyphuslabs/dori-superagent/main/install.sh | bash
```

它把仓库 clone 到 `~/.dori/src`，把技能链接到 `~/.agents/skills/dori-mode`，把 Dori mode 的 `dori` 放进 PATH，并把 `references/config.example.json` 复制成 `~/.dori/config.json`。然后编辑这个文件：至少填 `leadPane`（来自 `herdr pane current`）、`laneWorkspace` 和 `defaultCwd`。

## 快速开始

先启动 herdr 的服务端，再把 harness 拉起来：

```sh
dori up
# UP lead=w1:p1 duty=w1:p2 loop=w1:p3 hourly=w1:p4 home=~/.dori
```

会打开一个名为 `dori` 的 herdr 工作区，里面有 lead（一个 omo 会话，系统提示追加了 `prompts/lead.md`），下面挂着 duty 会话、duty 循环和每小时循环。跟 lead 说话。它会写一份 brief（目标、输入、交付物、停止条件、约束，见 [examples/brief.md](examples/brief.md)）并自己开 lane，你也可以从 shell 开：

```sh
dori start fix-flaky-login --brief examples/brief.md
# STARTED fix-flaky-login pane=w1:p5 brief=/Users/you/.dori/briefs/fix-flaky-login.md

dori status
# lead=w1:p1 duty=w1:p2 home=/Users/you/.dori
# fix-flaky-login         working  w1:p5    active 0m ago  start: examples/brief.md
```

lane 的 key 匹配 `^[a-z][a-z0-9-]{1,40}$`，已经打开的 key 会被拒绝。在 lane 内部，Agent 用 lane 规则给它的命令汇报和收尾：

```sh
dori report fix-flaky-login --text '已复现：20 次里 1 次失败，共享 session fixture'
dori report fix-flaky-login --status waiting --text 'WAITING: 等待 owner/repo#12 的检查'
dori ready fix-flaky-login --text '根因已修，检查全绿' --evidence https://github.com/owner/repo/pull/12
# READY fix-flaky-login
```

lead 在自己的窗格里读到 `[READY fix-flaky-login]`，然后自己跑门禁：

```sh
dori review owner/repo#12             # 固定在该 head 的新 omo 评审员，写出回执
dori merge owner/repo#12 --dry-run    # MERGE_OK owner/repo#12 head=<sha> (dry run)，或 MERGE_REFUSED <原因>
dori merge owner/repo#12              # gh pr merge --squash --match-head-commit <sha>
dori done fix-flaky-login             # 关掉 lane 的标签页；只有 READY 的 lane 能关
```

`dori send <lead|duty|key|pane> --text '...'` 会送达窗格，忙的时候先排队。省掉 `--text` 就从标准输入读。Agent 收到的命令会带上 `src/cli.ts` 的完整路径并设置 `DORI_HOME`，所以不依赖 PATH 上是哪个 `dori`。

## 怎么运作

![lane lifecycle](docs/lane-flow.png)

只有 lead 跟你说话。它把请求写成 brief，开一条 lane，读 lane 回来的东西，然后合并。

lane 是独立标签页里的一个 Agent 会话，用一份 brief 加上 lane 规则（`prompts/lane-footer.md`）启动。它用 `dori report` 报里程碑，用 `dori ready` 收尾，没有证据链接就出不去。lane 的一切都变成一行送到 lead：`[START]`、`[REPORT]`、`[READY]`、`[LOST]`、`[ESCALATE]`。

duty 循环是 `dori duty --interval 60`，一个跑在 duty 会话旁边的普通进程。每跳一次，它把排队的消息灌进已经空闲的窗格，催沉默的 lane，向 lead 上报，把窗格消失的 lane 标记为 lost。

每小时循环是 `dori loop`。每小时一次，它把 backlog 和现实对齐，审计遗漏的工作，启动下一件不需要任何人决策的事，把每个待答问题问一次，发一份报告。它从不合并、从不 push、从不关闭窗格。

状态是 `~/.dori`（或 `$DORI_HOME`）下的 JSON：`lanes/`、`inbox/`、`briefs/`、`receipts/`，加上每小时循环用的 `backlog/` 和 `loop/`，以及停止文件所在的 `duty/`。harness 额外加的常驻进程只有这两个循环，运行时依赖只有 Bun。

### 合并门禁

`dori merge` 用 `gh` 读 PR 的 head SHA，并给出具名理由拒绝：

| 拒绝理由 | 含义 |
|---|---|
| `no_receipt` | 这个 head 上没有 CLEAR 评审回执 |
| `review_block` | 这个 head 的回执是 BLOCK |
| `no_checks` | 检查列表是空的，空列表永远不算绿 |
| `checks_red` | 有检查失败 |
| `checks_all_skipped` | 所有检查都被跳过，等于什么都没通过 |

回执只由 `dori review` 写，别的都不写。它把 `prompts/review.md` 交给一个固定在 head 上的非交互 omo 运行，评审员没打出 `VERDICT:` 行就不写回执。评审之后再 push 会移动 head，旧回执随之失效。

`~/.dori/config.json` 里的 `hooks.reviewCommand` 可以用自己的命令替换内置评审员，它必须打出同样的 `VERDICT:` 行。

## 命令清单

harness，`src/cli.ts`：

| 命令 | 做什么 |
|---|---|
| `dori up [--cwd DIR]` | 打开 lead、duty、duty 循环和每小时循环的窗格 |
| `dori start <key> --brief FILE [--cwd DIR]` | 开一条 lane：新标签页、Agent 会话、brief 加 lane 规则 |
| `dori report <key> --text T [--status working\|waiting]` | lane 记录里程碑或等待 |
| `dori ready <key> --text T --evidence LINK` | lane 收尾，没有证据就拒绝 |
| `dori review <owner/repo#N> [--model M]` | 在该 head 起新评审员，写出回执 |
| `dori merge <owner/repo#N> [--dry-run]` | CLEAR 回执加全绿检查，然后 squash 合并 |
| `dori done <key>` | lead 关闭一条 READY 的 lane |
| `dori status` | 角色和所有打开的 lane |
| `dori duty [--once] \| stop \| resume \| status` | duty 循环及其停止开关 |
| `dori loop [--once] \| stop \| resume \| status` | 每小时循环及其停止开关 |
| `dori backlog add \| list \| decide \| drop \| import` | 每小时循环取活的队列 |
| `dori send <target> --text T` 与 `dori inbox list\|ack\|resend` | 投递、排队，以及处理被扣下的投递 |
| `dori role <lead\|duty> [PANE]` | 没用 `dori up` 时手工登记窗格 |

不带参数运行 `bun src/cli.ts` 会打出同样一份带全部参数的清单。

Dori mode，`skills/dori-mode/scripts/src/cli.ts`：

| 命令 | 做什么 |
|---|---|
| `dori launch <key> --title T --brief FILE --done "..."` | 开一条 lane，可加墙钟、token、成本上限 |
| `dori claim-done` 与 `dori object-done` | 5 分钟完成流程 |
| `dori close <key>` | 关闭 `Done =` 信号在实机读回确认过的 lane |
| `dori sync` / `dori boot` | 注册表和实机窗格对齐；重启后的只读检查 |
| `dori freshness` / `dori dead-panes` / `dori guard` / `dori heavy` | 催促、检测、看主机负载、限制重命令 |
| `dori send` / `dori inbound` / `dori presence` / `dori transcribe` | 上面那些消息平台命令 |
| `dori worklog` / `dori lesson` / `dori checkpoint` | 请求记录、按仓库的教训、已完成的步骤 |

`dori launch --dry-run` 会打出 lane 实际会收到的 brief。

## 扩展

`~/.dori/config.json` 里的生命周期钩子会在状态变化时调用你自己的程序。它以 argv 数组传递，`{key}`、`{text}`、`{evidence}`、`{repo}`、`{number}`、`{sha}` 逐个参数替换，从不经过 shell：

| 钩子 | 触发时机 |
|---|---|
| `hooks.onReady` | lane 带证据结束 |
| `hooks.onReport` | lane 汇报 |
| `hooks.onLost` | lane 的窗格消失 |
| `hooks.reviewCommand` | 替换内置评审员 |

卡住的钩子不会拖住命令：CLI 最多等还在跑的钩子两秒，然后如实说明。`DORI_PROMPTS_DIR` 把四个提示词换成你自己的，`DORI_AGENT_CMD` 把 `omo` 换成别的 Agent，`DORI_HOME` 移动状态目录。

## 在容器里运行

[examples/container](examples/container) 会构建一个固定了 gh、node、bun、herdr、omo 和 harness 的 Ubuntu 镜像，一个 `dori` 服务，以及覆盖全部状态的命名卷。没有公开镜像：你自己在本地构建，进去登录一次。[docs/container.md](docs/container.md) 讲构建、重启后仍保留的卷，以及容量规划。

## 测试

```sh
bun run test        # ./test/ 的 275 个测试
bun run test:skill  # skills/dori-mode/scripts 的 308 个测试
bun run ci          # Biome、tsc、knip、250 行棘轮，然后是两个测试套件
```

两个套件都不需要模型和网络：harness 跑在假的 herdr 和假的 `gh` 上，Dori mode 跑在假的 herdr、git 和 `gh` 上。两个端到端测试会启动真的 herdr 服务端，`herdr` 不在 PATH 时自行跳过。

## 遥测

`dori` 用和 omo 一样的方式发送匿名使用计数：OTLP/HTTP JSON 发到 `https://t.omo.dev`，安装 id 随机生成并存在 `~/.dori/telemetry.json`，只发送它的 sha256。离开机器的只有计数和固定枚举：安装、日活、lane 开始、lane ready、评审完成、合并判定，以及每小时一次的 duty 汇总。从不发送：路径、仓库名、PR 号、lane key、brief、消息或其他任何文本。用 `DORI_TELEMETRY=0` 关闭（`DO_NOT_TRACK=1` 也可以），用 `DORI_TELEMETRY_ENDPOINT` 改投别处。遥测从不会让命令失败。

## 许可

MIT，见 [LICENSE](LICENSE)。`prompts/` 里的提示词就是 Agent 实际收到的指令，短到可以在信任它们之前先读完。
