<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact 标志" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [简体中文](README_ZH.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

### 让本地大语言模型，真正帮你做事。

Vyact 将本地 AI 融入日常工作。在桌面工作空间中，使用自己选择的模型向文件提问、回复邮件、处理代码，还能在 Chrome 中阅读、写作和学习。

**Apple Silicon Mac · Windows · Linux x64**

开源。在自己的电脑上运行模型，也可按需选择云端 AI 服务。

[**下载 Vyact**](https://github.com/vyact/vyact/releases/latest) · [**观看工作流程演示**](https://youtu.be/V3NTHU94lP8)

[![许可证：AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
[![Chrome 扩展](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
[![最新版本](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

[快速开始](#从一份文档开始) · [工作流程](#一个工作空间处理日常工作) · [桌面应用](#你的桌面工作空间) · [Chrome 扩展](#不只是聊天侧边栏vyact-chrome-扩展) · [支持 Vyact](#支持-vyact) · [参与贡献](CONTRIBUTING.md)
</div>

---

[![观看工作流程演示](assets/readme/demo-complete-showcase.png)](https://youtu.be/V3NTHU94lP8)

用 3 分 29 秒了解如何将本地 AI 用于日常工作：模型选择与性能测试、带来源核验的文档问答、邮件签名与 AI 回复，以及浏览器写作纠错。视频为 Vyact 实际操作录屏，使用虚构演示数据；已剪去等待时间，部分文档问答以 2 倍速播放。MLX 适用于 Apple Silicon Mac；性能测试结果因硬件、模型和设置而异。

## 一个工作空间，处理日常工作

### 找到答案，也能核对来源

将 PDF 拖入聊天，询问你关心的内容：关键决策、待解决的问题或下一步行动。打开答案引用的来源，与原文核对。为常用文档建立索引，之后即可再次提问，无需每次重复添加同一文件。

**试试看：**“这份文档中最主要的三个风险是什么？请附上作为依据的原文段落。”

### 把一封邮件变成可用的回复

在对话旁阅读 Gmail 或 Outlook 邮件会话，加入相关文件，让 AI 协助回复。先预览生成的草稿，再插入邮件编辑器，完成最后的修改后发送。

**试试看：**“起草一封简短的回复，确认下一步安排，并询问截止日期。”

Google 和 Microsoft 连接为可选功能，需要配置 OAuth 应用。如果想先试用 Vyact，可以从本地文档开始，无需连接账号。

### 不离开当前页面，改善你的表达

撰写帖子、邮件或评论时，检查拼写和语法。打开带下划线的建议预览修改，再选择**应用**或**忽略**。需要较大幅度的改写时，可以先对比原文与修改稿，再决定是否使用。

<p align="center">
  <img src="assets/readme/feature-writing-assistant.png" alt="Vyact Chrome 扩展在 Reddit 草稿中显示行内语法纠错、用词建议和应用按钮" width="100%" />
</p>

**需要安装 Chrome 扩展，并保持 Vyact 桌面应用运行。** 在支持的网页编辑器中，由你决定应用哪些修改；在你应用建议前，原文不会被更改。

## 从一份文档开始

1. [下载 Vyact](https://github.com/vyact/vyact/releases/latest)，安装并启动应用。
2. 选择 **Vyact** 使用本地模型。参考预计内存用量和颜色提示选择模型，下载后等待配置完成。也可以选择你已在使用的 AI 服务提供商。
3. 在聊天中添加 PDF，并提问：**“总结三个要点，并展示作为依据的原文段落。”**
4. 打开答案的来源，与原始文档核对。

首次下载和配置需要时间及网络连接；响应速度取决于硬件和模型。完成这项初次体验无需连接邮箱或安装 Chrome 扩展。

[安装要求与各平台说明](#安装与连接)

## 你的桌面工作空间

将文档、对话和工具放在一起。从一项任务开始，再按需添加连接和功能。

| 功能 | 可以做什么 |
| --- | --- |
| **AI 聊天** | 与本地或云端模型对话，添加文件及支持的图片，并回看历史对话。 |
| **文档与知识管理** | 针对文件提问，核验原文依据，并将常用资料整理为知识集合。 |
| **邮件、云端文件与日历** | 连接 Gmail、Outlook、Drive、OneDrive 和日历，起草回复、将文件加入聊天并管理日程。 |
| **代码工作与审查** | 连接项目文件夹，让 AI 搜索和编辑文件、运行项目检查，并审查或撤销已跟踪的修改。 |
| **本地模型选择** | 查找 GGUF 或 Apple Silicon MLX 模型，对比预计内存用量，并在自己的电脑上测试支持的设置。 |

<details>
<summary><strong>查看更多桌面功能</strong></summary>

| 功能 | 可以做什么 |
| --- | --- |
| **项目与项目记忆** | 归类对话、设置工作指令并连接代码文件夹。查看和管理从对话中提取的项目摘要、决策及待办事项。 |
| **备忘录与快捷待办** | 创建包含表格、列表、图片和代码块的富文本笔记。通过 RAG 检索笔记，并记录、勾选快捷待办。 |
| **Google 文档、表格、幻灯片与表单** | 让 AI 创建 Docs 文档、追加文本或查找替换文本；读取和编辑 Sheets 单元格；在 Slides 中添加幻灯片或查找替换文本；创建 Forms 表单、添加问题或读取回复。 |
| **浏览器任务** | 让 AI 搜索网页、阅读页面并操作可见的页面控件。从搜索结果继续前往任务所需的页面并执行操作。 |
| **语音与对话练习** | 与 AI 语音交流，听取回复并调整语音播放。创建或编辑练习脚本，选择角色，听对方说话，再练习自己的台词。 |
| **个人偏好与提示词** | 选择回复风格，在应用前审阅 AI 生成的个人资料，并保存系统提示词和可复用的技能。 |
| **MCP 工具与本地 API** | 连接本地或远程 MCP 工具，为请求选择工具并控制执行审批。通过兼容 OpenAI 的 API，在其他应用中使用当前运行的本地模型。 |
| **备份与日常设置** | 将选定的工作空间数据备份到本地、Drive 或 OneDrive，并从中恢复。支持账号切换、通知、键盘快捷键、浅色/深色主题和八种界面语言。 |

**更多管理选项：** 收藏或导出对话，查看每次回复的 token 用量和处理速度。为知识集合设置专属指令，并加入文档、备忘录和已索引的邮件会话。管理邮件附件、签名、常用文本和收件人分组，整理和共享云端文件，并选择模型下载位置。

</details>

Google 和 Microsoft 集成需要配置账号并授予权限。可用的 AI 操作取决于模型的工具支持及所连接的服务；Google 与 Microsoft 提供的工具并不完全相同。

## 不只是聊天侧边栏：Vyact Chrome 扩展

在正在阅读或写作的页面上使用 AI。**安装 Chrome 扩展，并保持 Vyact 桌面应用运行**，即可将这些工具连接到你选择的模型。

| 功能 | 可以做什么 |
| --- | --- |
| **聊天与页面问答** | 在侧边栏聊天，针对当前页面或选中文本提问，并总结正在阅读的内容。 |
| **写作检查与改写** | 预览拼写、语法建议或整篇改写，对比前后差异，再选择要应用的修改。 |
| **翻译、查词与朗读** | 选中网页文字后，在工具栏中选择 **详细翻译**、**查词**、**朗读** 或 **翻译**，查看详细译文、查询词义、听取选中文本，或直接在页面上显示翻译。 |
| **词汇与句子收藏** | 查询词义和发音，连同例句保存单词，并收藏带翻译和来源链接的实用句子。 |
| **Netflix 学习** | 使用双语字幕学习，重播或循环播放台词，浏览完整字幕脚本，并询问字幕或表达的含义。 |

<details>
<summary><strong>查看更多 Chrome 功能</strong></summary>

| 功能 | 可以做什么 |
| --- | --- |
| **页面问答、摘要与知识保存** | 将当前页面或选中文本加入聊天，总结页面，或保存到 Vyact，供之后进行知识检索。 |
| **写作设置** | 在检查设置中开启或关闭自动检查，该设置对所有网站生效。也可单独使用工具栏的电源按钮，在特定网站禁用写作工具。用词建议和解释为可选项，默认关闭。 |
| **整篇草稿改写** | 让草稿更自然、礼貌、简洁或幽默，或纠正语法。选择输出语言并补充要求，对比后再应用或复制。 |
| **Netflix 跟读练习** | 使用双语字幕学习，切换台词、重播或循环播放单句，并自动暂停。打开完整字幕脚本，跳转到指定句子。 |
| **按需理解 Netflix 字幕** | 针对当前字幕或选中的表达提问。按语言选择习语、连读、语法或语气等学习重点，并保存实用台词。 |
| **用 AI 寻找 Netflix 影片** | 描述剧情或想看的内容，查看推荐片名及理由，再打开 Netflix 搜索候选影片。 |
| **从桌面聊天发起 Chrome 任务** | 在 Vyact 桌面聊天中提出浏览器任务。连接的扩展会在 Chrome 中读取页面、点击和输入；遇到登录等需要你亲自完成的步骤时，可以暂停。 |

</details>

写作工具适用于受支持的网页编辑器。Netflix 学习功能取决于影片可用且已加载的字幕轨道；AI 推荐影片不代表该影片一定在你所在地区上架。

[**安装 Chrome 扩展**](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)

## 进一步了解

### 记下内容，也能再次找到

将计划和决策保存为富文本备忘录，之后通过知识库提问并找回相关内容。

<p align="center">
  <img src="assets/readme/feature-memo.png" alt="Vyact 富文本备忘录工作空间" width="100%" />
</p>

### 开口练习对话

自由交谈，或在已保存的练习脚本中选择角色。可开启自动朗读并调整播放速度，听取回复。

<p align="center">
  <img src="assets/readme/feature-voice-chat.png" alt="Vyact 语音对话与口语练习" width="100%" />
</p>

### 读懂眼前的内容

在侧边栏总结文章，无需离开页面即可查询生词、发音和例句。

<p align="center">
  <img src="assets/readme/feature-plugin.png" alt="Vyact 在网页旁总结文章，并显示单词释义、发音和例句" width="100%" />
</p>

## 更有把握地选择本地模型

下载前，根据电脑配置比较模型大小和预计内存用量；实际内存占用取决于模型及设置。Vyact 会为 GGUF 模型或 Apple Silicon MLX 模型准备匹配的运行时。公开模型无需 API 密钥；受限的 Hugging Face 模型需要具备访问权限的账号。

<p align="center">
  <img src="assets/readme/feature-local-models.png" alt="本地模型搜索界面，显示系统内存和模型预计内存用量" width="100%" />
</p>

<details>
<summary>在自己的硬件上比较模型设置</summary>

打开**模型设置 > 性能测试**，使用短输入、长输入和连续对话比较支持的设置。查看响应时间、生成速度和 token 数，再选择**使用这些设置**和**应用**，启用所选配置。

测试比较的是速度，而非回答质量。停止测试时，已完成的测量结果会保留；测试结束后会恢复之前的模型和设置，并报告任何恢复错误。开始新测试会替换该模型之前的测试结果。

<p align="center">
  <img src="assets/readme/feature-model-benchmark.png" alt="模型性能测试结果，包含耗时和 token 数" width="100%" />
</p>

</details>

## 安装与连接

**下载本地模型之前**

所需内存和存储空间取决于选择的模型及其上下文设置。下载前，请在 Vyact 中查看模型的下载大小和预计内存用量，并为模型运行时、文档及搜索索引预留额外空间。如果电脑运行本地模型较吃力，也可以连接外部 AI 提供商。

<details>
<summary>安装要求与各平台说明</summary>

### 安装桌面应用

从 [GitHub Releases](https://github.com/vyact/vyact/releases) 下载适用于 **Apple Silicon Mac（M1 或更新芯片）**、**Windows** 或 **Linux x64** 的 Vyact，安装并启动。macOS 提供 DMG，Windows 提供 EXE 安装程序，Linux 提供 AppImage 和 DEB 软件包。目前不支持 Intel Mac。

#### 在 Linux 上运行

AppImage 无需安装即可运行。在下载目录中执行：

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

在 Ubuntu、Debian 或兼容发行版上，也可安装 DEB 软件包：

```bash
sudo apt install ./vyact_*_amd64.deb
```

安装 DEB 软件包后，从应用菜单启动 **Vyact**。

### 首次启动前

Vyact 内置 Python，并在专用文件夹中准备应用指定版本的模型运行时。macOS 和 Windows 会自动下载所需运行时，Linux 软件包内置 CPU 运行时。已有用户迁移到 Vyact 管理的运行时前会收到确认提示，运行时版本变更也需用户同意。已有的系统安装不会被修改。

| 平台 | 核心应用要求 | 特定功能要求 |
| --- | --- | --- |
| macOS（Apple Silicon） | 无 | **本地 GGUF 模型**<br>• Vyact 自动下载并管理固定版本的运行时<br><br>**本地 MLX 模型**<br>• Vyact 在专用环境中安装 oMLX；需要 macOS 15 或更新版本及 Git<br><br>**Elasticsearch**<br>• 原生模式无需外部依赖；容器模式可选用 Docker Desktop<br><br>**Kokoro TTS**<br>• 仅当 Vyact 需要安装 `espeak-ng` 时才需要 Homebrew |
| Windows | 无 | **本地 GGUF 模型**<br>• Vyact 自动下载并管理固定版本的运行时<br><br>**Elasticsearch**<br>• 原生模式无需外部依赖；容器模式可选用 Docker Desktop<br><br>**Kokoro TTS**<br>• 仅当 Vyact 需要安装 `espeak-ng` 时才需要 `winget` |
| Linux（x64） | 使用 glibc 2.35 或更新版本的 x86-64 桌面环境；DEB 软件包通过 APT 安装其声明的桌面库依赖 | **本地 GGUF 模型**<br>• 内置 CPU 运行时<br><br>**Elasticsearch**<br>• 原生模式无需外部依赖；容器模式可选用 Docker<br><br>**浏览器与 Kokoro TTS 依赖**<br>• 缺少系统库或 `espeak-ng` 时，需要受支持的包管理器（`apt-get`、`dnf`、`zypper` 或 `pacman`）和桌面 PolicyKit 身份验证代理。Vyact 通过 `pkexec` 请求授权；若不可用，则仅尝试免密或已缓存的 `sudo` 授权。 |

Docker 为可选项：Vyact 可以下载并运行受支持的原生 Elasticsearch 发行版，用于知识检索。只有所选功能缺少必要系统组件时，才需要使用包管理器。

### 连接自定义 LLM 服务

Vyact 可以连接实现了 OpenAI 兼容 `/chat/completions` API 的服务器。在初始配置时选择**自定义 LLM**。安装后，也可通过侧边栏的服务提供商控件添加或编辑连接。

连接配置包括：

- **连接名称** — 在 Vyact 中显示的名称。
- **基础 URL** — 不包含 `/chat/completions` 的 API 根地址，例如 `http://localhost:11434/v1`。
- **API 密钥** — 本地服务器可不填；端点使用 Bearer 身份验证时必须填写。
- **模型 ID** — API 要求的准确模型标识符。
- **附加请求头** — 可选，用于网关或组织专用身份验证。

例如，可按以下配置连接已有的 OpenAI 兼容本地服务器：

```text
连接名称：Local LLM
基础 URL：http://localhost:8080/v1
API 密钥：（留空）
模型 ID：my-local-model
附加请求头：（无）
```

自定义连接设置包含在 Vyact 的备份与恢复范围内。流式输出、工具调用和图片输入取决于所连接服务器及模型的能力和 OpenAI 兼容程度。

### 使用 Chrome 扩展

1. 从 [Chrome 应用商店安装 Vyact](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)。
2. 启动 Vyact 桌面应用。
3. 将 Vyact 固定到 Chrome 工具栏，在普通网页上打开其侧边栏。

</details>

<details>
<summary>连接账号、工具与其他应用</summary>

- **Google：** 在**设置 > Google** 中上传 OAuth 凭据 JSON 文件，按照配置指南连接账号，并授权要使用的服务。
- **Microsoft：** 在**设置 > Microsoft** 中输入 Microsoft Entra 应用的客户端 ID，并按照配置指南操作。工作或学校账号可能需要管理员批准。
- **MCP 与技能：** 在**设置 > AI 工具**中添加工具，在**设置 > 技能**中管理可复用的指令。
- **其他应用：** 在**设置 > API 服务器**中复制本地模型的端点、模型 ID 或 OpenClaw 配置。按需启用令牌身份验证。

</details>

### 你的数据，由你选择 AI 服务

选择由 Vyact 管理的本地模型，在自己的电脑上处理 AI 聊天上下文；也可连接 OpenAI、Gemini、Claude 或自定义的 OpenAI 兼容端点。使用外部 AI 服务时，请求所需的上下文会发送给该服务提供商。已连接的邮件和云端文件功能会与各自的服务通信。

你可以选择备份内容，并保存到本地、Google Drive 或 OneDrive。导出的备份不包含 OAuth 令牌。

## 支持 Vyact

Vyact 是独立开发的开源项目。如果它对你的工作有帮助，你的支持将用于开发、测试和模型兼容性改进。将它分享给可能需要的人，同样是一种支持。

<div align="center" markdown="1">

[![通过 Ko-fi 支持](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)
[![通过 PayPal 支持](https://img.shields.io/badge/Support%20with-PayPal-00457c?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/vyact)
[![通过 Patreon 支持](https://img.shields.io/badge/Support%20on-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)

**感谢你帮助 Vyact 保持独立、开放，并持续开发。**
</div>

## 参与贡献与反馈

欢迎贡献代码、文档、翻译、测试、想法、问题报告和工作流程反馈。参与前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

项目角色与决策方式请参阅 [GOVERNANCE.md](GOVERNANCE.md)。

如有疑问或需要配置帮助，请创建 Issue，并在标题开头添加 `[Question]`。

如发现安全漏洞，请**不要**创建公开 Issue，而应遵循我们的[安全政策](SECURITY.md)。

## 许可证

Vyact 采用 [GNU Affero 通用公共许可证 v3.0](LICENSE)（AGPL-3.0）。

如果你修改 Vyact，并通过网络向用户提供修改后的版本，例如作为 Web 应用或 SaaS，则必须按照同一许可证提供相应的源代码。

## 品牌与商标

Vyact 名称、标志及官方视觉品牌素材不在 AGPL-3.0 许可授权范围内。你可以准确地指代官方项目，但分支项目和修改版本必须使用明确不同的名称与视觉标识。请阅读 [Vyact 品牌与商标政策](TRADEMARKS.md)。
