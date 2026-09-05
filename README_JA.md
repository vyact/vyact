<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact ロゴ" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

**Vyact は、llama.cpp、RAG、AI エージェント、ドキュメントインテリジェンス、Google Workspace / Microsoft 連携に対応した、オープンソースかつローカルファーストのパーソナル AI ワークスペースです。**

### 会話、知識、日々の作業をひとつにまとめるプライベートワークスペース

ファイル、メモ、メール、普段使うツールを、作業の流れを変えることなく有用な AI コンテキストとして活用できます。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
[![Latest release](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

[はじめる](#はじめる) · [ワークフロー](#日々の作業をひとつのワークスペースで) · [機能](#コンテキストを保つために必要なすべて) · [Vyact を支援](#vyact-を支援) · [コントリビューション](CONTRIBUTING.md)
</div>

---

## モデルは変わっても、あなたのコンテキストは残るべきです

AI チャットを使うたびに、ファイルを探し、メールをコピーし、背景を説明し直す必要はありません。Vyact は AI チャット、ドキュメント、メモ、普段使うツールをひとつのワークスペースにまとめます。回答の根拠を確認し、メモを検索可能な知識に変え、Gmail、Outlook、Google Drive、OneDrive、カレンダー、Chrome の情報を同じ会話で利用できます。

llama.cpp と MLX によるローカル LLM を中心に設計されているため、会話、文書、作業コンテキストを自分の環境に保持できます。必要に応じて、ホステッドプロバイダーや独自の OpenAI 互換 LLM エンドポイントにも接続できます。

<div align="center" markdown="1">

[![ダウンロード](https://img.shields.io/badge/Download-GitHub%20Releases-7c3aed?style=for-the-badge&logo=github&logoColor=white)](https://github.com/vyact/vyact/releases)
[![Vyact を支援](https://img.shields.io/badge/Support-Vyact-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)

</div>

## 日々の作業をひとつのワークスペースで

### AI チャット、ファイル、Google、Microsoft をひとつに

PDF や文書を添付して質問し、回答の根拠までたどれます。複数の Google / Microsoft アカウントを接続し、Gmail や Outlook のメールと添付ファイル、Drive や OneDrive のファイルを会話に直接追加できます。同じコンテキストから返信メールの下書きも作成できます。

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

### 音声モードと語学学習

任意の自動読み上げで、生成済みの文を 1×〜2× の速度で聞けます。音声会話で対象言語を練習したり、Chrome 拡張機能で Netflix の二重字幕、字幕移動、リピート再生、自動停止、弱点に合わせた短い AI 解説を利用したりできます。外国語ページの翻訳や、現在のページ・選択テキストのチャット送信にも対応します。

<p align="center"><img src="assets/readme/feature-voice-chat.png" alt="Vyact 音声会話" width="100%" /></p>
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
| 🗂️ | Google / Microsoft 連携 | Gmail、Outlook、Drive、OneDrive、カレンダーを利用できます。 |
| ↗️ | ローカル OpenAI 互換 API | 有効なローカルモデルを他のアプリから利用できます。 |
| 🎙️ | 音声語学学習 | 音声入力と AI 応答で会話練習ができます。 |
| 🌐 | Chrome 拡張機能 | Netflix や Web ページを使って学習・質問できます。 |
| ✍️ | ブラウザ文章支援 | 文法や文体を修正し、元の文と比較できます。 |
| 🧩 | MCP ツール接続 | 普段使うツールを Vyact に接続できます。 |
| 🌍 | 多言語 UI | 韓国語、英語、日本語、中国語、タイ語、ベトナム語、スペイン語、フランス語に対応します。 |

### ワークスペースの所有権を保つ

- **ローカルファースト** — llama.cpp、Apple Silicon の MLX、ローカル embedding を中心に設計されています。
- **プロバイダーを選択** — ローカルモデル、OpenAI、Gemini、Claude、独自 OpenAI 互換 endpoint を選べます。
- **別のアプリから利用** — **設定 > API Server** で endpoint、model ID、OpenClaw 設定、curl テストをコピーできます。任意の Bearer token 認証に対応します。
- **データ送信を把握** — メールやクラウドファイルを外部 AI provider の会話コンテキストに使うと、その内容が provider に送信される場合があります。Vyact 管理のローカルモデルでは外部 AI provider に送信されません。
- **バックアップ** — 会話、文書、ファイル、メモ、prompt、設定、接続、project、語彙を export / restore できます。Google Drive / OneDrive にも保存できます。
- **オープンソース** — AGPL-3.0 の下で公開されています。

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

Vyact は Python 3.12 を内蔵し、ローカルモデルランタイムを管理します。GGUF は llama.cpp / llama-swap、Apple Silicon の対応 MLX モデルは oMLX で動作します。macOS では Homebrew、Windows では `winget` が不足バイナリの自動導入に推奨されます。Linux パッケージには Ubuntu 22.04（glibc 2.35 以上）で構築した CPU runtime が含まれ、互換性のある既存の GPU 対応 runtime が優先されます。Elasticsearch は対応する native distribution を利用できるため Docker は必須ではありません。

### 最初の 5 分

1. Vyact を起動し、provider と model を選びます。ローカル GGUF / MLX model を検索するには **Vyact** を選択します。
2. 文書をドロップするか **文書管理** で索引化し、必要に応じて知識コレクションを作成します。
3. チャットで質問し、正確性が重要な場合は取得されたコンテキストを確認します。
4. **設定 > Google**、**設定 > Microsoft**、または Chrome 拡張機能を接続します。
5. 繰り返す作業のためにメモ、project、再利用可能な skill を作成します。

### カスタム LLM provider

OpenAI 互換 `/chat/completions` API に接続できます。接続名、`/chat/completions` を除いた Base URL、任意の API key、正確な Model ID、必要に応じた追加 header を設定してください。ストリーミング、tool calling、画像入力は接続先 server / model の機能に依存します。

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

## ライセンスと商標

Vyact は [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）で提供されます。変更版をネットワーク経由で提供する場合、対応するソースコードも同じライセンスで公開する必要があります。Vyact の名称、ロゴ、公式ビジュアルブランド資産は AGPL-3.0 の対象外です。fork や変更版では明確に異なる名称と visual identity を使用してください。詳細は [ブランドおよび商標ポリシー](TRADEMARKS.md) を参照してください。
