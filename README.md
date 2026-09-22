<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact logo" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [简体中文](README_ZH.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

### Put your local LLM to work.

Vyact brings local AI into your everyday work. Ask questions about your files, reply to email, work on code, and read, write, or learn in Chrome—all connected to a desktop workspace with the model you choose.

**Apple Silicon Mac · Windows · Linux x64**

Open source. Run models on your computer, with optional cloud providers.

[**Download Vyact**](https://github.com/vyact/vyact/releases/latest) · [**Watch the workflow demo**](https://youtu.be/V3NTHU94lP8)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
  [![Chrome Extension](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
  [![Latest release](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

  [Get started](#start-with-one-document) · [Workflows](#one-workspace-for-everyday-work) · [Desktop](#your-desktop-workspace) · [Chrome extension](#more-than-a-chat-sidebar-vyact-for-chrome) · [Support Vyact](#support-vyact) · [Contributing](CONTRIBUTING.md)
</div>

---

[![Watch the workflow demo](assets/readme/demo-complete-showcase.png)](https://youtu.be/V3NTHU94lP8)

A 3-minute 29-second tour of local AI for everyday work: model selection and performance testing, document Q&A with source verification, email signatures and AI replies, and browser writing corrections. Actual Vyact recordings with fictional demo data; waiting time is trimmed and parts of the document Q&A run at 2× speed. MLX is available on Apple Silicon Macs; benchmark results vary by hardware, model, and settings.

## One workspace for everyday work

### Find the answer—and check the source

Drop a PDF into chat and ask what matters: the key decisions, open questions, or next steps. Open the sources behind the answer to check it against the original. Index documents you use often so you can ask about them again without attaching the same files each time.

**Try it:** “What are the three main risks in this document? Include the supporting passages.”

### Turn an email into a reply you can use

Read a Gmail or Outlook thread alongside your conversation, bring in relevant files, and ask AI to help with the reply. Preview the generated draft, insert it into the email editor, and make your final edits before sending.

**Try it:** “Draft a short reply confirming the next steps and asking about the deadline.”

Google and Microsoft connections are optional and require OAuth app setup. Start with a local document if you want to try Vyact before connecting an account.

### Improve your writing without leaving the page

Check spelling and grammar as you write a post, email, or comment. Open an underlined suggestion to preview the change, then **Apply** or **Dismiss** it. For a bigger rewrite, compare the revised draft with your original before using it.

<p align="center">
  <img src="assets/readme/feature-writing-assistant.png" alt="Vyact Chrome extension showing inline grammar corrections, word suggestions, and an Apply button in a Reddit draft" width="100%" />
</p>

**Requires the Chrome extension and the running Vyact desktop app.** In supported web editors, you choose which corrections to apply; suggestions do not change your text until you apply them.

## Start with one document

1. [Download Vyact](https://github.com/vyact/vyact/releases/latest), install it, and launch the app.
2. Choose **Vyact** for a local model. Use the memory estimate and its color guide to help choose a model, download it, and wait for setup to finish. You can also choose a provider you already use.
3. Attach a PDF in chat and ask: **“Summarize the three main points and show the supporting passages.”**
4. Open the answer’s sources and compare them with the original document.

Initial downloads and setup take time and need an internet connection; response speed depends on your hardware and model. Email connections and the Chrome extension are optional for this first task.

[Installation requirements and platform instructions](#installation-and-connections)

## Your desktop workspace

Keep your documents, conversations, and tools together. Start with one task, then add the connections and capabilities you need.

| Capability | What you can do |
| --- | --- |
| **AI chat** | Chat with local or cloud models, attach files and supported images, and return to past conversations. |
| **Documents and knowledge** | Ask about your files, check the supporting passages, and organize frequently used material into knowledge collections. |
| **Email, cloud files, and calendars** | Work with Gmail, Outlook, Drive, OneDrive, and calendars. Draft replies, bring files into chat, and manage events. |
| **Code work and review** | Connect a project folder, search and edit files with AI, run project checks, and review or undo tracked changes. |
| **Local model selection** | Find GGUF or Apple Silicon MLX models, compare memory estimates, and benchmark supported settings on your computer. |

<details>
<summary><strong>Explore more desktop features</strong></summary>

| Capability | What you can do |
| --- | --- |
| **Projects and project memory** | Group conversations, set working instructions, and review the project summary, decisions, and action items extracted from conversations. |
| **Memos and quick todos** | Write rich-text notes with tables, lists, images, and code blocks. Find notes through knowledge search and track completed todos. |
| **Google Docs, Sheets, Slides, and Forms** | Ask AI to create Docs documents, append text, or find and replace text; read and edit Sheets cells; add slides or find and replace text in Slides; and create Forms surveys, add questions, or read responses. |
| **Browser tasks** | Search the web, read pages, and interact with visible page controls to carry out a task. |
| **Voice and conversation practice** | Speak with AI, listen to responses, and adjust playback. Create practice scripts, choose a role, and practice your lines. |
| **Personal preferences, prompts, and skills** | Choose a response style, review an AI-generated personal profile before applying it, and save system prompts and reusable skills. |
| **MCP tools and local API** | Connect local or remote MCP tools, select tools for a request, and control execution approvals. Use your active local model through an OpenAI-compatible API. |
| **Backup and everyday controls** | Back up and restore selected data locally or through Drive or OneDrive. Use account switching, notifications, keyboard shortcuts, themes, and eight interface languages. |

**More control over your work:** Favorite or export conversations and check token usage and processing speed for each response. Give knowledge collections their own instructions and include documents, memos, or indexed email threads. Manage email attachments, signatures, reusable text, and recipient groups; organize and share cloud files. Choose where downloaded models are stored.

</details>

Google and Microsoft integrations require account setup and permissions. Available AI actions depend on the model’s tool support and the connected service; Google and Microsoft do not expose identical tools.

## More than a chat sidebar: Vyact for Chrome

Use AI on the page you are already reading or writing. **Install the Chrome extension and keep the Vyact desktop app running** to connect these tools to your selected model.

| Capability | What you can do |
| --- | --- |
| **Chat and page questions** | Chat in the side panel, ask about the current page or selected text, and summarize what you are reading. |
| **Writing checks and rewrites** | Preview spelling and grammar corrections or a full-draft rewrite, compare changes, and choose what to apply. |
| **Translate, define, and listen** | Select text on a webpage to open the toolbar, then choose **Detailed**, **Define**, **Listen**, or **Translate** to view a detailed translation, look up a word, hear the selected text, or translate it directly on the page. |
| **Vocabulary and saved sentences** | Look up meanings and pronunciation. Save words with examples and useful sentences with translations and source links. |
| **Netflix learning** | Study with two subtitle tracks, replay or repeat lines, navigate the full script, and ask about subtitles or expressions. |

<details>
<summary><strong>Explore more Chrome features</strong></summary>

| Capability | What you can do |
| --- | --- |
| **Saved pages and flexible chat** | Save a page to Vyact for later knowledge search. Add images or files to side-panel chat, choose a saved prompt, and revisit conversations. |
| **Writing controls** | Turn automatic checks on or off across sites, or disable writing tools on a specific site with the toolbar’s power button. Word suggestions and explanations are optional and off by default. |
| **Rewrite options** | Make a draft more natural, polite, concise, or humorous. Choose an output language, add instructions, and compare before applying or copying. Apply or dismiss individual corrections or all suggestions, and undo applied changes. |
| **Learning controls** | Search, listen to, or remove saved vocabulary and sentences. In Netflix, pause automatically, choose language-specific explanation focus areas such as grammar or nuance, and save useful lines. |
| **Find a Netflix title with AI** | Describe a story or what you want to watch, review suggested titles and reasons, and open a Netflix search for a candidate. |
| **Chrome tasks from desktop chat** | Request browser tasks in Vyact desktop chat. The connected extension carries out page reading, clicks, and typing in Chrome, with a way to pause for sign-in or steps you need to complete yourself. |

</details>

Writing tools work in supported web editors. Netflix learning depends on the subtitle tracks available and loaded for the title; AI title suggestions are not a guarantee of regional catalog availability.

[**Install the Chrome extension**](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)

## A closer look

### Keep notes you can find again

Save plans and decisions as rich-text memos, then ask about them later through your knowledge base.

<p align="center">
  <img src="assets/readme/feature-memo.png" alt="Vyact rich-text memo workspace" width="100%" />
</p>

### Practice a conversation out loud

Have a free conversation or choose a role in a saved practice script. Listen to responses with optional automatic read-aloud and adjustable playback speed.

<p align="center">
  <img src="assets/readme/feature-voice-chat.png" alt="Vyact voice conversation and speaking practice" width="100%" />
</p>

### Understand what you are reading

Summarize an article in the side panel, then look up an unfamiliar word with its pronunciation and an example sentence without leaving the page.

<p align="center">
  <img src="assets/readme/feature-plugin.png" alt="Vyact summarizing a web article beside a word lookup with pronunciation and an example sentence" width="100%" />
</p>

## Choose a local model with confidence

Compare model size and estimated memory use against your computer before downloading; actual memory use depends on the model and settings. Vyact prepares the matching runtime for GGUF models or Apple Silicon MLX models. Public models need no API key; restricted Hugging Face models require an authorized account.

<p align="center">
  <img src="assets/readme/feature-local-models.png" alt="Local model search with system memory and estimated model memory use" width="100%" />
</p>

<details>
<summary>Compare model settings on your hardware</summary>

Open **Model settings > Performance test** to compare supported settings using short inputs, long inputs, and follow-up conversations. Review response time, generation speed, and token counts, then choose **Use these settings** and **Apply** to activate a configuration.

Results compare speed, not answer quality. Completed measurements are kept if you stop; the previous model and settings are restored after the test, with any restoration error reported. Starting a new test replaces that model's previous results.

<p align="center">
  <img src="assets/readme/feature-model-benchmark.png" alt="Model performance results with timings and token counts" width="100%" />
</p>

</details>

## Installation and connections

**Before you download a local model**

Memory and storage needs depend on the model you choose and its context settings. Check the model’s download size and estimated memory use in Vyact before downloading. Leave additional disk space for model runtimes and your documents and search indexes. If running a local model is too demanding for your computer, you can connect an external AI provider instead.

<details>
<summary>Installation requirements and platform instructions</summary>

### Install the desktop app

Download Vyact for **Apple Silicon Macs (M1 or later)**, **Windows**, or **Linux x64** from [GitHub Releases](https://github.com/vyact/vyact/releases), then install and launch it. macOS is distributed as a DMG, Windows as an EXE installer, and Linux as AppImage and DEB packages. Intel-based Macs are not currently supported.

#### Run on Linux

The AppImage runs without installation. From the directory where you downloaded it:

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

On Ubuntu, Debian, or a compatible distribution, install the DEB package instead:

```bash
sudo apt install ./vyact_*_amd64.deb
```

After installing the DEB package, launch **Vyact** from your application menu.

### Before your first launch

Vyact includes Python and prepares app-pinned model runtimes in its own folder. macOS and Windows download the required runtimes automatically; Linux packages include a CPU runtime. Existing users are asked before switching to Vyact-managed runtimes, and runtime version changes require confirmation. Existing system installations are left untouched.

| Platform | Required for the core app | Feature-specific requirements |
| --- | --- | --- |
| macOS (Apple Silicon) | None | **Local GGUF models**<br>• Vyact downloads and manages the pinned runtime automatically<br><br>**Local MLX models**<br>• Vyact installs oMLX in its own environment; macOS 15+ and Git are required<br><br>**Elasticsearch**<br>• No external dependency for native mode; Docker Desktop is optional for container mode<br><br>**Kokoro TTS**<br>• Homebrew is required only when Vyact needs to install `espeak-ng` |
| Windows | None | **Local GGUF models**<br>• Vyact downloads and manages the pinned runtime automatically<br><br>**Elasticsearch**<br>• No external dependency for native mode; Docker Desktop is optional for container mode<br><br>**Kokoro TTS**<br>• `winget` is required only when Vyact needs to install `espeak-ng` |
| Linux (x64) | A glibc 2.35+ x86-64 desktop environment; the DEB package installs its declared desktop-library dependencies through APT | **Local GGUF models**<br>• Bundled CPU runtime<br><br>**Elasticsearch**<br>• No external dependency for native mode; Docker is optional for container mode<br><br>**Browser and Kokoro TTS dependencies**<br>• A supported package manager (`apt-get`, `dnf`, `zypper`, or `pacman`) and a desktop PolicyKit authentication agent are needed when system libraries or `espeak-ng` are missing. Vyact requests authorization with `pkexec`; without it, only passwordless/cached `sudo` authorization is attempted. |

Docker is optional: Vyact can download and run its supported native Elasticsearch distribution for knowledge search. Package managers are needed only when a selected feature requires missing system components.

### Connect a custom LLM provider

Vyact can connect to an API server that implements the OpenAI-compatible `/chat/completions` API. During initial setup, select **Custom LLM**. After installation, you can add or edit connections from the provider controls in the sidebar.

Configure the connection with:

- **Connection name** — A label shown in Vyact.
- **Base URL** — The API root without `/chat/completions`, such as `http://localhost:11434/v1`.
- **API key** — Optional for local servers; required when your endpoint uses bearer authentication.
- **Model ID** — The exact model identifier expected by the API.
- **Additional headers** — Optional headers for gateways or organization-specific authentication.

For example, an existing OpenAI-compatible local server can be connected with:

```text
Connection name: Local LLM
Base URL: http://localhost:8080/v1
API key: (leave blank)
Model ID: my-local-model
Additional headers: (none)
```

Custom connection settings are included in Vyact backup and restore. Streaming, tool calling, and image input depend on the capabilities and OpenAI compatibility of the connected server and model.

### Use the Chrome extension

1. Install [Vyact from the Chrome Web Store](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib).
2. Start the Vyact desktop app.
3. Pin Vyact to the Chrome toolbar and open its side panel on a regular webpage.

</details>

<details>
<summary>Connect accounts, tools, and other apps</summary>

- **Google:** In **Settings > Google**, upload your OAuth credentials JSON and follow the setup guide to connect an account and grant the services you want to use.
- **Microsoft:** In **Settings > Microsoft**, enter the Client ID of your Microsoft Entra app and follow the setup guide. Work or school accounts may require administrator approval.
- **MCP and skills:** Add tools in **Settings > AI Tools** and manage reusable instructions in **Settings > Skills**.
- **Other apps:** In **Settings > API Server**, copy your local model's endpoint, model ID, or OpenClaw configuration. Enable token authentication when needed.

</details>

### Your data, your choice of provider

Choose a Vyact-managed local model to process AI chat context on your computer, or connect OpenAI, Gemini, Claude, or a custom OpenAI-compatible endpoint. When you use an external AI provider, the context needed for the request is sent to that provider. Connected mail and cloud-file services communicate with their own services.

You can choose what to include in backups and save them locally, to Google Drive, or to OneDrive. OAuth tokens are excluded from exported backups.

## Support Vyact

Vyact is independently developed and open source. If it helps with your work, a contribution supports development, testing, and model compatibility. Sharing it with someone who would use it also helps.

<div align="center" markdown="1">

[![Support on Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)
[![Support with PayPal](https://img.shields.io/badge/Support%20with-PayPal-00457c?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/vyact)
[![Support on Patreon](https://img.shields.io/badge/Support%20on-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)

**Thank you for helping Vyact remain independent, open, and actively developed.**
</div>

## Contributing and feedback

Code, documentation, translations, testing, ideas, bug reports, and workflow feedback are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

See [GOVERNANCE.md](GOVERNANCE.md) for project roles and decision-making.

For questions or setup help, open an issue with `[Question]` at the beginning of the title.

For security vulnerabilities, please do **not** open a public issue. Follow our [security policy](SECURITY.md) instead.

## License

Vyact is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

If you modify Vyact and make that modified version available to users over a network—for example as a web app or SaaS—you must make the corresponding source code available under the same license.

## Brand and trademarks

The Vyact name, logo, and official visual brand assets are not granted under the AGPL-3.0 license. You may accurately refer to the official project, but forks and modified versions must use a clearly different name and visual identity. Read the [Vyact Brand and Trademark Policy](TRADEMARKS.md).
