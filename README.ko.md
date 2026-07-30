<div align="center">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact 로고" width="120" />

  # Vyact

  ### 대화, 지식, 실행을 하나로 잇는 나만의 AI 워크스페이스

  **파일, 메모, 이메일, 일상 업무 도구를 유용한 AI 문맥으로 바꾸고 한 흐름에서 일하세요.**

  **한국어** · [English](README.md)

  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
  [![Built with FastAPI](https://img.shields.io/badge/backend-FastAPI-009688.svg?style=flat-square)](https://fastapi.tiangolo.com/)
  [![Built with React](https://img.shields.io/badge/frontend-React-61dafb.svg?style=flat-square)](frontend)
  ![Chrome Extension](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)

  [시작하기](#시작하기) · [활용 흐름](#하나의-워크스페이스-다섯-가지-실제-흐름) · [주요 기능](#문맥을-놓치지-않기-위한-모든-기능) · [후원하기](#vyact-후원하기) · [기여하기](CONTRIBUTING.md)
</div>

---

## 이미 업무에는 문맥이 있습니다. AI도 그 문맥을 알아야 합니다.

대부분의 AI 채팅은 같은 번거로움에서 시작합니다. 파일을 찾고, 이메일을 복사하고, 배경을 다시 설명한 다음, AI가 맥락을 놓치지 않았기를 바라야 합니다. Vyact는 업무에서 실제로 중요한 재료를 한곳에 모아, 준비 시간은 줄이고 더 나은 질문을 할 수 있게 합니다.

Vyact는 AI 채팅, 문서 지능, 메모, 그리고 일상 업무 도구를 하나의 집중된 워크스페이스로 모읍니다. 문서를 첨부해 자연어로 질문하고, 답변의 근거 문맥을 확인하고, 메모를 검색 가능한 지식으로 남기고, Gmail·Drive·Calendar·Chrome의 흐름까지 같은 대화 안에서 이어갈 수 있습니다.

Vyact는 Ollama 기반 로컬 LLM을 중심으로 설계했습니다. 대화, 문서, 업무 문맥을 내 환경 안에 두고 로컬 모델을 실제 업무를 위한 워크스페이스로 활용하세요. 필요할 때는 호스팅 모델도 연결할 수 있습니다.

<div align="center">

[![Apple Silicon Mac 및 Windows 다운로드](https://img.shields.io/badge/다운로드-GitHub%20Releases-7c3aed?style=for-the-badge&logo=github&logoColor=white)](https://github.com/vyact/vyact/releases)
[![Patreon으로 후원하기](https://img.shields.io/badge/후원하기-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)

</div>

## 하나의 워크스페이스, 다섯 가지 실제 흐름

### AI 채팅, 파일, Google Workspace를 하나의 화면에서

PDF와 문서를 첨부해 질문하고, 답변을 뒷받침하는 문맥까지 추적하세요. 여러 Google Workspace 계정을 등록하고 업무에 맞게 전환할 수 있습니다. 복사·붙여넣기 대신 Gmail의 메일 본문과 첨부파일, Google Drive 파일을 대화에 바로 가져와 실제 업무 자료를 바탕으로 질문할 수 있습니다. 답장이 필요한 순간에는 같은 문맥을 바탕으로 AI가 메일 초안 작성을 도와줍니다.

<p align="center">
  <img src="assets/readme/feature-ai-workspace.png" alt="문서 문맥과 Google Workspace 패널을 함께 보여주는 Vyact AI 채팅" width="100%" />
</p>

### 문서를 나만의 지식베이스로

문서를 한 번 업로드하고 인덱싱하세요. 일반 채팅에서 질문하면 Vyact가 질문과 가장 관련 있는 문서의 문맥을 자동으로 찾아 LLM 컨텍스트에 포함합니다. 같은 파일을 매번 직접 첨부하지 않아도, 지식베이스를 근거로 답변을 받을 수 있습니다. 관련 문서·메모·인덱싱한 이메일 스레드를 지식 컬렉션으로 묶고, 채팅에서 컬렉션을 선택하면 해당 문맥 안에서만 RAG를 검색할 수 있습니다. 필요할 때는 검색된 출처를 확인해 답변을 검증하세요.

<p align="center">
  <img src="assets/readme/feature-document-rag.png" alt="Vyact 문서 관리 및 RAG 지식베이스" width="100%" />
</p>

### 아이디어를 기록하고 RAG로 다시 찾기

아이디어, 출시 계획, 결정 사항, 다음 할 일을 구조화된 메모로 남기세요. Vyact의 리치 텍스트 메모는 제목, 인용문, 목록, 코드 블록을 지원하므로 업무의 문맥이 채팅 기록 속에 묻히지 않고 정리된 상태로 남습니다. 메모 역시 지식베이스에 인덱싱되어, 일반 대화에서 RAG가 관련 메모를 자동으로 찾아 문맥에 활용합니다.

<p align="center">
  <img src="assets/readme/feature-memo.png" alt="Vyact 리치 텍스트 메모 워크스페이스" width="100%" />
</p>

### 말하면서 익히는 언어 학습

학습하고 싶은 언어로 자연스러운 음성 대화를 연습하세요. Vyact에게 직접 말하고 AI의 응답을 들으며, 단어와 문법을 따로 외우는 데서 그치지 않고 실제 표현을 반복해 말하기 자신감을 키울 수 있습니다.

<p align="center">
  <img src="assets/readme/feature-voice-chat.png" alt="Vyact 음성 대화 및 말하기 연습" width="100%" />
</p>

### Chrome 확장으로 웹을 읽고, 번역하고, 학습하기

Chrome 확장 프로그램으로 외국어 웹페이지를 번역하고, 지금 읽고 있는 내용을 언어 학습에 활용하세요. 현재 페이지 또는 선택한 텍스트를 대화의 문맥으로 바로 추가할 수도 있어, 내용을 직접 복사하지 않고도 사이트에 대해 질문할 수 있습니다.

<p align="center">
  <img src="assets/readme/feature-plugin.png" alt="Vyact Chrome 확장 프로그램 사이드 패널" width="100%" />
</p>

## 문맥을 놓치지 않기 위한 모든 기능

| | 기능 | 활용 방식 |
| --- | --- | --- |
| 💬 | 스트리밍 AI 채팅 | 로컬 또는 호스팅 모델로 빠르고 자연스럽게 대화합니다. |
| 📚 | 파일 첨부·지식 컬렉션·RAG | 문서·메모·인덱싱한 이메일 스레드를 컬렉션으로 묶고, 필요한 문맥 안에서 질문합니다. |
| 🔎 | 출처를 반영한 답변 | 답변에 활용된 문서와 문맥을 직접 검토합니다. |
| 📝 | 리치 텍스트 메모 | 아이디어와 계획을 구조화된 메모로 정리하고, 대화 중 RAG 검색에 활용합니다. |
| 🗂️ | Google Workspace 통합 | 여러 계정을 등록·전환하고 Gmail, Drive, Calendar를 AI 대화와 함께 활용합니다. |
| 🎙️ | 음성 기반 언어 학습 | 음성 입력과 AI 응답으로 자연스러운 대화를 반복하며 말하기를 연습합니다. |
| 🌐 | 언어 학습을 위한 Chrome 확장 | 웹페이지를 번역하고, 탐색 중 학습하며, 선택 텍스트나 현재 페이지 문맥으로 질문합니다. |
| 🧩 | MCP 도구 연결 | 업무에 필요한 도구를 연결해 나에게 맞는 Vyact를 구성합니다. |
| 🌍 | 다국어 인터페이스 | 한국어, 영어, 일본어, 중국어, 태국어, 베트남어, 스페인어, 프랑스어를 지원합니다. |

### 매번 문맥을 다시 만들지 않는 업무 흐름

- **프로젝트와 대화 기록** — 대화를 프로젝트별로 묶고, 프로젝트별 작업 지침을 저장하며, 대화 제목 변경·내보내기·재진입을 지원합니다.
- **한 번 올리고 계속 쓰는 파일** — 파일을 한 대화에만 첨부하거나 장기 지식베이스로 인덱싱할 수 있습니다. 문서·메모·인덱싱한 이메일 스레드를 지식 컬렉션으로 묶어, 작업에 맞는 문맥으로 RAG 범위를 좁힐 수 있습니다. 청크를 확인하고 저장 파일을 관리하며, 필요 없어지면 데이터를 삭제할 수 있습니다.
- **채팅 속으로 사라지지 않는 메모** — 리치 텍스트 메모, 빠른 할 일, 결정 사항을 정리해 두면 필요한 순간 RAG가 다시 찾아줍니다.
- **내 환경에 맞춘 AI 제어** — Ollama, OpenAI, Gemini, Claude 중 선택하고, 컨텍스트·출력·샘플링·임베딩·청킹·모델 메모리 유지 시간을 조정할 수 있습니다.

### 연결한 뒤, 바로 실행까지

- **Gmail** — 메일 검색·조회, 라벨 관리, 메일과 첨부파일의 채팅 연결, AI 답장 초안, 이메일 서명 관리, 발송을 지원합니다.
- **Google Drive** — 파일·폴더 탐색, 검색, 업로드, 다운로드, 이름 변경, 복사, 공유, 채팅 첨부와 지식베이스 인덱싱을 지원합니다.
- **Google Calendar** — 현재 작업을 벗어나지 않고 일정을 조회·생성·수정·삭제할 수 있습니다.
- **내장 Google Workspace 연결** — 앱의 **설정 > MCP 및 AI 도구**에서 Google Workspace를 추가하고 OAuth 자격증명 JSON을 업로드한 뒤 연결하세요. Vyact는 별도의 외부 MCP 서버 프로세스를 거치지 않고, 앱 내부 도구가 OAuth 권한으로 Gmail·Drive·Calendar의 Google API를 직접 호출합니다. OAuth 토큰은 내보내기 백업에 포함하지 않습니다.
- **MCP와 사용자 스킬** — 파일 시스템, GitHub 또는 커스텀 로컬·원격 MCP 서버를 연결할 수 있습니다. 반복 업무에는 재사용 가능한 스킬 지침을 만들 수 있습니다.

### 내 워크스페이스의 주도권을 지키세요

- **기본은 로컬 우선** — Vyact는 Ollama와 로컬 임베딩을 중심으로 설계되어 핵심 업무 문맥을 내 컴퓨터에 둘 수 있습니다.
- **Provider는 내가 선택** — 일상적이고 민감한 작업에는 로컬 모델을 쓰고, 필요할 때 OpenAI·Gemini·Claude를 연결할 수 있습니다.
- **데이터 전송 범위 확인** — Google Workspace에서 가져온 메일·파일 내용을 AI 채팅 문맥으로 사용하면, 선택한 AI 제공자에게 해당 내용이 전달될 수 있습니다. Ollama 같은 로컬 모델을 선택하면 이 채팅 문맥은 외부 AI 제공자에게 전송되지 않습니다.
- **중요한 데이터는 백업** — 대화, 문서, 원본 파일, 메모, 프롬프트, 설정, 프로젝트, 단어장을 내보내고 복원할 수 있으며 Google Drive 백업도 지원합니다.
- **오픈소스** — Vyact는 AGPL-3.0으로 공개됩니다. 의존하는 워크스페이스를 직접 확인하고, 필요에 맞게 개선하며, 기여할 수 있습니다.

## 오늘 바로 시작할 수 있는 활용 예시

| 이런 일을 하고 싶다면 | Vyact에서 이렇게 시작하세요 |
| --- | --- |
| 보고서를 빠르게 이해하고 싶다면 | PDF를 첨부해 핵심 브리핑을 요청한 뒤, 검색된 출처를 열어 답변을 확인하세요. |
| 답하기 어려운 이메일을 처리하고 싶다면 | 이메일 스레드와 관련 Drive 파일을 첨부하고, 내 말투의 답장 초안을 요청한 뒤 Gmail에서 편집·발송하세요. |
| 나만의 업무 기억을 쌓고 싶다면 | 자주 쓰는 문서를 인덱싱하고 결정 사항을 메모로 남기세요. 나중에 평범한 질문만 해도 RAG가 관련 문맥을 찾아줍니다. |
| 프로젝트의 논의를 놓치고 싶지 않다면 | 프로젝트를 만들고 작업 지침을 추가한 뒤 대화를 한곳에 모으세요. 필요하면 대화를 내보내 기록으로 남길 수 있습니다. |
| 매일 외국어 말하기를 연습하고 싶다면 | 음성 채팅을 열어 자연스럽게 말하고 응답을 들으세요. 반복할 표현은 스크립트로 저장해 연습할 수 있습니다. |
| 웹을 보며 조사하고 싶다면 | Chrome에서 선택한 텍스트 또는 현재 페이지를 Vyact로 보내고, 페이지 문맥을 유지한 채 대화를 이어가세요. |

## 시작하기

### 데스크톱 앱 설치하기

[GitHub Releases](https://github.com/vyact/vyact/releases)에서 **Apple Silicon Mac(M1 이후)** 또는 **Windows** 설치 파일을 내려받아 설치한 뒤 Vyact를 실행하세요. Intel Mac은 현재 지원하지 않습니다.

### 처음 실행하기 전 준비

Vyact는 로컬 모델을 중심으로 동작하므로, 처음 앱을 열기 전에 [Ollama](https://ollama.com/download)를 설치하고 **Python 3.12**를 사용할 수 있는지 확인하세요.

| 플랫폼 | 필수 | 선택 |
| --- | --- | --- |
| macOS (Apple Silicon) | Ollama, Python 3.12, [Homebrew](https://brew.sh/) | Docker Desktop |
| Windows | Ollama, Python 3.12 | Docker Desktop, [Chocolatey](https://chocolatey.org/) |

> **Windows:** Python 3.12 설치 시 **“Add python.exe to PATH”** 옵션을 선택하세요.

Docker Desktop은 선택 사항입니다. 처음 실행하면 Vyact가 나머지 구성을 자동으로 준비합니다.

### 처음 5분, 이렇게 시작하세요

1. Vyact를 실행한 뒤 Provider와 모델을 선택합니다. 로컬 우선 환경이라면 Ollama부터 시작하세요.
2. 문서를 끌어다 놓거나 **문서 관리**에서 반복해서 사용할 파일을 인덱싱합니다. 특정 문서·메모·이메일 스레드만 대상으로 RAG를 쓰고 싶다면 지식 컬렉션을 만드세요.
3. 채팅에서 질문하고, 정확도가 중요한 경우 검색된 문맥을 확인합니다.
4. 필요하다면 Google Workspace 또는 Chrome 확장을 연결해 실제 업무 자료를 같은 흐름에 가져옵니다.
5. 반복하는 업무가 생기면 메모, 프로젝트, 재사용 가능한 스킬을 만들어 보세요.

### Chrome 확장 프로그램 사용하기

1. [Chrome 웹 스토어에서 Vyact를 설치합니다](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib).
2. Vyact 데스크톱 앱을 실행합니다.
3. Chrome 툴바에 Vyact를 고정하고, 원하는 페이지에서 사이드 패널을 엽니다.

웹페이지를 번역하고, 탐색하며 외국어를 학습하고, 내용을 복사하지 않고도 현재 페이지에 대해 질문할 수 있습니다.

## Vyact 후원하기

Vyact는 독립적으로 개발되며 오픈소스로 공개됩니다. 투자를 받은 서비스의 로드맵이 아니라, AI가 사용자의 문맥과 함께 일하도록 만드는 데 집중하는 꾸준한 개발로 만들어지고 있습니다.

Vyact가 시간을 조금 아껴주거나, 생각을 더 명확하게 하거나, 로컬 AI를 실제 업무에서 유용하게 만들어 주었다면 후원으로 개발을 함께 이어가 주세요. 후원은 개발, 테스트, 모델 호환성, 문서화, 새로운 업무 흐름 지원에 쓰입니다. 한 번의 후원도 큰 힘이 되며, Vyact가 필요할 사람에게 소개해 주는 것 역시 소중한 도움입니다.

<div align="center">

[![Patreon으로 후원하기](https://img.shields.io/badge/후원하기-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)
[![PayPal로 후원하기](https://img.shields.io/badge/Support%20with-PayPal-00457c?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/vyact)
[![Ko-fi로 후원하기](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)

**Vyact가 독립적이고, 열려 있고, 꾸준히 발전할 수 있도록 도와주셔서 감사합니다.**
</div>

## 기여와 피드백

아이디어, 버그 제보, 업무 흐름에 대한 의견, 문서 개선 제안은 언제나 환영합니다. 이슈를 열기 전에 [CONTRIBUTING.md](CONTRIBUTING.md)를 확인해 주세요.

문의나 설치 도움이 필요하다면, 제목 앞에 `[Question]`을 붙여 이슈를 등록해 주세요.

보안 취약점은 **공개 이슈로 등록하지 마세요.** [보안 정책](SECURITY.md)의 제보 절차를 따라 주세요.

## 라이선스

Vyact는 [GNU Affero General Public License v3.0](LICENSE)(AGPL-3.0)로 배포됩니다.

Vyact를 수정한 뒤 웹 앱이나 SaaS처럼 네트워크를 통해 사용자에게 제공한다면, 해당 수정 버전의 소스 코드 역시 같은 라이선스로 공개해야 합니다.

## 브랜드 및 상표

Vyact 이름, 로고, 공식 시각 브랜드 자산은 AGPL-3.0 라이선스로 허가되지 않습니다. 공식 프로젝트를 정확히 지칭하는 사용은 가능하지만, 포크와 수정 버전에는 Vyact와 명확히 구별되는 이름과 시각적 정체성을 사용해야 합니다. 자세한 내용은 [Vyact 브랜드 및 상표 정책](TRADEMARKS.ko.md)을 확인해 주세요.
