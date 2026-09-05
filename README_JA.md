<div align="center">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact ロゴ" width="120" />

# Vyact

**会話、文書、メモ、Google・Microsoft の業務ツールをつなぐ、ローカルファーストの AI ワークスペース。**

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

[アプリをダウンロード](https://github.com/vyact/vyact/releases/latest) · [Chrome 拡張機能](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
</div>

## はじめに

Vyact は、作業の背景を毎回コピーして説明し直す手間を減らします。文書を添付して質問し、回答の根拠を確認したり、メモやメールを検索可能な知識として活用したりできます。

llama.cpp と Apple Silicon 向け MLX によるローカルモデルに加え、OpenAI、Gemini、Claude、独自の OpenAI 互換 API にも接続できます。外部の AI プロバイダーを選ぶと、会話に使う文書やメールの内容がそのプロバイダーへ送信される場合があります。

## インストールと最初の体験

1. [GitHub Releases](https://github.com/vyact/vyact/releases/latest) から、お使いの OS に合ったファイルをダウンロードします。
   - **macOS:** Apple Silicon（M1 以降）向け DMG。Intel Mac は現在非対応です。
   - **Windows:** EXE インストーラー。
   - **Linux x64:** AppImage または DEB。glibc 2.35 以降が必要です。
2. インストール後、Vyact を起動します。ローカルモデルを使う場合は初期設定で **Vyact** を選び、メモリ容量と推定使用量を確認してモデルをダウンロードします。
3. macOS では GGUF または MLX、Windows と Linux では GGUF を利用できます。初回のダウンロードとランタイム準備には時間がかかる場合があります。
4. モデルが起動したら短い質問を送信します。次に PDF を添付し、要点と根拠を尋ねてみてください。
5. 繰り返し使う文書は文書管理でインデックスを作成します。通常の会話から関連情報を検索できます。メール連携や Chrome 拡張機能は後から追加できます。

### 実行環境の準備

Python 3.12 はアプリに含まれます。ローカルランタイムの自動セットアップには、macOS では [Homebrew](https://brew.sh/)、Windows では `winget` を推奨します。互換性のあるランタイムがすでにあれば利用できます。

Linux には CPU 用ランタイムが付属します。不足するシステムライブラリの導入には、対応するパッケージマネージャーと管理者認証が必要な場合があります。Elasticsearch はネイティブ実行に対応し、Docker は必須ではありません。

AppImage はダウンロード先で次のように起動できます。

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

Ubuntu / Debian 系では DEB をインストールし、アプリケーションメニューから起動できます。

```bash
sudo apt install ./vyact_*_amd64.deb
```

## Google と Microsoft を接続する

| Google | Microsoft |
| --- | --- |
| Gmail の検索・閲覧・作成・送信、ラベル管理 | Outlook メールの検索・閲覧・作成・送信、フォルダー管理 |
| Google Drive のファイル操作・共有 | OneDrive のファイル操作・共有 |
| Google Calendar の予定表示・作成・編集・削除 | Microsoft の予定表の表示・作成・編集・削除 |

**Google:** 設定の **Google** を開き、事前設定ガイドに従って OAuth 認証情報の JSON をアップロードし、ブラウザーでアカウントにログインします。

**Microsoft:** 設定の **Microsoft** を開きます。Microsoft Entra にアプリを登録し、接続するアカウントに合ったサポート対象を選び、Vyact に表示されるリダイレクト URI をモバイル・デスクトップ向けに登録します。Application (client) ID を Vyact に入力し、ブラウザーでログインします。PKCE を使うため、クライアントシークレットは不要です。アプリ登録には Entra テナントと登録権限が必要です。会社・学校のポリシーによっては管理者の同意が必要になります。

接続後は **G / M** 付きの共通リストでアカウントを切り替えます。Google が上、Microsoft が下に並び、各サービス内では最後に選択したアカウントが先頭になります。**Cmd+Shift+G**（macOS）または **Ctrl+Shift+G**（Windows / Linux）で共通パネルを開閉します。

<p align="center">
  <img src="assets/readme/feature-ai-workspace.png" alt="文書と Google Workspace を使う Vyact の画面" width="100%" />
</p>

## 主な機能

- **文書 RAG とナレッジコレクション:** 文書、メモ、インデックス化したメールをまとめ、質問に関係する箇所を検索。回答の根拠となった原文も確認できます。
- **ローカルモデルの検索と性能テスト:** GGUF / MLX を検索し、サイズや推定メモリ使用量を比較できます。モデル設定の性能テストでは、最初のトークンまでの時間、生成速度、トークン数などを自分の環境で比較します。速度の評価は回答品質の評価とは異なります。
- **Apple Silicon の MLX:** oMLX のメモリ・SSD キャッシュを利用します。対応モデルでは MTP による生成高速化も利用できます。対応状況はモデルとランタイムによって異なります。
- **メモとプロジェクト:** 見出し、リスト、コードなどを含むメモを保存し、プロジェクト単位で会話と指示を整理できます。
- **音声会話:** 音声入力で会話し、外国語を練習できます。音声モードの自動読み上げは初期状態ではオフで、速度は 1〜2 倍に調整できます。
- **MCP とスキル:** 設定の AI ツールから MCP サーバーを接続し、スキルに繰り返し使う指示を保存できます。
- **API サーバー:** 設定の API サーバーから、稼働中のローカルモデルを他のアプリで使うための接続情報を確認できます。トークン認証も設定できます。
- **バックアップ:** 会話、文書、メモ、設定などをエクスポート・復元できます。クラウドバックアップでは保存先の Google Drive / OneDrive アカウントを選択します。OAuth トークンはバックアップに含まれません。
- **多言語 UI:** 日本語、韓国語、英語、中国語、タイ語、ベトナム語、スペイン語、フランス語に対応します。

<p align="center">
  <img src="assets/readme/feature-document-rag.png" alt="Vyact の文書管理と RAG" width="100%" />
</p>

## Chrome 拡張機能

[Chrome ウェブストア](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)からインストールし、Vyact デスクトップアプリを起動した状態でサイドパネルを開きます。

- 現在のページや選択した文章を会話に送り、質問や翻訳に使えます。
- Netflix では二言語字幕、字幕間の移動、繰り返し再生、自動一時停止で語学を練習できます。
- 文章改善では文法修正やトーン調整を行い、変更前後を比較してからコピーできます。

## 独自の LLM に接続する

初期設定で **Custom LLM** を選び、OpenAI 互換の `/chat/completions` API に接続できます。Base URL は `http://localhost:8080/v1` のように指定し、モデル ID と必要に応じて API キーを入力します。ストリーミング、ツール呼び出し、画像入力の対応は接続先によって異なります。

## フィードバック・支援・ライセンス

不具合や質問は [Issues](https://github.com/vyact/vyact/issues) へ。質問のタイトルには `[Question]` を付けてください。開発や翻訳への参加は [貢献ガイド](CONTRIBUTING.md)をご覧ください。脆弱性の報告には [セキュリティポリシー](SECURITY.md)を使用してください。

開発は [Ko-fi](https://ko-fi.com/vyact)、[PayPal](https://paypal.me/vyact)、[Patreon](https://www.patreon.com/cw/vyact) で支援できます。

ソースコードのライセンスは [AGPL-3.0](LICENSE) です。改変版をネットワーク経由で提供する場合には、その対応するソースコードの公開義務があります。Vyact の名前やロゴは別途 [商標ポリシー](TRADEMARKS.md)の対象です。[運営方針](GOVERNANCE.md)も参照してください。
