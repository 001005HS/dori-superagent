# dori-superharness-exp

約 660 行の TypeScript で書いた、複数セッションを能動的に回すコーディングエージェント用ハーネスです。[herdr](https://github.com/herdrdev/herdr) と [omo](https://github.com/code-yeongyu/oh-my-openagent) の上で動きます。

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | 日本語

人と話すのは lead セッションひとつだけです。タスクはそれぞれ lane として動きます。lane は自分の herdr タブで動く omo セッションひとつで、文書化された brief から始まり、証拠を必ず添えた READY で終わります。duty ループは静かになった lane を促し、lead にエスカレーションし、忙しい pane 宛てのメッセージは読めるようになるまで預かります。マージは、正確な head に対する CLEAR レビューの受領記録と緑のチェックを求めるゲートを通ります。

## なぜ作ったか

DeepSeek が [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) を公開し（最初のコミットは 2026-10-31）、その約一日後に記事 "Exploring Super-agent Design: Towards a More Autonomous Agent System" を出しました。設計はこうです。人とだけ話して仕事を振り分ける長命の Router セッション、ticket ごとにひとつの隔離された Worker セッション、ターンごとにまとめて届くイベントトリガー、そして watchdog。README には研究プロトタイプだと書かれていて、掲げている哲学は "take as little human attention as possible, and give as much value as possible" です。

同じ形を、私たちは約六か月、公開の場で動かしてきました。

- 2026-04-18: omo にチームモードが入りました。ターミナルの pane ごとにエージェントセッションひとつ、それぞれに worktree ひとつです（[f1268c0](https://github.com/code-yeongyu/oh-my-openagent/commit/f1268c0)、[e303fee](https://github.com/code-yeongyu/oh-my-openagent/commit/e303fee)）。
- 2026-05-06: Dori という名前が omo の README に載りました（[#3807](https://github.com/code-yeongyu/oh-my-openagent/pull/3807)）。
- 2026-10-07: このリポジトリが `omo-dori-mode-experimental` という名前で Dori モードを公開しました（[ce53e4d](https://github.com/sisyphuslabs/dori-superharness-exp/commit/ce53e4d)）。ひとつのエージェントが仕事ごとに herdr タブへ別のエージェントセッションを立てて任せ、仕事が終わってからだけ閉じます。git の履歴は公開されています。
- 2026-10-31: DeepSeek のプロトタイプの最初のコミット。
- 2026-11-01 ごろ: DeepSeek の記事。

これが私たちの毎日の働き方です。omo のスターは 7 万を超えています。2026-10-03 から 2026-11-02 までの 31 日間、[作者の GitHub コントリビューションカレンダー](https://github.com/code-yeongyu)には 38,656 件が記録されています。一日平均で約 1,250 件、ピークは 2026-10-16 の 2,227 件と 2026-10-29 の 2,001 件です。つまり一日最大で約 2,000 件のコントリビューションを、このセットアップのフル版が生んでいます。

このリポジトリのルートにあるハーネスは、その最小版です。herdr と omo だけで動くのに必要な部分だけがあり、他には何も付いていません。

## アーキテクチャ

![architecture](docs/architecture.png)

役割は三つで、それぞれ herdr の pane 内の omo セッションです。herdr がワークスペース、タブ、pane を用意し、pane 内の omo をエージェントとして認識し、その状態（idle、working、blocked、done）を CLI で報告します。dori は pane に何かする前に、まずその状態を読みます。

lead は人と話す唯一のセッションです。依頼を brief に書き起こし、`dori start` で lane を開き、lane が送り返してきたものを読み、マージします。

lane は自分の herdr タブ内の omo セッションひとつです。brief ひとつと、その後ろに付いた lane ルール（`prompts/lane-footer.md`）で始まります。`dori report` で途中経過を報告し、`dori ready` で終わりますが、`dori ready` は証拠リンクがないと拒否します。

duty ループは `dori duty --interval 60` で、duty omo セッションの隣の pane で動く普通のプロセスです。一回ごとに、idle になった pane へ溜まったメッセージを流し込み、静かな lane を促し、lead にエスカレーションし、pane が消えた lane を lost にします。

状態は `~/.dori`（または `$DORI_HOME`）配下の JSON ファイルです。`lanes/`、`inbox/`、`briefs/`、`receipts/`。ハーネスが足す常駐プロセスは duty ループだけで、ランタイム依存は Bun だけです。

![lane lifecycle](docs/lane-flow.png)

`dori start <key> --brief FILE` は brief と lane ルールを `~/.dori/briefs/<key>.md` に書き、タブを開き、`omo 'Read your brief at <path> and execute it. Your lane key is <key>.'` を実行し、lane を `working` として記録して lead に `[START <key>]` を送ります。そこから lane は報告し（`[REPORT <key>]`、自分の pane の外で止まっているときは `[REPORT <key> WAITING]`）、証拠リンクを添えた `[READY <key>]` で終えます。lead は証拠を確かめ、PR があれば `dori review` と `dori merge` を回し、`dori done <key>` で lane を閉じます。idle のままの lane には 10 分と 20 分で nudge が届き、40 分で lead にエスカレーションされます（`[ESCALATE <key>]`）。READY の前に pane が消えた lane は `[LOST <key>]` として報告されます。

## DeepSeek の super-agent との対応

| DeepSeek super-agent | dori | このリポジトリでは |
|---|---|---|
| Router セッション: 人と話し、仕事を振り分ける | LEAD セッション: 人と話す唯一のセッション。lane を開き、マージする | `prompts/lead.md`、`src/cli.ts` の `up()` |
| Worker セッション、ticket ごとにひとつ | LANE: タスクごとに omo セッションひとつ。自分の herdr タブと自分の brief を持つ | `src/harness.ts` の `startLane()`、`prompts/lane-footer.md` |
| Ticket + Mandate | brief ファイル + lane ルールのフッター、そして証拠が必須の READY | `~/.dori/briefs/<key>.md`、`src/harness.ts` の `ready()` |
| トリガーのバッチ処理: イベントをターンごとにまとめる | pane の inbox: 忙しい pane 宛てのメッセージはキューに入り、idle になると一括で届く | `src/harness.ts` の `send()`、`flushInbox()`。`src/store.ts` の `inbox/` |
| Watchdog | DUTY ループ: inbox を流し、10/20 分で nudge、40 分でエスカレーション、消えた pane を検知 | `src/harness.ts` の `dutyTick()`、`prompts/duty.md`、`prompts/nudge.md` |
| アドミッション行列、`maxWorkers`（デフォルト 3） | ここにはない。`dori start` が拒否するのは既に開いている key だけ | `src/harness.ts` の `startLane()` |
| プロトタイプにはない | ゲート付きマージ: 正確な head SHA に対する CLEAR レビュー受領記録と緑のチェック。空のチェック一覧は緑ではない | `src/harness.ts` の `review()`、`mergeGate()`、`prompts/review.md`、`src/store.ts` の `receipts/` |
| プロトタイプにはない | 一つの声のルール: lane と duty は人と話さない | `prompts/lead.md`、`prompts/duty.md`、`prompts/lane-footer.md` |
| プロトタイプにはない | 全文の回答台帳: lane ごとの最終回答、証拠リンク、ログをディスクに保存 | `src/store.ts` の `Lane.final`、`Lane.log` |

## クイックスタート

Bun 1.3 以上、herdr、omo、GitHub CLI の `gh`（PR の head SHA、チェック、マージに使います）が必要です。

```sh
git clone https://github.com/sisyphuslabs/dori-superharness-exp
cd dori-superharness-exp
bun install
bun link   # `dori` を PATH に載せます。以下の `dori` の代わりに `bun src/cli.ts` と書いても構いません
```

herdr を起動して、シェルから:

```sh
dori up
# UP lead=w1:p1 duty=w1:p2 loop=w1:p3 home=~/.dori
```

`dori` という herdr ワークスペースが開き、lead pane（system prompt に `prompts/lead.md` を追記した omo）、duty pane（`prompts/duty.md` を追記した omo）、その下に duty ループができます。lead pane に話しかけてください。lead は自分で brief（目標、入力、成果物、終了条件、制約。[`examples/brief.md`](examples/brief.md) を参照）を書いて lane を開きます。シェルから同じことをしても構いません。

```sh
dori start fix-flaky-login --brief examples/brief.md
# STARTED fix-flaky-login pane=w1:p4 brief=~/.dori/briefs/fix-flaky-login.md
dori status
# lead=w1:p1 duty=w1:p2 home=~/.dori
# fix-flaky-login          working  w1:p4    active 0m ago  start: examples/brief.md
```

lane の key は `^[a-z][a-z0-9-]{1,40}$` に合う必要があり、既に開いている key は拒否されます。

lane の中では、omo は lane ルールが渡したコマンドで報告し、終えます。

```sh
dori report fix-flaky-login --text 'reproduced: 1 failure in 20 runs, shared session fixture'
dori report fix-flaky-login --status waiting --text 'WAITING: checks on owner/repo#12'
dori ready fix-flaky-login --text 'root cause fixed in owner/repo#12, checks green' --evidence https://github.com/owner/repo/pull/12
```

lead は `[READY fix-flaky-login]` を受け取ったら:

```sh
dori review owner/repo#12            # head SHA に固定した新しい omo レビュアー。受領記録を書き、CLEAR なら exit 0
dori merge owner/repo#12 --dry-run   # MERGE_OK ...（dry run）、または MERGE_REFUSED <理由> と exit 2
dori merge owner/repo#12             # gh pr merge --squash --match-head-commit <sha>
dori done fix-flaky-login            # lane の pane を閉じます。閉じられるのは READY の lane だけ
```

`dori send <lead|duty|key|pane> --text '...'` は pane にメッセージを届け、pane が忙しければキューに入れます。`dori role <lead|duty> [PANE]` は `dori up` を使わなかったときに pane を手で登録します。`--text` を省くと stdin からメッセージを読みます。エージェントに見せるコマンドは `src/cli.ts` のフルパスと `DORI_HOME` を埋めた形で描き出されるので、エージェント側の PATH に `dori` がなくても構いません。環境変数: `DORI_HOME`（状態ディレクトリ、デフォルト `~/.dori`）、`DORI_AGENT_CMD`（デフォルト `omo`）、`DORI_HERDR_SESSION`（名前付きの herdr セッション）、`DORI_CMD`（エージェントに伝える dori の呼び出し方）。

## ハーネスが強制すること

声はひとつです。人と話すセッションは lead だけです（`prompts/lead.md`）。lane ルールは、人に向けた事実はすべて lead に送るよう定め（`prompts/lane-footer.md` の 3 番）、duty セッションはマージもせず人とも話しません（`prompts/duty.md`）。lane のすることはすべて prompt として lead pane に届きます。`[START]`、`[REPORT]`、`[READY]`、`[LOST]`、`[ESCALATE]`。

READY には証拠が要ります。`dori ready` は `--evidence` リンクがひとつもないか、最終回答のテキストがなければ拒否します（`src/harness.ts` の `ready()`）。テキストとリンクは lane レコードの `final` に保存され、`dori done` は `ready` でない lane を拒否するので、記録された回答なしに閉じる lane はありません。

忙しい pane は邪魔されません。`dori send` はまず herdr に pane のエージェント状態を尋ねます。`idle`、`done`、または素のシェルなら今届け、それ以外なら `~/.dori/inbox/` のキューに入れて `QUEUED` と表示します。duty ループは pane が idle になったときにキューをひとつのメッセージとして届け、その先頭は "N messages arrived while you were busy" です（`src/harness.ts` の `send()` と `flushInbox()`）。`dori done` も同じように待ちます。herdr が working か blocked と報告する pane は閉じません。

10 分、20 分、40 分で nudge します。`src/harness.ts` の `NUDGE_MINUTES = [10, 20, 40]` です。10 分間報告がなく、pane も working でない lane は、自分の pane に `prompts/nudge.md` を受け取ります。20 分でもう一度受け取ります。40 分で duty ループは nudge をやめ、lead に `[ESCALATE <key>]` を送ります。`working` の pane は idle の時計を戻し、`--status waiting` で報告した lane や pane が `blocked` の lane には触れず、新しい報告があれば nudge の回数は 0 に戻り、pane が消えれば `[LOST <key>]` として報告されます。

マージには正確な head の CLEAR 受領記録と緑のチェックが要ります。`dori merge` は `gh` で PR の head SHA を読み、その SHA に対する判定 `CLEAR` の受領記録が `~/.dori/receipts/` にあることを求めます。受領記録を書くのは `dori review` だけです。`dori review` はその SHA に固定した `prompts/review.md` で新しい非対話の omo（`omo -p --no-session`、必要なら `--model`）を回し、レビュアーが `VERDICT:` 行を出さなければ受領記録を書きません。次に `gh pr checks` がチェックをひとつ以上返し、すべてのチェックが `pass` か `skipping` で、そのうち少なくともひとつが `pass` でなければなりません。空のチェック一覧は "an empty check list is never green" として拒否されます。マージそのものは `gh pr merge --squash --match-head-commit <sha>` です。レビュー後に push すると head SHA が変わって受領記録が合わなくなるので、マージは拒否されます（`src/harness.ts` の `review()` と `mergeGate()`）。

## Dori モード（`skills/dori-mode`）

Dori モードはメッセンジャーに向いた半分で、2026-10-07 にこのリポジトリで公開されました。コーディングエージェントのセッションひとつを、メッセンジャー越しに話しかける常駐エージェントに変えます。そのセッションは仕事ごとに herdr タブへ別のエージェントセッションを立てて任せ、自分が立てたセッションをすべてレジストリに記録し、仕事が終わったと証明されてからだけ閉じます。証明になるのは、マージされた PR、閉じられた issue、公開されたバージョン、または自分で実行できるチェックです。スキル（`skills/dori-mode/SKILL.md` と `references/`）と、独自の Bun + TypeScript CLI として提供され、その CLI の名前も `dori` です。

```sh
curl -fsSL https://raw.githubusercontent.com/sisyphuslabs/dori-superharness-exp/main/install.sh | bash
```

このコマンドはこのリポジトリを `~/.dori/src` にクローンし、スキルを `~/.agents/skills/dori-mode` にリンクし、`bun link` で Dori モードの `dori` を PATH に載せ、設定例を `~/.dori/config.json` にコピーします。コマンド、設定、ルーティング、done プロトコルは [`skills/dori-mode/SKILL.md`](skills/dori-mode/SKILL.md) とその [`references/`](skills/dori-mode/references/) にあります。

ハーネスと Dori モードは、どちらも `dori` という名前のコマンドを提供します。一台のマシンにはどちらか一方だけをインストールするか、ハーネスを `bun src/cli.ts` で実行して `dori` は Dori モードに譲ってください。ハーネス自身の prompt は `src/cli.ts` のフルパスで自分を呼ぶので、ハーネスが立てたエージェントは PATH 上の `dori` がどちらかに左右されません。

## これは何ではないか

最小の実験です。ハーネスは Bun 上の TypeScript 約 660 行でランタイム依存はゼロ、私たちの本番スタックではありません。意図して外したもの: マシン間の mesh、heavy-slot のスケジューリング、チャットとチケット管理のブリッジ、テストスイート全体に対する受領記録。ここにあるのは herdr と omo だけで動く部分です。役割、lane、inbox、duty ループ、そしてレビューとマージのゲート。`skills/dori-mode` の Dori モードは、独自のメッセンジャー部品、ホストガード、heavy-slot ランナーを持つ別の CLI で、ハーネスはそこから何も import しません。

## テスト

リポジトリのルートで `bun test ./test/` を実行すると、ハーネスの 9 個のテストが走り、モデルは呼びません。素の `bun test` では Dori モードのテストも一緒に走ります。

8 個のユニットテスト（`test/harness.test.ts`）は偽の herdr（`test/fake.ts`）を相手に走ります。`herdr` と `gh` のバイナリの代わりになるレコーダーで、エージェント状態を設定できる pane を持ち、テストが進める時計を持っています。lane の開始と READY、忙しい lead のキューと一括配信、未知の宛先の拒否、10 分と 20 分の nudge と 40 分のエスカレーションと WAITING の lane の除外、working と lost の状態、マージゲートの全分岐（受領記録なし、BLOCK、空のチェック一覧、赤いチェック、全部スキップ、CLEAR と緑）、VERDICT 行のないレビュアーを扱います。

1 個のエンドツーエンドテスト（`test/e2e.test.ts`）は、隔離した名前付きセッションで本物の herdr サーバーを起動し、ワークスペースを作り、lead pane を登録し、omo の代わりに `test/fixtures/fake-agent.sh` をエージェントにした lane を開始します。このスクリプトは brief を読んで `dori report` と `dori ready` を呼び、テストは `[START]`、`[REPORT]`、`[READY]` が lead pane に届くこと、`dori done` が lane を閉じることを確かめます。PATH に `herdr` がなければスキップされます。`bun run typecheck` は `tsc --noEmit` を実行します。

Dori モードには、偽の herdr、git、gh を相手にした独自のテストが 68 個あります。

```sh
cd skills/dori-mode/scripts && bun install && bun test
```

## ライセンス

MIT。[LICENSE](LICENSE) を参照してください。
