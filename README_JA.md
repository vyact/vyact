<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact ロゴ" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

**Vyact は、llama.cpp、RAG、AI エージェント、ドキュメントインテリジェンス、Google Workspace 連携に対応した、オープンソースかつローカルファーストのパーソナル AI ワークスペースです。**

### 会話、知識、日々の作業をひとつにまとめるプライベートワークスペース

ファイル、メモ、メール、普段使うツールを、作業の流れを変えることなく有用な AI コンテキストとして活用できます。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
[![Latest release](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

[はじめる](#はじめる) · [ワークフロー](#日々の作業をひとつのワークスペースで) · [機能](#コンテキストを保つために必要なすべて) · [Vyact を支援](#vyact-を支援) · [コントリビューション](CONTRIBUTING.md)
</div>

---

## モデルは変わっても、あなたのコンテキストは残るべきです

AI チャットを使うたびに、ファイルを探し、メールをコピーし、背景を説明し直す必要はありません。Vyact は AI チャット、ドキュメント、メモ、普段使うツールをひとつのワークスペースにまとめます。回答の根拠を確認し、メモを検索可能な知識に変え、Gmail、Google Drive、カレンダー、Chrome の情報を同じ会話で利用できます。

llama.cpp と MLX によるローカル LLM を中心に設計されているため、会話、文書、作業コンテキストを自分の環境に保持できます。必要に応じて、ホステッドプロバイダーや独自の OpenAI 互換 LLM エンドポイントにも接続できます。

<div align="center" markdown="1">

[![ダウンロード](https://img.shields.io/badge/Download-GitHub%20Releases-7c3aed?style=for-the-badge&logo=github&logoColor=white)](https://github.com/vyact/vyact/releases)
[![Vyact を支援](https://img.shields.io/badge/Support-Vyact-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)

</div>

## 日々の作業をひとつのワークスペースで

### AI チャット、ファイル、Google をひとつに

PDF や文書を添付して質問し、回答の根拠までたどれます。複数の Google アカウントを接続し、Gmail のメールと添付ファイル、Drive のファイルを会話に直接追加できます。同じコンテキストから返信メールの下書きも作成できます。

<p align="center"><img src="assets/readme/feature-ai-workspace.png" alt="ドキュメントと Google Workspace を利用する Vyact AI チャット" width="100%" /></p>

### ハードウェアに合うローカルモデルを探す

Vyact 内で GGUF / MLX モデルを検索・比較できます。モデルサイズ、量子化、コンテキスト長、検出された RAM / GPU VRAM、ハードウェアに応じたメモリ見積もりを確認してからダウンロードできます。対応するマルチ GPU llama.cpp 環境では自動メモリ調整が既定で、上級者向けに手動 GPU 分割も用意されています。公開モデルは API キー不要で、Hugging Face キーを追加すると許可された gated model にアクセスできます。

<p align="center"><img src="assets/readme/feature-local-models.png" alt="Vyact のローカルモデル検索" width="100%" /></p>

#### MLX アクセラレーション

Apple Silicon では、テキストおよび画像対応 MLX モデルを単一の oMLX ランタイムで実行します。Prefix KV Memory Cache は既定で有効で、再利用可能なプロンプト状態をメモリとページ化 SSD キャッシュに保持します。互換性のある External MTP companion が存在する場合はモデルと共に取得・検証し、高速なデコードに利用します。機能情報はインストール済み oMLX から読み取られるため、固定されたモデル一覧ではなくエンジンのバージョンに追従します。現在、Speculative Prefill と組み込み native MTP は無効です。対応 DFlash モデルは専用の高速化経路を使用します。

### 自分のハードウェアで設定を比較

**モデル設定 > パフォーマンステスト** で、GGUF の performance mode、KV cache quantization、対応 MTP、または MLX の対応 MTP を比較できます。短い入力、長い入力、フォローアップ会話を実行し、最初のトークンまでの時間、生成速度、総応答時間、再利用された prefix token、実際の入出力 token 数を表示します。結果は速度スコア順に並び、選択した結果を設定フォームに反映できます。テストの完了・中止・失敗後には以前のモデルと設定が復元されます。

<p align="center"><img src="assets/readme/feature-model-benchmark.png" alt="Vyact モデル性能テスト" width="100%" /></p>

### 文書をナレッジベースに

文書を一度アップロードして索引化すると、通常のチャット中に質問と関連する箇所が自動取得されます。文書、メモ、索引化したメールスレッドを知識コレクションにまとめ、RAG の対象を限定できます。必要なときは取得されたソースを確認できます。

<p align="center"><img src="assets/readme/feature-document-rag.png" alt="Vyact の文書管理と RAG" width="100%" /></p>

### アイデア、計画、決定を記録して RAG で検索

見出し、引用、リスト、コードブロックに対応したリッチテキストメモを作成できます。メモもナレッジベースに索引化され、通常の会話から自動的に検索されます。

<p align="center"><img src="assets/readme/feature-memo.png" alt="Vyact リッチテキストメモ" width="100%" /></p>

### 音声モードで回答を聞く

画面上の文字を読むのが難しい方や、耳で聞く方を好む方のために、自動読み上げを任意で有効にできます。回答の生成中に完了した文を読み上げ、速度は 1×〜2× で調整できます。設定は記憶され、回答の停止ボタンからいつでも読み上げを止められます。

### 話しながら言語を学ぶ

対象言語で自然な音声会話を練習できます。Vyact に話しかけて回答を聞き、単独のフレーズ暗記ではなく、実際の表現と反復会話で自信を身につけられます。

<p align="center"><img src="assets/readme/feature-voice-chat.png" alt="Vyact 音声会話" width="100%" /></p>

### Chrome 拡張機能で Netflix とあらゆるページから言語を学ぶ

Netflix の二重字幕、字幕移動、リピート再生、自動停止を利用できます。苦手な言語領域を選ぶと、視聴中の字幕についてその弱点に焦点を当てた短い AI 解説が表示されます。外国語ページの翻訳や、現在のページ・選択テキストのチャット送信にも対応します。

<p align="center"><img src="assets/readme/feature-plugin.png" alt="Vyact Chrome 拡張機能" width="100%" /></p>

### ページを離れず文章を改善

Chrome 拡張機能の **文章を改善** では、選択テキストや入力欄全体の文法を修正し、自然、丁寧、簡潔、ユーモラスなどの文体へ調整できます。元の言語を維持するか出力言語を選び、Before / After を並べて確認できます。

<p align="center"><img src="assets/readme/feature-writing-assistant.png" alt="Vyact Chrome 拡張機能の文章改善" width="100%" /></p>

## コンテキストを保つために必要なすべて

| | 機能 | メリット |
| --- | --- | --- |
| 💬 | ストリーミング AI チャット | ローカル・ホステッドモデルのどちらでも高速に会話できます。 |
| 📚 | 添付、知識コレクション、RAG | 文書、メモ、メールを適切なコンテキストとして利用できます。 |
| ⚡ | ローカルモデル性能テスト | 実機で設定、時間、token 数を比較できます。 |
| 🔎 | ソース付き回答 | 回答に使われた箇所と文書を確認できます。 |
| 📝 | リッチテキストメモ | 会話中に RAG で再利用できる構造化メモを残せます。 |
| 🗂️ | Google 連携 | Gmail、Drive、カレンダーを利用できます。 |
| ↗️ | ローカル OpenAI 互換 API | 有効なローカルモデルを他のアプリから利用できます。 |
| 🎙️ | 音声語学学習 | 音声入力と AI 応答で会話練習ができます。 |
| 🌐 | Chrome 拡張機能 | Netflix や Web ページを使って学習・質問できます。 |
| ✍️ | ブラウザ文章支援 | 文法や文体を修正し、元の文と比較できます。 |
| 🧩 | MCP ツール接続 | 普段使うツールを Vyact に接続できます。 |
| 🌍 | 多言語 UI | 韓国語、英語、日本語、中国語、タイ語、ベトナム語、スペイン語、フランス語に対応します。 |

### コンテキストを何度も作り直さずに作業する

- **プロジェクトと会話履歴** — チャットをプロジェクト単位でまとめ、プロジェクト固有の作業指示を設定し、会話の名前変更・export を行い、再開時に同じスレッドへ戻れます。
- **使い続けられるファイル** — 一度だけ添付することも、長期知識として索引化することもできます。文書、メモ、メールスレッドを知識コレクションにまとめ、RAG の対象を絞れます。
- **チャットに埋もれないメモ** — rich text memo、簡単な todo、決定事項を整理し、後で RAG から利用できます。
- **AI を自分で制御** — llama.cpp / MLX、OpenAI、Gemini、Claude、または OpenAI 互換 LLM を選び、context、output、sampling、embedding、chunking を調整できます。

### 仕事を接続し、その場で操作する

- **Gmail** — メールの検索・閲覧、label 操作、メールと添付の chat 追加、AI による返信作成、署名管理、送信に対応します。
- **Google Drive** — 閲覧、検索、upload、download、rename、copy、share を行い、ファイルを会話や knowledge base に追加できます。
- **Google Calendar** — 現在の作業から離れず event の表示、作成、更新、削除ができます。
- **組み込み Google Workspace 接続** — **設定 > Google** で OAuth credentials JSON を upload し、複数アカウントを接続できます。外部 MCP server を介さず Google API を直接呼び出し、OAuth token は backup export に含まれません。
- **アカウント切替** — 接続済みの Google アカウントを切り替えられます。macOS は **Cmd+Shift+G**、Windows/Linux は **Ctrl+Shift+G** で Google パネルを開閉できます。
- **MCP と再利用可能な skill** — **設定 > AI Tools** で filesystem、GitHub、custom MCP server を追加し、**設定 > Skills** で再利用可能な指示を管理できます。

### ワークスペースの所有権を保つ

- **ローカルファースト** — llama.cpp、Apple Silicon の MLX、ローカル embedding を中心に設計されています。
- **プロバイダーを選択** — ローカルモデル、OpenAI、Gemini、Claude、独自 OpenAI 互換 endpoint を選べます。
- **別のアプリから利用** — **設定 > API Server** で endpoint、model ID、OpenClaw 設定、curl テストをコピーできます。任意の Bearer token 認証に対応します。
- **データ送信を把握** — メールやクラウドファイルを外部 AI provider の会話コンテキストに使うと、その内容が provider に送信される場合があります。Vyact 管理のローカルモデルでは外部 AI provider に送信されません。
- **バックアップ** — 会話、文書、ファイル、メモ、prompt、設定、接続、project、語彙を export / restore できます。Google Drive にも保存できます。
- **オープンソース** — AGPL-3.0 の下で公開されています。

## 今日から始められること

| やりたいこと | Vyact で試す方法 |
| --- | --- |
| レポートをすばやく理解する | PDF を添付し、簡潔な briefing を依頼して、取得された source を確認します。 |
| 難しいメールに返信する | メールスレッドと Drive file を添付し、自分の文体で下書きを作り、Gmail から送信します。 |
| 個人用の仕事の記憶を作る | よく使う文書を索引化し、決定を memo に保存して、後から RAG で取得します。 |
| 文脈を失わず project を計画する | project と作業指示を作成し、discussion をまとめ、必要に応じて会話を export します。 |
| 毎日新しい言語を練習する | voice chat、または二重字幕と弱点別解説を備えた Netflix 学習を利用します。 |
| ローカルモデル設定を比較する | モデル設定の performance test で組合せを比較し、好みの設定を適用します。 |
| browsing 中に調査する | Chrome から選択テキストや現在の page を Vyact に送り、page context と共に会話します。 |

## はじめる

### デスクトップアプリをインストール

[GitHub Releases](https://github.com/vyact/vyact/releases) から **Apple Silicon Mac（M1 以降）**、**Windows**、**Linux x64** 版をダウンロードしてください。macOS は DMG、Windows は EXE、Linux は AppImage / DEB です。Intel Mac は現在サポートされていません。

Linux AppImage:

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

Ubuntu / Debian:

```bash
sudo apt install ./vyact_*_amd64.deb
```

DEB のインストール後は application menu から **Vyact** を起動します。

### 初回起動の前に

Vyact は Python 3.12 を内蔵し、ローカルモデルランタイムを管理します。GGUF は llama.cpp / llama-swap、Apple Silicon の対応 MLX モデルは oMLX で動作します。

| プラットフォーム | コアアプリの要件 | 機能別の要件 |
| --- | --- | --- |
| macOS (Apple Silicon) | なし | **ローカル GGUF**: 不足 binary の導入には [Homebrew](https://brew.sh/) 推奨、または互換 `llama-server` / `llama-swap`。<br><br>**ローカル MLX**: oMLX の自動導入・更新には Homebrew 推奨、または互換 `omlx`。<br><br>**Elasticsearch**: native mode は外部依存なし、container mode の Docker Desktop は任意。<br><br>**Kokoro TTS**: `espeak-ng` の導入が必要な場合のみ Homebrew が必要。 |
| Windows | なし | **ローカル GGUF**: 不足 binary の導入には `winget` 推奨、または互換 `llama-server` / `llama-swap`。<br><br>**Elasticsearch**: native mode は外部依存なし、Docker Desktop は任意。<br><br>**Kokoro TTS**: `espeak-ng` の導入が必要な場合のみ `winget` が必要。 |
| Linux (x64) | glibc 2.35+ の x86-64 desktop。DEB は宣言済み desktop library dependency を APT で導入します。 | **ローカル GGUF**: CPU runtime 同梱、Homebrew 不要。<br><br>**Elasticsearch**: native mode は外部依存なし、Docker は任意。<br><br>**Browser / Kokoro TTS**: library や `espeak-ng` が不足する場合、対応 package manager (`apt-get`, `dnf`, `zypper`, `pacman`) と PolicyKit authentication agent が必要です。Vyact は `pkexec` で認証を求め、利用できない場合は passwordless/cached `sudo` のみ試行します。 |

macOS、Windows、Linux では対応する native Elasticsearch distribution を download / run できるため Docker は不要です。package manager は選択機能に必要な system binary がない場合の自動設定にのみ必要です。初回起動時、選択した構成に必要な component が準備されます。

### 最初の 5 分

1. Vyact を起動し、provider と model を選びます。ローカル GGUF / MLX model を検索するには **Vyact** を選択します。
2. 文書をドロップするか **文書管理** で索引化し、必要に応じて知識コレクションを作成します。
3. チャットで質問し、正確性が重要な場合は取得されたコンテキストを確認します。
4. **設定 > Google**、または Chrome 拡張機能を接続します。
5. 繰り返す作業のためにメモ、project、再利用可能な skill を作成します。

### カスタム LLM provider

OpenAI 互換 `/chat/completions` API に接続できます。初期設定では **Custom LLM** を選び、インストール後は sidebar の provider controls から追加・編集します。

- **接続名** — Vyact に表示する label。
- **Base URL** — `/chat/completions` を除いた API root（例: `http://localhost:11434/v1`）。
- **API key** — local server では任意、Bearer 認証を使う endpoint では必須。
- **Model ID** — API が要求する正確な model identifier。
- **追加 header** — gateway や組織固有の認証用 header。

```text
Connection name: Local LLM
Base URL: http://localhost:8080/v1
API key: (leave blank)
Model ID: my-local-model
Additional headers: (none)
```

custom 接続設定は backup / restore に含まれます。streaming、tool calling、画像入力は接続先 server / model の機能と OpenAI compatibility に依存します。

### Chrome 拡張機能

1. [Chrome ウェブストアから Vyact をインストール](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)します。
2. Vyact デスクトップアプリを起動します。
3. ツールバーに固定し、任意のページでサイドパネルを開きます。

## Vyact を支援

Vyact は独立して開発され、オープンソースとして公開されています。支援は開発、テスト、モデル互換性、ドキュメント、新しいワークフローの改善に使われます。寄付だけでなく、必要としている人への共有も大きな支援です。

<div align="center" markdown="1">

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)
[![PayPal](https://img.shields.io/badge/Support%20with-PayPal-00457c?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/vyact)
[![Patreon](https://img.shields.io/badge/Support%20on-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)

**Vyact の独立性、オープン性、継続的な開発を支えてくださり、ありがとうございます。**
</div>

## コントリビューションとフィードバック

コード、ドキュメント、翻訳、テスト、アイデア、バグ報告、ワークフローへのフィードバックを歓迎します。参加前に [CONTRIBUTING.md](CONTRIBUTING.md) をお読みください。セキュリティ上の脆弱性は公開 issue にせず、[セキュリティポリシー](SECURITY.md) に従ってください。

project role と公開意思決定については [GOVERNANCE.md](GOVERNANCE.md) を参照してください。discussion board、real-time chat、検索可能な support knowledge の計画は [community roadmap](COMMUNITY_ROADMAP.md) と [AWS infrastructure plan](docs/AWS_COMMUNITY_INFRASTRUCTURE.md) に記載されています。質問や設定支援は title の先頭に `[Question]` を付けて issue を作成してください。

## ライセンス

Vyact は [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）で提供されます。変更版を web app や SaaS などネットワーク経由で提供する場合、対応する source code も同じ license で公開する必要があります。

## ブランドと商標

Vyact の名称、ロゴ、公式 visual brand asset は AGPL-3.0 の対象外です。公式 project を正確に参照することはできますが、fork や変更版では明確に異なる名称と visual identity を使用してください。[Vyact ブランドおよび商標ポリシー](TRADEMARKS.md) を参照してください。
