# dori-superagent

**Dori はあなたのチャットの中にいます。Slack、Telegram、Discord のどこからでも仕事を伝えると、ジョブごとに専用のコーディングエージェントセッションが立ち、マージまで追跡されます。マージの前には、その head に対する CLEAR レビューが必須です。**

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh.md) | 日本語 | [Deutsch](README.de.md) | [Italiano](README.it.md)

<p align="center">
  <img src="skills/dori-mode/assets/dori-avatar.png" alt="Dori" width="120">
</p>

Dori は [Sisyphus Labs](https://sisyphuslabs.ai) のマルチセッション向けコーディングエージェント harness です。あなたと話すのは lead セッション一つだけです。依頼は lane になり、lane とは専用の herdr タブで動く [omo](https://github.com/code-yeongyu/oh-my-openagent) セッション一つと、そのための brief です。証拠が実物で確認できるまで lane は閉じません。duty ループが静かになった lane を動かし続け、マージゲートが成果物と `main` の間に立ちます。

`dori` という名前のプログラムは二つあり、このリポジトリはその両方を配布しています。マシンごとにどちらか一つをインストールするか、harness を `bun src/cli.ts` で動かして `dori` は Dori mode に任せてください。

| 構成要素 | 中身 | 使う場面 |
|---|---|---|
| harness (`src/`、`prompts/`) | lead、lane、duty ループ、毎時のループ、レビューとマージゲート | 一つのマシンで全体を回したい |
| Dori mode (`skills/dori-mode`) | メッセンジャー用 CLI: 送信、受信、プレゼンス、完了プロトコル | チャットから話しかけたい |

## 得られるもの

| 得られるもの | 意味 | 実装場所 |
|---|---|---|
| 待ち行列ではなく並列作業 | ジョブごとに専用タブと専用エージェントセッションが開き、同時にいくつでも走る | `dori start`、`src/lanes.ts` |
| 証拠がなければ done にならない | lane は `dori ready --evidence <リンク>` で終わり、lead はそのリンクが実物で確認できてから閉じる | `src/lanes.ts` の `ready()`、`prompts/lane-footer.md` |
| セッションを中断させない | 作業中のペイン宛てのメッセージは溜められ、ペインが idle になったときにまとめて届く | `src/inbox.ts` |
| 沈黙に気づく | 10 分と 20 分で催促し、40 分で lead へエスカレーション | `src/duty.ts` の `NUDGE_MINUTES` |
| 次の仕事を自分で見つける | 毎時のループが backlog から取り出し、lane 数とホストの制限を守り、人には判断だけを聞く | `src/loop.ts`、[docs/hourly-loop.md](docs/hourly-loop.md) |
| 状況が一箇所に残る | ジョブごとにメッセージ一つを、投稿し直さずその場で編集する | `skills/dori-mode/scripts/src/messenger/` の `edit` |
| 声は一つ | lane と duty セッションはあなたに話しかけず、すべて lead に集まる | `prompts/lead.md`、`prompts/duty.md` |
| あなたの書き方で返す | 書くものに絵文字は使わず、短く、そのスレッドの言語で返します | `skills/dori-mode/SKILL.md` |

![architecture](docs/architecture.png)

## チャットから話しかける

このリポジトリが実装しているチャネルは三つです。どれも投稿、その場での編集、スレッド返信ができます。

| チャネル | 送信と編集 | 受信 | オンライン表示 | 設定するもの |
|---|---|---|---|---|
| Slack | 投稿、スレッド返信、その場で編集 | スレッドビュー、自分が投稿したスレッド、DM とメンション | 可（ユーザートークンのみ） | `DORI_SLACK_TOKEN`、ユーザートークンなら `DORI_SLACK_COOKIE` も |
| Telegram | 投稿、フォーラムトピックへの返信、その場で編集 | オーナーの DM、指定したグループの一トピック、編集、メディアの file id | bot には該当なし | `DORI_TELEGRAM_TOKEN`、`DORI_TELEGRAM_OWNER_ID`、任意で `DORI_TELEGRAM_GROUP_ID` と `DORI_TELEGRAM_TOPIC_ID` |
| Discord | 投稿、スレッドへの投稿、その場で編集 | このリポジトリには未実装 | 可（gateway 接続） | `DORI_DISCORD_TOKEN` |

### Slack

ユーザートークンは実在のメンバーとして振る舞います。有料シートが必要で、そのメンバーが見えるものはすべて見え、`dori presence slack` で緑のドットを保てます。bot トークンはシート不要で、招待されたチャネルと付与されたスコープだけが見え、アプリとして表示されます。どちらかを選んで記録してください。オンボーディングで何を読めるかがこれで決まります。

```sh
export DORI_SLACK_TOKEN=xoxp-...
export DORI_SLACK_COOKIE=...          # `d` クッキー。ユーザートークンのときだけ

dori send slack --to C0123456789 --text "PR #12 はグリーン" --thread 1712345678.123456
dori send slack --to C0123456789 --edit 1712345678.123456 --text "PR #12 マージ済み"
dori inbound slack --loop 1           # 新着ごとに 1 行の INBOUND
dori presence slack                   # ユーザートークン: オンライン表示を保つ
```

Dori が立てたスレッドへの、メンションの付かない返信も届きます。受信は Slack のスレッドビュー、Dori が投稿したすべてのスレッド（`<stateDir>/slack-threads.json` に記録）、そして未読の DM、グループ DM、メンションを読みます。

### Telegram

```sh
export DORI_TELEGRAM_TOKEN=...
export DORI_TELEGRAM_OWNER_ID=123456789      # 依頼として扱うのはこのアカウントだけ
export DORI_TELEGRAM_GROUP_ID=-1001234567890 # 任意: グループを一つ
export DORI_TELEGRAM_TOPIC_ID=42             # 任意: その中のフォーラムトピックを一つ

dori send telegram --to -1001234567890 --thread 42 --text "PR #12 はグリーン"
dori inbound telegram --loop 1
```

受信はオーナー限定です。設定したオーナーからの DM は必ず通り、グループでは設定したトピックだけが通り、bot の発言は決して通りません。編集は独立したメッセージとして届きます。ボイスメモ、写真、ドキュメントは `file_id` を含む行として届くので、それを Telegram の `getFile` に渡します。ダウンロードした音声は `dori transcribe <ファイル>` が `hooks.transcribe` 経由でテキストにします。

### Discord

```sh
export DORI_DISCORD_TOKEN=...

dori send discord --to 123456789012345678 --text "PR #12 はグリーン"
dori presence discord                 # gateway 上でオンライン表示を保つ
```

送信は動きます。`--thread` で渡したスレッドへの投稿も含みます。受信が欠けています。`dori inbound` が受け付けるのは `slack` と `telegram` だけで、このリポジトリの Discord gateway 接続は identify と heartbeat を行いますが、受信メッセージを配送しません。プラットフォーム側は `references/setup.md` の手順で agent-messenger を入れ、残りは各プラットフォームの現行 API を直接読んでください。

### コマンドには出ていないがライブラリにあるもの

メッセンジャーの各モジュールは import できる型付きクラスで、CLI が出している以上のことができます。

- Slack のファイルアップロード（アップロード URL を取ってから complete）: `skills/dori-mode/scripts/src/messenger/slack.ts`
- Telegram のフォーラムトピック（作成、改名、閉鎖、再開）、`Thinking…` から始めるドラフトストリーミング、HTML の表: `skills/dori-mode/scripts/src/messenger/telegram.ts`
- Discord のスレッド作成、改名、アーカイブ: `skills/dori-mode/scripts/src/messenger/discord.ts`

モジュールの一覧は [skills/dori-mode/references/scripts.md](skills/dori-mode/references/scripts.md) にあります。

### 他のチャネルはない

このリポジトリに Teams、WhatsApp、LINE、WeChat、iMessage、KakaoTalk、Lark の対応はなく、`dori send` は知らないチャネルを拒否します。Sisyphus Labs のホスト版プロダクトにはもっと広いプラットフォーム一覧がありますが、この README が引き継ぐ注記も同じです。出荷されている Dori mode が対応するのは Telegram、Discord、Slack の三つです。

## インストール

必要なものは [Bun](https://bun.sh) 1.4.4 以降、ペインをホストする端末マルチプレクサの [herdr](https://herdr.dev)、その中で走るコーディングエージェントの [omo](https://github.com/code-yeongyu/oh-my-openagent)、そしてレビュー、チェック、マージに使う GitHub CLI の `gh` です。

### harness

```sh
git clone https://github.com/sisyphuslabs/dori-superagent
cd dori-superagent
bun install
bun link        # `dori` を PATH に置く。入れない場合は下の例を `bun src/cli.ts` に読み替える
```

### Dori mode（メッセンジャー CLI）

```sh
curl -fsSL https://raw.githubusercontent.com/sisyphuslabs/dori-superagent/main/install.sh | bash
```

このスクリプトはリポジトリを `~/.dori/src` に clone し、スキルを `~/.agents/skills/dori-mode` にリンクし、Dori mode の `dori` を PATH に置き、`references/config.example.json` を `~/.dori/config.json` にコピーします。そのあと設定ファイルを編集してください。少なくとも `leadPane`（`herdr pane current` の値）、`laneWorkspace`、`defaultCwd` が必要です。

## クイックスタート

herdr のサーバーを起動してから、harness を立ち上げます。

```sh
dori up
# UP lead=w1:p1 duty=w1:p2 loop=w1:p3 hourly=w1:p4 home=~/.dori
```

`dori` という名前の herdr ワークスペースが開き、lead（`prompts/lead.md` をシステムプロンプトに追記した omo セッション）と、その下に duty セッション、duty ループ、毎時のループが並びます。lead に話しかけてください。lead は brief（目的、入力、成果物、停止条件、制約。[examples/brief.md](examples/brief.md) 参照）を書き、自分で lane を開きます。シェルから開くこともできます。

```sh
dori start fix-flaky-login --brief examples/brief.md
# STARTED fix-flaky-login pane=w1:p5 brief=/Users/you/.dori/briefs/fix-flaky-login.md

dori status
# lead=w1:p1 duty=w1:p2 home=/Users/you/.dori
# fix-flaky-login         working  w1:p5    active 0m ago  start: examples/brief.md
```

lane のキーは `^[a-z][a-z0-9-]{1,40}$` に一致し、すでに開いているキーは拒否されます。lane の中では、lane のルールが渡すコマンドで報告し、終わります。

```sh
dori report fix-flaky-login --text '再現: 20 回中 1 回失敗、共有セッションフィクスチャ'
dori report fix-flaky-login --status waiting --text 'WAITING: owner/repo#12 のチェック待ち'
dori ready fix-flaky-login --text '原因を修正、チェックはグリーン' --evidence https://github.com/owner/repo/pull/12
# READY fix-flaky-login
```

lead はペインで `[READY fix-flaky-login]` を読み、自分でゲートを回します。

```sh
dori review owner/repo#12             # head に固定した新しい omo レビュアー。receipt を書く
dori merge owner/repo#12 --dry-run    # MERGE_OK owner/repo#12 head=<sha> (dry run)、または MERGE_REFUSED <理由>
dori merge owner/repo#12              # gh pr merge --squash --match-head-commit <sha>
dori done fix-flaky-login             # lane のタブを閉じる。READY の lane だけが閉じられる
```

`dori send <lead|duty|key|pane> --text '...'` はペインへ届けるか、忙しければ溜めます。`--text` を省くと標準入力から読みます。エージェントが受け取るコマンドは `src/cli.ts` の絶対パスと `DORI_HOME` を設定した形で描画されるので、PATH 上の `dori` がどちらでも動きます。

## 仕組み

![lane lifecycle](docs/lane-flow.png)

あなたと話すのは lead だけです。lead は依頼を brief にし、lane を開き、lane からの報告を読み、マージします。

lane は専用タブのエージェントセッション一つで、brief 一つと lane のルール（`prompts/lane-footer.md`）を追記して起動します。区切りは `dori report` で報告し、最後は `dori ready` で終わります。証拠のリンクがなければ `dori ready` は通りません。lane の行動はすべて一行になって lead に届きます。`[START]`、`[REPORT]`、`[READY]`、`[LOST]`、`[ESCALATE]` です。

duty ループは `dori duty --interval 60` で、duty セッションの隣で動く普通のプロセスです。tick ごとに、idle になったペインへ溜まったメッセージを流し、黙った lane を催促し、lead にエスカレーションし、ペインが消えた lane を lost として記録します。

毎時のループは `dori loop` です。一時間ごとに backlog を現実と突き合わせ、見落としを監査し、誰の判断も要らない次の項目を開始し、開いている問いを一度だけ聞き、報告を一つ送ります。マージも push もペインの閉鎖もしません。

状態は `~/.dori`（または `$DORI_HOME`）配下の JSON です。`lanes/`、`inbox/`、`briefs/`、`receipts/`、そして毎時のループ用の `backlog/` と `loop/`、停止ファイル用の `duty/` があります。harness が追加する常駐プロセスはこの二つのループだけで、実行時の依存は Bun だけです。

### マージゲート

`dori merge` は `gh` で PR の head SHA を読み、理由を名指しして拒否します。

| 拒否 | 意味 |
|---|---|
| `no_receipt` | この head に対する CLEAR のレビュー receipt がない |
| `review_block` | この head の receipt が BLOCK |
| `no_checks` | チェックが一つもない。空のリストはグリーンにならない |
| `checks_red` | 失敗したチェックがある |
| `checks_all_skipped` | すべてのチェックが skip され、何も通っていない |

receipt を書くのは `dori review` だけで、他の何も書きません。head に固定した `prompts/review.md` を非対話の omo に渡して実行し、`VERDICT:` 行を出さないレビュアーは receipt を残しません。レビューの後に push すれば head が動くので、古い receipt は効きません。

`~/.dori/config.json` の `hooks.reviewCommand` で、内蔵レビュアーを自前のコマンドに差し替えられます。同じ `VERDICT:` 行を出す必要があります。

## コマンド一覧

harness、`src/cli.ts`。

| コマンド | 内容 |
|---|---|
| `dori up [--cwd DIR]` | lead、duty、duty ループ、毎時のループのペインを開く |
| `dori start <key> --brief FILE [--cwd DIR]` | lane を開く。新しいタブ、エージェントセッション、brief と lane ルール |
| `dori report <key> --text T [--status working\|waiting]` | lane が区切りまたは待ちを記録する |
| `dori ready <key> --text T --evidence LINK` | lane が終わる。証拠がなければ拒否 |
| `dori review <owner/repo#N> [--model M]` | その head での新しいレビュアー。receipt を書く |
| `dori merge <owner/repo#N> [--dry-run]` | CLEAR の receipt とグリーンのチェックのうえで squash マージ |
| `dori done <key>` | lead が READY の lane を閉じる |
| `dori status` | ロールと開いているすべての lane |
| `dori duty [--once] \| stop \| resume \| status` | duty ループと停止スイッチ |
| `dori loop [--once] \| stop \| resume \| status` | 毎時のループと停止スイッチ |
| `dori backlog add \| list \| decide \| drop \| import` | 毎時のループが取り出す待ち行列 |
| `dori send <target> --text T` と `dori inbox list\|ack\|resend` | 配送、待機、保留された配送の解決 |
| `dori role <lead\|duty> [PANE]` | `dori up` を使わなかったときにペインを登録する |

引数なしで `bun src/cli.ts` を実行すると、すべてのフラグ付きで同じ一覧が出ます。

Dori mode、`skills/dori-mode/scripts/src/cli.ts`。

| コマンド | 内容 |
|---|---|
| `dori launch <key> --title T --brief FILE --done "..."` | lane を開く。実行時間、トークン、コストの上限を任意で付ける |
| `dori claim-done` と `dori object-done` | 5 分の完了フロー |
| `dori close <key>` | `Done =` のシグナルが実物で確認できた lane を閉じる |
| `dori sync` / `dori boot` | レジストリと実ペインの突き合わせ。再起動後の読み取り専用チェック |
| `dori freshness` / `dori dead-panes` / `dori guard` / `dori heavy` | 催促、検出、ホスト負荷の監視、重いコマンドの制限 |
| `dori send` / `dori inbound` / `dori presence` / `dori transcribe` | 上記のメッセンジャー用コマンド |
| `dori worklog` / `dori lesson` / `dori checkpoint` | 依頼の記録、リポジトリごとの学び、完了したステップ |

`dori launch --dry-run` は lane が受け取る形の brief を出力します。

## 拡張する

`~/.dori/config.json` のライフサイクルフックは、状態の変化で自前のプログラムを呼びます。argv 配列として渡され、`{key}`、`{text}`、`{evidence}`、`{repo}`、`{number}`、`{sha}` が引数ごとに埋まり、シェルは経由しません。

| フック | 発火 |
|---|---|
| `hooks.onReady` | lane が証拠付きで終わったとき |
| `hooks.onReport` | lane が報告したとき |
| `hooks.onLost` | lane のペインが消えたとき |
| `hooks.reviewCommand` | 内蔵レビュアーを置き換える |

応答しないフックがコマンドを止めることはありません。CLI は実行中のフックを最大 2 秒だけ待ち、その旨を出力します。`DORI_PROMPTS_DIR` で四つのプロンプトを自前のものに差し替え、`DORI_AGENT_CMD` で `omo` を別のエージェントに替え、`DORI_HOME` で状態ディレクトリを移せます。

## コンテナで動かす

[examples/container](examples/container) は gh、node、bun、herdr、omo、harness を固定した Ubuntu イメージと、`dori` サービス一つ、そしてすべての状態を入れる名前付きボリュームを用意します。公開イメージはありません。ローカルでビルドし、中で一度ログインしてください。[docs/container.md](docs/container.md) にビルド、再起動しても残るボリューム、サイジングがあります。

## テスト

```sh
bun run test        # ./test/ の 275 テスト
bun run test:skill  # skills/dori-mode/scripts の 308 テスト
bun run ci          # Biome、tsc、knip、250 行のラチェット、そのあと両方のスイート
```

どちらのスイートもモデルもネットワークも要りません。harness は偽の herdr と偽の `gh` に対して、Dori mode は偽の herdr、git、`gh` に対して走ります。エンドツーエンドのテスト二つは本物の herdr サーバーを起動し、`herdr` が PATH にないときは自分自身を skip します。

## テレメトリー

`dori` は omo と同じやり方で匿名の利用数を送ります。`https://t.omo.dev` への OTLP/HTTP JSON で、`~/.dori/telemetry.json` に置いたランダムなインストール id の sha256 だけを送ります。外に出るのは数と固定の enum です。インストール、日次アクティブ、lane 開始、lane ready、レビュー完了、マージ判定、そして一時間に一度の duty サマリーです。パス、リポジトリ名、PR 番号、lane キー、brief、メッセージその他のテキストは送りません。`DORI_TELEMETRY=0` で止まり（`DO_NOT_TRACK=1` も効きます）、`DORI_TELEMETRY_ENDPOINT` で送り先を変えられます。テレメトリーがコマンドを失敗させることはありません。

## コントリビュート

コントリビューターは、レビューやマージの前に[コントリビューターライセンス契約](CLA.md)へ一度署名します。プルリクエストに `I have read the CLA Document and I hereby sign the CLA` とコメントしてください。ゲート、テストコマンド、プルリクエストの規則は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## ライセンス

このプロジェクトは [Sustainable Use License](LICENSE) 1.0 で提供され、サードパーティの構成要素はそれぞれのライセンスに従います。自分の業務での内部利用と、非営利または個人での利用を対象とします。商用利用には所有者のライセンスが必要です。`ba96abf` より前のコミットは公開時の MIT ライセンスのままで、この変更はそのコミットから適用されます。`prompts/` にあるプロンプトはエージェントが実際に受け取る指示そのもので、信じる前に読み切れる長さしかありません。
