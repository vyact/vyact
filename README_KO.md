<div align="center">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Vyact 로고" width="112" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

### 내 데이터와 웹을 연결하는 로컬 퍼스널 AI 워크스페이스

문서·메일·메모·웹페이지의 맥락을 하나의 AI 작업공간에서 연결합니다.  
로컬 LLM, 문서 RAG, Google·Microsoft 연동, 크롬 확장 기능을 한 앱에서 사용할 수 있습니다.

[**⬇️ Vyact 다운로드 및 설치**](https://github.com/vyact/vyact/releases/latest) · [**🌐 크롬 확장 설치**](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)

</div>

---

## 빠른 설치 안내

> **Apple Silicon Mac(M1 이상)과 Windows를 지원합니다.**  

### 0. 설치 전 준비

#### Mac: 자동 런타임 설치를 위한 Homebrew 준비

Apple Silicon Mac에서 로컬 모델용 런타임을 자동으로 준비하려면 Homebrew 사용을 권장합니다. 필요한 런타임이 아직 없다면 터미널을 열고 아래 명령으로 먼저 설치하세요.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

설치 여부는 다음 명령으로 확인할 수 있습니다.

```bash
brew --version
```

#### Windows: winget 확인

Windows에서 로컬 GGUF 런타임을 자동 설치하려면 `winget`이 필요합니다. Windows 11과 최신 Windows 10에는 일반적으로 App Installer와 함께 제공됩니다.

```powershell
winget --version
```

### 1. 데스크톱 앱 설치

아래 버튼을 눌러 운영체제에 맞는 최신 설치 파일을 다운로드하세요.

<div align="center">

[![Vyact 최신 버전 다운로드](https://img.shields.io/badge/Vyact_최신_버전-다운로드-E27E5C?style=for-the-badge&logo=github&logoColor=white)](https://github.com/vyact/vyact/releases/latest)

</div>

- **Mac:** Apple Silicon(M1 이상)용 설치 파일을 다운로드합니다.
- **Windows:** Windows용 설치 파일을 다운로드합니다.
- 설치 후 Vyact를 실행하고 초기 설정에서 **Vyact 로컬 모델**을 선택합니다.
- 모델 검색 화면에서 내 컴퓨터의 메모리와 예상 사용량을 확인합니다.
- Mac에서는 GGUF 또는 MLX 모델을, Windows에서는 GGUF 모델을 선택해 다운로드합니다.
- 다운로드가 끝나면 Vyact가 로컬 런타임을 준비하고 선택한 모델을 실행합니다.

### 2. 크롬 확장 설치

브라우저에서 페이지 분석·번역과 넷플릭스 언어 학습을 체험하려면 크롬 확장 기능을 설치하세요.

<div align="center">

[![Chrome 확장 설치](https://img.shields.io/badge/Chrome_확장-설치하기-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)

</div>

1. Vyact 데스크톱 앱을 먼저 실행합니다.
2. 크롬 웹스토어에서 Vyact 확장을 설치합니다.
3. 크롬 도구 모음에 Vyact를 고정하고 원하는 웹페이지에서 사이드 패널을 엽니다.
4. 현재 페이지 질문, 선택 문장 설명, 번역 또는 넷플릭스 학습 기능을 사용합니다.

> 크롬 확장의 전체 기능을 이용하려면 Vyact 데스크톱 앱이 실행 중이어야 합니다.

### 3. 모델 준비 후 빠르게 체험하기

모델 다운로드와 최초 런타임 준비에는 네트워크와 컴퓨터 사양에 따라 시간이 걸립니다. 준비가 끝나면 아래 순서로 핵심 기능을 확인하세요.

1. 선택한 로컬 모델로 짧은 질문을 보내 응답을 확인합니다.
2. PDF나 문서를 대화창에 첨부하고 핵심 내용과 근거를 질문합니다.
3. 문서 관리에서 파일을 색인한 뒤 일반 대화에서 관련 내용을 다시 질문해 RAG 검색을 확인합니다.
4. 메일 연동은 선택 사항입니다. 설정의 **Google** 또는 **Microsoft**에서 계정을 연결하면 Gmail·Outlook, Google Drive·OneDrive와 일정을 사용할 수 있습니다.
5. 크롬 확장을 열어 현재 웹페이지를 요약하거나 선택한 문장을 번역·설명받습니다.

---

## Vyact가 해결하는 문제

기존 AI는 문서·메일·메모·웹의 맥락이 서로 단절되어 있어 필요한 자료를 매번 복사하고 다시 설명해야 합니다. 민감한 개인·업무 데이터를 외부 AI 서비스로 보내야 한다는 부담도 있습니다.

Vyact는 흩어진 작업 맥락을 하나의 워크스페이스에 연결합니다. 사용자는 문서와 메일을 직접 첨부하거나 지식베이스로 구성할 수 있고, 로컬 모델을 선택하면 핵심 데이터를 자신의 컴퓨터 안에서 처리할 수 있습니다.

---

## 주요 기능

### 문서와 메일을 함께 이해하는 AI 작업공간

PDF와 문서를 첨부해 질문하고, 답변에 활용된 근거를 확인할 수 있습니다. Gmail·Outlook 메일과 Google Drive·OneDrive 파일을 같은 대화에 연결하고, 필요한 경우 답장 초안 작성까지 이어갈 수 있습니다.

<p align="center">
  <img src="assets/readme/feature-ai-workspace.png" alt="문서와 Gmail을 연결한 Vyact AI 작업공간" width="100%" />
</p>

### Google·Microsoft 업무 도구 연동 (선택)

설정의 **Google**에서는 OAuth 자격증명 JSON으로, **Microsoft**에서는 Entra에 등록한 앱의 Client ID로 계정을 연결합니다. 각 설정 화면의 사전 설정 가이드를 따라 브라우저에서 로그인하세요. Microsoft 앱 등록에는 테넌트와 등록 권한이 필요하며, 회사·학교 계정은 관리자 동의가 필요할 수 있습니다.

연결한 계정은 **G / M** 표시가 있는 목록에서 전환합니다. 메일·파일·일정을 같은 패널에서 확인하고, 클라우드 백업은 선택한 Google Drive 또는 OneDrive 계정에 저장할 수 있습니다. 패널 열기·닫기는 Mac에서 **Cmd+Shift+G**, Windows에서 **Ctrl+Shift+G**입니다.

### 내 컴퓨터에 맞는 로컬 AI 모델 검색·설치

GGUF와 Apple Silicon용 MLX 모델을 앱 안에서 검색하고 비교할 수 있습니다. 모델 크기, 양자화 방식, 최대 컨텍스트와 예상 메모리 사용량을 확인한 뒤 바로 다운로드할 수 있습니다.

<p align="center">
  <img src="assets/readme/feature-local-models.png" alt="Vyact 로컬 모델 검색과 설치" width="100%" />
</p>

#### Apple Silicon에서 MLX 가속이 동작하는 방식

Apple Silicon에서는 텍스트와 비전 MLX 모델을 하나의 oMLX 런타임으로 실행합니다. Prefix KV Memory Cache가 기본으로 활성화되어 반복되는 시스템 프롬프트와 대화 앞부분의 계산 결과를 메모리와 페이지형 SSD 캐시에 재사용합니다. 호환되는 External MTP 모델이 있으면 함께 내려받아 조합을 검증한 뒤 생성 속도를 높이며, 호환 여부는 설치된 oMLX 런타임에서 읽어옵니다. 호환 DFlash 모델은 전용 가속 경로를 사용합니다.

### 내 컴퓨터에서 모델 설정 성능 비교

**모델 설정 > 성능 테스트**에서 GGUF의 성능 모드, KV 캐시 양자화, 지원되는 MTP 조합과 MLX의 지원되는 MTP 조합을 비교할 수 있습니다. 짧은 입력, 긴 입력, 후속 대화를 실행해 첫 토큰 시간, 생성 속도, 전체 응답 시간, 재사용된 프리픽스 토큰과 실제 입출력 토큰 수를 보여줍니다. 엔진이 별도로 제공하는 경우 Prefill 시간과 속도도 표시하며, 제공되지 않는 값은 추정하지 않고 사용할 수 없음으로 표시합니다.

완료된 결과는 세 작업의 첫 토큰 시간과 256개 출력 토큰 기준 생성 시간을 결합한 속도 점수로 정렬됩니다. 이는 답변 품질이나 메모리 절감 효과가 아닌 속도 비교입니다. 원하는 결과의 **이 설정 사용**을 누른 뒤 **적용**하면 설정을 활성화할 수 있습니다. 테스트 완료·취소·실패 후에는 이전 모델과 설정을 복원합니다.

### 문서를 검색 가능한 지식으로 만드는 RAG

문서를 한 번 색인하면 질문과 관련된 구간을 자동으로 찾아 AI 답변의 맥락으로 사용합니다. 문서·메모·이메일을 지식 컬렉션으로 묶고, 실제로 검색된 원문 구간도 확인할 수 있습니다.

<p align="center">
  <img src="assets/readme/feature-document-rag.png" alt="Vyact 문서 RAG와 검색 구간 확인" width="100%" />
</p>

### 아이디어와 결정 사항을 남기고 RAG로 다시 찾기

제목, 인용문, 목록과 코드 블록을 지원하는 리치 텍스트 메모에 아이디어, 계획, 결정과 다음 할 일을 정리할 수 있습니다. 메모도 지식베이스에 색인되므로 일반 대화 중 관련 내용이 자동으로 검색됩니다.

<p align="center">
  <img src="assets/readme/feature-memo.png" alt="Vyact 리치 텍스트 메모 작업공간" width="100%" />
</p>

### 크롬에서 이어지는 AI 작업

현재 페이지나 선택한 문장을 복사하지 않고 Vyact 대화의 맥락으로 보낼 수 있습니다. 페이지 전체 번역, 선택 단어·문장 설명과 출처가 포함된 페이지 분석을 지원합니다.

<p align="center">
  <img src="assets/chrome/feature-web-16-9.png" alt="Vyact 크롬 확장의 페이지 분석" width="100%" />
</p>

### 넷플릭스 기반 언어 학습

원문과 보조 자막을 함께 보고 문장별 이동, 반복 재생과 자동 일시정지를 사용할 수 있습니다. 어려운 문법과 표현은 AI가 학습 수준에 맞춰 설명하며, 시청 중 궁금한 내용을 바로 질문할 수 있습니다.

<p align="center">
  <img src="assets/chrome/wanted-netflix-16-9.png" alt="Vyact 넷플릭스 언어 학습" width="100%" />
</p>

### 페이지를 떠나지 않고 글 다듬기

크롬 확장의 **글쓰기 개선**에서 선택한 문장이나 입력창 전체를 다듬을 수 있습니다. 문법 교정뿐 아니라 자연스럽게, 정중하게, 간결하게, 유머러스하게 같은 스타일을 선택하고 출력 언어와 추가 지시를 지정할 수 있습니다. 수정 전후를 나란히 확인한 뒤 결과를 복사합니다.

<p align="center">
  <img src="assets/readme/feature-writing-assistant.png" alt="Vyact 크롬 확장의 글쓰기 개선 전후 비교" width="100%" />
</p>

### 음성 모드에서 답변 듣기

화면의 텍스트를 읽기 어렵거나 듣는 방식이 더 편한 사용자를 위해, 음성 모드에서 자동 읽기를 제공합니다. 답변이 생성되는 동안 완성된 문장부터 읽어주며, 배속은 1배부터 2배까지 조절할 수 있습니다. 자동 읽기는 기본적으로 꺼져 있고, 마지막으로 설정한 켜기·끄기 상태와 배속을 기억합니다. 답변의 정지 버튼으로 언제든 읽기를 멈출 수 있습니다.

### 음성으로 연습하는 외국어 회화

목표 언어로 말하면 Vyact가 음성을 인식하고 자연스럽게 응답합니다. 고립된 문장을 암기하는 대신 실제 대화 흐름 속에서 표현을 반복 연습할 수 있습니다.

---

## 한눈에 보는 기술 구성

| 영역 | 적용 기술 |
| --- | --- |
| 데스크톱 앱 | Electron, React |
| 백엔드 | FastAPI, Python |
| 로컬 LLM | llama.cpp, llama-swap, MLX |
| 지식 검색 | Elasticsearch, 임베딩, RAG, 리랭커 |
| 음성 입력 | faster-whisper |
| 브라우저 연동 | Chrome Extension, 사이드 패널 |
| 외부 AI | OpenAI, Gemini, Claude, OpenAI 호환 API |
| 업무 도구 | Gmail, Google Drive, Google Calendar, Outlook, OneDrive, Microsoft Calendar |

## 작업 맥락을 유지하는 데 필요한 기능

- **프로젝트와 대화 기록:** 대화를 프로젝트별로 묶고 전용 작업 지침을 설정하며, 대화 이름 변경·내보내기 후 같은 흐름으로 돌아올 수 있습니다.
- **파일과 지식 컬렉션:** 파일을 한 대화에 첨부하거나 장기 지식으로 색인하고, 문서·메모·이메일을 컬렉션으로 묶어 RAG 범위를 좁힐 수 있습니다.
- **AI 선택권:** 로컬 llama.cpp·MLX, OpenAI, Gemini, Claude 또는 OpenAI 호환 엔드포인트를 선택하고 컨텍스트·출력·샘플링·임베딩·청킹 설정을 조절합니다.
- **Google·Microsoft 작업:** Gmail·Outlook, Google Drive·OneDrive와 일정을 대화 옆에서 사용하고 여러 계정을 하나의 전환 목록에서 관리합니다.
- **로컬 OpenAI 호환 API:** **설정 > API 서버**에서 네트워크 주소, 활성 모델 ID, OpenClaw 설정과 curl 예제를 복사하고 선택적으로 Bearer 토큰 인증을 적용합니다.
- **MCP와 재사용 가능한 스킬:** **설정 > AI 도구**에서 파일시스템, GitHub 또는 로컬·원격 MCP 서버를 연결하고, 반복 지침은 **설정 > 스킬**에서 관리합니다.
- **백업:** 대화, 문서, 파일, 메모, 프롬프트, 설정, 제공자 연결, 프로젝트와 단어장을 내보내고 복원합니다. OAuth 토큰은 백업에 포함되지 않습니다.
- **오픈 소스:** AGPL-3.0으로 공개되어 코드를 검토하고 수정하며 기여할 수 있습니다.

## 오늘 바로 시작할 수 있는 작업

| 하고 싶은 일 | Vyact에서 해볼 방법 |
| --- | --- |
| 보고서 빠르게 이해하기 | PDF를 첨부해 요약을 요청한 뒤 검색된 근거를 확인합니다. |
| 어려운 메일에 답장하기 | 메일과 관련 파일을 첨부해 초안을 만들고 Gmail 또는 Outlook에서 수정해 보냅니다. |
| 개인 업무 기억 만들기 | 자주 쓰는 문서를 색인하고 결정을 메모로 남겨 다음 대화에서 RAG로 찾습니다. |
| 프로젝트 맥락 유지하기 | 프로젝트와 작업 지침을 만들고 관련 대화를 한곳에 모읍니다. |
| 매일 외국어 연습하기 | 음성 대화를 열거나 넷플릭스 이중 자막과 맞춤 설명으로 학습합니다. |
| 로컬 모델 설정 비교하기 | 성능 테스트에서 조합별 결과를 비교하고 원하는 설정을 적용합니다. |
| 웹을 보며 조사하기 | 선택한 문장이나 현재 페이지를 크롬에서 바로 Vyact로 보냅니다. |

---

## 지원 환경과 참고 사항

- **macOS:** Apple Silicon(M1 이상)을 지원합니다. Intel Mac은 현재 지원하지 않습니다.
- **Windows:** Windows용 설치 파일을 제공합니다.
- macOS에서는 Homebrew를 통해 GGUF용 `llama.cpp`·`llama-swap`과 MLX용 oMLX 런타임을 설치합니다.
- Windows에서는 `winget`을 통해 GGUF용 `llama.cpp`와 `llama-swap`을 설치합니다.
- 로컬 모델의 실행 가능 여부와 속도는 컴퓨터 메모리와 선택한 모델 크기에 따라 달라집니다.
- 연결한 메일·클라우드 파일을 외부 AI 제공자와 함께 사용하면 해당 내용이 선택한 제공자로 전송될 수 있습니다. Vyact가 관리하는 로컬 모델을 사용하면 대화 맥락을 외부 AI 제공자에게 보내지 않습니다.

---

## 바로 시작하기

<div align="center">

[![데스크톱 앱 다운로드](https://img.shields.io/badge/1._데스크톱_앱-다운로드-E27E5C?style=for-the-badge)](https://github.com/vyact/vyact/releases/latest)
[![Chrome 확장 설치](https://img.shields.io/badge/2._Chrome_확장-설치-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)

</div>

설치 중 문제가 발생하면 GitHub 저장소의 [Issues](https://github.com/vyact/vyact/issues)에 실행 환경과 오류 내용을 남겨주세요.

### 사용자 지정 LLM 제공자 연결

OpenAI 호환 `/chat/completions` API 서버에 연결할 수 있습니다. 초기 설정에서 **Custom LLM**을 선택하거나 설치 후 사이드바의 제공자 관리에서 연결 이름, `/chat/completions`를 제외한 Base URL, 선택적 API 키, 정확한 모델 ID와 추가 헤더를 설정하세요. 스트리밍, 도구 호출과 이미지 입력 지원 여부는 연결한 서버와 모델에 따라 달라집니다.

### 크롬 확장 사용

1. [Chrome 웹 스토어](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)에서 Vyact를 설치합니다.
2. Vyact 데스크톱 앱을 실행합니다.
3. 확장을 도구 모음에 고정하고 원하는 페이지에서 사이드 패널을 엽니다.

## 기여와 피드백

코드, 문서, 번역, 테스트, 아이디어, 버그 보고와 사용 흐름에 대한 의견을 환영합니다. 기여 전 [기여 가이드](CONTRIBUTING.md)를 읽어주세요. 프로젝트 역할과 공개 의사결정 방식은 [운영 원칙](GOVERNANCE.md), 커뮤니티 계획은 [커뮤니티 로드맵](COMMUNITY_ROADMAP.md)에서 확인할 수 있습니다. 보안 취약점은 공개 이슈 대신 [보안 정책](SECURITY.md)에 따라 제보해 주세요.

## 라이선스

Vyact는 [GNU Affero General Public License v3.0](LICENSE)(AGPL-3.0)으로 배포됩니다. 수정한 Vyact를 웹 앱이나 SaaS처럼 네트워크를 통해 제공하는 경우 같은 라이선스에 따라 해당 소스 코드를 공개해야 합니다.

## 브랜드와 상표

Vyact 이름, 로고와 공식 시각 자산은 AGPL-3.0 라이선스에 포함되지 않습니다. 공식 프로젝트를 정확히 지칭할 수 있지만 포크와 수정 버전은 명확히 다른 이름과 시각적 정체성을 사용해야 합니다. 자세한 내용은 [Vyact 브랜드 및 상표 정책](TRADEMARKS.md)을 확인하세요.
