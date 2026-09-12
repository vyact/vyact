<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact ロゴ" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

### ローカルLLMを、毎日の仕事に。

Vyact はローカル AI を日々の作業につなぐデスクトップワークスペースです。選んだモデルで資料への質問、メールの返信、コード作業を進め、Chrome での読書・文章作成・語学学習にも活用できます。

**Apple Silicon Mac · Windows · Linux x64**

オープンソース。モデルを自分のコンピューターで実行でき、必要に応じてクラウドのAIも選べます。

[**Vyactをダウンロード**](https://github.com/vyact/vyact/releases/latest) · [**ワークフローのデモを見る**](https://youtu.be/5EdlX2hIB-c)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
[![Latest release](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

[はじめる](#まずは文書をひとつ試す) · [ワークフロー](#日々の作業をひとつのワークスペースで) · [デスクトップ](#デスクトップでできること) · [Chrome 拡張機能](#チャットだけではないchrome-拡張機能) · [Vyact を支援](#vyact-を支援) · [コントリビューション](CONTRIBUTING.md)
</div>

---

[![ワークフローのデモを見る](assets/readme/demo-local-document-dark.png)](https://youtu.be/5EdlX2hIB-c)

1分53秒のデモで、文書への質問と出典確認、メール署名とAI返信の作成、ブラウザーでの文章校正を紹介します。架空のデータを使用した実際のVyactの録画です。待ち時間を編集し、文書の回答生成には2倍速の場面が含まれます。

## 日々の作業をひとつのワークスペースで

### 文書から答えを見つけ、根拠を確かめる

PDF をチャットに添付して、重要な決定、未解決の疑問、次の作業を質問できます。回答の出典を開けば、原文と照合できます。よく使う文書は索引化しておくと、毎回添付し直さずに質問できます。

**試してみる:** 「この文書の主なリスクを3つ挙げ、根拠となる箇所も示してください。」

### 受け取ったメールから、使える返信の下書きへ

会話の横で Gmail や Outlook のスレッドを読み、関連ファイルを追加して、AI に返信の作成を依頼できます。生成された下書きを確認してメールエディターに挿入し、最後に編集してから送信します。

**試してみる:** 「次の作業を確認し、期限について尋ねる短い返信を作成してください。」

Google・Microsoft 連携は任意で、OAuth アプリの事前設定が必要です。まずはアカウント連携なしで、手元の文書から試せます。

### ページを離れず文章を改善

投稿、メール、コメントを書きながらスペルや文法を確認できます。下線の候補を開いて変更内容を確認し、**適用**または**無視**を選びます。文章全体を書き直す場合も、原文と比較してから使えます。

<p align="center">
  <img src="assets/readme/feature-writing-assistant.png" alt="Reddit の下書きで文法の修正候補、単語の提案、適用ボタンを表示する Vyact Chrome 拡張機能" width="100%" />
</p>

**Chrome 拡張機能と、起動中の Vyact デスクトップアプリが必要です。** 対応する Web エディターでは、適用する修正を自分で選べます。適用するまで原文は変更されません。

## まずは文書をひとつ試す

1. [Vyact をダウンロード](https://github.com/vyact/vyact/releases/latest)し、インストールして起動します。
2. ローカルモデルを使う場合は **Vyact** を選びます。メモリの見積もりと色のガイドを参考にモデルを選び、ダウンロードして準備の完了を待ちます。利用中の AI プロバイダーも選べます。
3. PDF をチャットに添付し、**「要点を3つにまとめ、根拠となる箇所も示してください」**と質問します。
4. 回答の出典を開き、原文と照合します。

初回のダウンロードと準備には時間とインターネット接続が必要です。応答速度はハードウェアとモデルによって異なります。この体験にはメール連携や Chrome 拡張機能は不要です。

[インストール要件とプラットフォーム別の手順](#インストールと接続)

## デスクトップでできること

文書、会話、ツールをひとつの場所に。まずはひとつの作業から始め、必要な連携や機能を追加できます。

| 機能 | できること |
| --- | --- |
| **AI チャットと会話履歴** | ローカル・クラウドのモデルと会話し、ファイルや対応する画像を添付できます。履歴、お気に入り、応答の統計、会話のエクスポートにも対応します。 |
| **文書への質問と出典確認** | PDF、Word、表計算、プレゼンテーション、Markdown、テキストの内容を質問できます。よく使う文書を索引化し、取得された箇所や保存ファイルを管理できます。 |
| **知識コレクション** | 文書、メモ、索引化したメールスレッドをまとめ、専用の指示を設定できます。コレクションを選んで質問の対象を絞れます。 |
| **プロジェクトと記憶** | 会話をまとめ、作業指示やコードフォルダーを設定できます。会話から抽出されたプロジェクトの要約、決定、アクション項目を確認・管理できます。 |
| **メモと簡単なタスク** | 表、リスト、画像、コードブロックを含むメモを作成し、RAG で探せます。簡単なタスクには完了状態を記録できます。 |
| **メール業務** | Gmail・Outlook の閲覧、検索、返信、転送に対応します。AI 下書きの確認、添付、署名、定型文、宛先グループを利用できます。 |
| **クラウドファイルとカレンダー** | Google Drive・OneDrive のアップロード、ダウンロード、整理、共有、会話への添付・索引化に対応します。Google・Microsoft の予定も作成・更新できます。 |
| **Google Docs・Sheets・Slides・Forms** | AI に依頼して Google 文書を作成・更新し、表のセルを読み書きし、スライドを変更し、フォームの作成や回答の取得を行えます。 |
| **コード作業とレビュー** | フォルダーを接続してファイルの検索・編集やプロジェクトの検査を依頼できます。Git の変更やファイル差分を確認し、結果をコピー・ダウンロードしたり、追跡された編集を元に戻したりできます。 |
| **ブラウザーでの作業** | AI に Web 検索、ページの閲覧、画面上の操作を依頼できます。検索結果から、作業に必要なページの確認や操作へ進めます。 |
| **音声と会話練習** | 音声で会話し、回答を聞き、再生設定を調整できます。練習用の台本を作成・編集し、役を選んで相手の発話を聞き、自分の台詞を練習できます。 |
| **個人設定とプロンプト** | 回答スタイルを選び、AI が作成した個人プロフィールを確認してから適用できます。システムプロンプトや再利用するスキルも保存できます。 |
| **コンピューターに合うモデル** | GGUF・Apple Silicon 用 MLX モデルを探してダウンロードし、メモリ見積もりや保存先を確認できます。実機で対応設定の性能を比較できます。 |
| **MCP ツールとローカル API** | ローカル・リモートの MCP ツールを接続し、リクエストごとの選択や実行承認を管理できます。有効なローカルモデルを OpenAI 互換 API で他のアプリから使えます。 |
| **バックアップと日常の操作** | 選んだデータをローカルや Drive・OneDrive にバックアップし、復元できます。アカウント切替、通知、ショートカット、明暗テーマ、8言語の UI に対応します。 |

Google・Microsoft 連携にはアカウントの設定と権限が必要です。AI が実行できる操作はモデルと接続先によって異なり、両サービスで利用できるツールは同一ではありません。

## チャットだけではない、Chrome 拡張機能

読んでいるページ、書いているページで AI を使えます。**Chrome 拡張機能をインストールし、Vyact デスクトップアプリを起動しておく**と、選んだモデルにつながります。

| 機能 | できること |
| --- | --- |
| **ページの横でチャット** | サイドパネルで続けて質問し、画像やファイルを追加し、保存したプロンプトや会話履歴を利用できます。 |
| **ページへの質問・要約・保存** | 現在のページや選択テキストを会話に追加し、ページを要約したり、後で検索する知識として Vyact に保存したりできます。 |
| **翻訳とリーダーモード** | 選択テキストのクイック翻訳・詳細翻訳に対応します。リーダーモードではページの段落や選択範囲を翻訳し、選択テキストを読み上げられます。 |
| **入力中の文章チェック** | スペル・文法の候補を下線で表示します。個別・一括で確認、適用、無視でき、適用した変更を取り消せます。 |
| **文章全体の書き直し** | 自然、丁寧、簡潔、ユーモラスな文章への変更や文法修正を依頼できます。出力言語と追加指示を選び、比較してから適用・コピーできます。 |
| **文章支援の設定** | 自動チェックを切り替えられます。単語の提案と修正理由は必要に応じて有効にでき、どちらも初期設定ではオフです。ページに合わせて文章支援や選択テキストのツールも切り替えられます。 |
| **単語帳と保存した文** | 意味や発音を調べ、単語を例文とともに保存できます。訳や出典リンクを付けて文を保存し、検索・読み上げ・削除できます。 |
| **Netflix の再生練習** | 二重字幕、文の移動、再生・リピート、自動一時停止に対応します。全字幕のスクリプトを開き、文を選んで移動できます。 |
| **自分に合った Netflix の解説** | 現在の字幕や選択した表現について質問できます。慣用句、つながる発音、文法、ニュアンスなど言語別の苦手分野を選び、役立つ文を保存できます。 |
| **AI で Netflix の作品を探す** | 覚えている物語や見たい内容を説明し、候補と理由を確認して Netflix 検索につなげられます。 |
| **デスクトップ AI とブラウザーの接続** | Vyact のブラウザー作業を Chrome 上で実行できます。操作が画面に見え、ログインなど自分で行う手順では一時停止して続行できます。 |

文章支援は対応する Web エディターで利用できます。Netflix 学習は作品で利用可能かつ読み込まれた字幕に依存し、AI の作品候補は地域ごとの配信を保証するものではありません。

[**Chrome 拡張機能をインストール**](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)

## 画面で見る使い方

### あとで見つかるメモを残す

計画や決定をリッチテキストメモに保存し、あとでナレッジベースを通じて質問できます。

<p align="center">
  <img src="assets/readme/feature-memo.png" alt="Vyact のリッチテキストメモ" width="100%" />
</p>

### 声に出して会話を練習する

自由に会話することも、保存した台本で役を選ぶこともできます。任意の自動読み上げと再生速度の調整で、回答を耳でも確認できます。

<p align="center">
  <img src="assets/readme/feature-voice-chat.png" alt="Vyact の音声会話と会話練習" width="100%" />
</p>

### 読んでいる内容を理解する

サイドパネルで記事を要約し、ページを離れずに知らない単語の発音や例文を調べられます。

<p align="center">
  <img src="assets/readme/feature-plugin.png" alt="記事の要約と、発音・例文を含む単語検索を表示する Vyact" width="100%" />
</p>

## 自分に合うローカルモデルを選ぶ

ダウンロード前に、モデルのサイズとメモリ見積もりを自分のコンピューターと比較できます。実際のメモリ使用量はモデルと設定によって変わります。Vyact は GGUF モデルや Apple Silicon 用 MLX モデルに合うランタイムを準備します。公開モデルは API キー不要で、アクセス制限のある Hugging Face モデルには権限のあるアカウントが必要です。

<p align="center">
  <img src="assets/readme/feature-local-models.png" alt="システムメモリとモデルのメモリ見積もりを表示するモデル検索" width="100%" />
</p>

<details>
<summary>実機でモデル設定を比較する</summary>

**Model settings > 性能テスト**で、短い入力、長い入力、続きの会話を使って対応する設定を比較できます。応答時間、生成速度、トークン数を確認し、**この値を設定**、**Apply**の順に選んで有効にします。

結果は速度の比較であり、回答品質の評価ではありません。中止しても完了した測定は残り、テスト後は以前のモデルと設定に戻ります。復元に失敗した場合は通知されます。新しいテストを始めると、そのモデルの以前の結果が置き換わります。

<p align="center">
  <img src="assets/readme/feature-model-benchmark.png" alt="応答時間とトークン数を示すモデル性能テスト結果" width="100%" />
</p>

</details>

## インストールと接続

<details>
<summary>インストール要件とプラットフォーム別の手順</summary>

### デスクトップアプリをインストール

[GitHub Releases](https://github.com/vyact/vyact/releases) から **Apple Silicon Mac（M1 以降）**、**Windows**、**Linux x64** 版をダウンロードし、インストールして起動します。macOS は DMG、Windows は EXE、Linux は AppImage と DEB で配布されます。Intel Mac は現在サポートされていません。

#### Linux で起動する

AppImage はインストールせずに実行できます。ダウンロード先のディレクトリで次を実行します。

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

Ubuntu、Debian、または互換ディストリビューションでは、代わりに DEB をインストールできます。

```bash
sudo apt install ./vyact_*_amd64.deb
```

DEB のインストール後はアプリケーションメニューから **Vyact** を起動します。

### 初回起動の前に

Vyact は Python を内蔵し、選んだ構成に必要なコンポーネントを準備します。macOS の Homebrew と Windows の `winget` は、不足するローカルランタイムの依存関係を導入するために使われます。Linux には CPU ランタイムが同梱され、既存の互換 GPU ランタイムも使用できます。

| プラットフォーム | コアアプリの要件 | 機能別の要件 |
| --- | --- | --- |
| macOS (Apple Silicon) | なし | **ローカル GGUF**: 不足する実行ファイルの導入には [Homebrew](https://brew.sh/) を推奨。互換の `llama-server` と `llama-swap` も利用可能。<br><br>**ローカル MLX**: oMLX の自動導入・更新には Homebrew を推奨。互換の `omlx` も利用可能。<br><br>**Elasticsearch**: ネイティブモードは外部依存なし。コンテナーモードの Docker Desktop は任意。<br><br>**Kokoro TTS**: `espeak-ng` の導入が必要な場合のみ Homebrew が必要。 |
| Windows | なし | **ローカル GGUF**: 不足する実行ファイルの導入には `winget` を推奨。互換の `llama-server` と `llama-swap` も利用可能。<br><br>**Elasticsearch**: ネイティブモードは外部依存なし。Docker Desktop は任意。<br><br>**Kokoro TTS**: `espeak-ng` の導入が必要な場合のみ `winget` が必要。 |
| Linux (x64) | glibc 2.35 以降の x86-64 デスクトップ環境。DEB は必要なデスクトップライブラリーを APT で導入します。 | **ローカル GGUF**: CPU ランタイム同梱。Homebrew は不要。<br><br>**Elasticsearch**: ネイティブモードは外部依存なし。Docker は任意。<br><br>**ブラウザー・Kokoro TTS**: ライブラリーや `espeak-ng` が不足する場合、対応パッケージマネージャー（`apt-get`、`dnf`、`zypper`、`pacman`）とデスクトップの PolicyKit 認証エージェントが必要。Vyact は `pkexec` で認証を求め、利用できない場合はパスワード不要または認証済みの `sudo` のみ試行します。 |

Docker は任意です。Vyact は知識検索用に対応するネイティブ Elasticsearch をダウンロードして実行できます。パッケージマネージャーは、選んだ機能に必要なシステムコンポーネントが不足している場合に使います。

### カスタム LLM プロバイダーを接続する

OpenAI 互換の `/chat/completions` API を実装したサーバーに接続できます。初期設定では **Custom LLM** を選びます。インストール後はサイドバーのプロバイダー操作から接続を追加・編集できます。

- **接続名** — Vyact に表示する名前。
- **Base URL** — `/chat/completions` を除く API のルート。例: `http://localhost:11434/v1`。
- **API キー** — ローカルサーバーでは任意。Bearer 認証が必要な接続先では必須。
- **Model ID** — API が要求する正確なモデル識別子。
- **追加ヘッダー** — ゲートウェイや組織固有の認証に使用。

既存の OpenAI 互換ローカルサーバーの接続例:

```text
Connection name: Local LLM
Base URL: http://localhost:8080/v1
API key: (leave blank)
Model ID: my-local-model
Additional headers: (none)
```

カスタム接続の設定はバックアップと復元に含まれます。ストリーミング、ツール呼び出し、画像入力は、接続先サーバーとモデルの機能および OpenAI 互換性によって異なります。

### Chrome 拡張機能を使う

1. [Chrome ウェブストアから Vyact をインストール](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)します。
2. Vyact デスクトップアプリを起動します。
3. Chrome のツールバーに固定し、通常の Web ページでサイドパネルを開きます。

</details>

<details>
<summary>アカウント、ツール、他のアプリを接続する</summary>

- **Google:** **設定 > Google** で OAuth 認証情報の JSON をアップロードし、ガイドに従ってアカウントを接続して利用するサービスの権限を付与します。
- **Microsoft:** **設定 > Microsoft** で Microsoft Entra アプリの Client ID を入力し、ガイドに従います。職場や学校のアカウントでは管理者の承認が必要な場合があります。
- **MCP とスキル:** **設定 > AIツール** でツールを追加し、**設定 > スキル** で再利用する指示を管理します。
- **他のアプリ:** **設定 > APIサーバー** でローカルモデルの接続先、モデル ID、OpenClaw 設定をコピーできます。必要に応じてトークン認証を有効にします。

</details>

### データとプロバイダーを自分で選ぶ

Vyact 管理のローカルモデルを選ぶと、AI チャットのコンテキストを自分のコンピューターで処理します。OpenAI、Gemini、Claude、独自の OpenAI 互換接続先も利用できます。外部 AI プロバイダーを使う場合は、リクエストに必要なコンテキストがそのプロバイダーに送信されます。メールやクラウドファイルの連携は各サービスと通信します。

バックアップに含めるデータを選び、ローカル、Google Drive、OneDrive に保存できます。OAuth トークンはエクスポートしたバックアップに含まれません。

## Vyact を支援

Vyact は独立して開発されるオープンソースです。仕事に役立ったら、開発、テスト、モデル互換性の改善へのご支援をお願いします。必要としている人に紹介することも支援になります。

<div align="center" markdown="1">

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)
[![PayPal](https://img.shields.io/badge/Support%20with-PayPal-00457c?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/vyact)
[![Patreon](https://img.shields.io/badge/Support%20on-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)

**Vyact の独立性、オープン性、継続的な開発を支えてくださり、ありがとうございます。**
</div>

## コントリビューションとフィードバック

コード、ドキュメント、翻訳、テスト、アイデア、バグ報告、使い方へのご意見を歓迎します。参加前に [CONTRIBUTING.md](CONTRIBUTING.md) をお読みください。

プロジェクトの役割と意思決定については [GOVERNANCE.md](GOVERNANCE.md) を参照してください。

質問や設定の相談は、タイトルの先頭に `[Question]` を付けてイシューを作成してください。

セキュリティ上の脆弱性は公開イシューにせず、[セキュリティポリシー](SECURITY.md) に従って報告してください。

## ライセンス

Vyact は [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）で提供されます。

Vyact を改変し、Web アプリや SaaS などネットワーク経由で提供する場合は、対応するソースコードを同じライセンスで公開する必要があります。

## ブランドと商標

Vyact の名称、ロゴ、公式のブランド画像は AGPL-3.0 による許諾の対象外です。公式プロジェクトを正確に参照できますが、フォークや変更版では明確に異なる名称と外観を使用してください。[Vyact ブランドおよび商標ポリシー](TRADEMARKS.md) を参照してください。
