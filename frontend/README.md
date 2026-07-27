# RAG Agent - React + TypeScript + Vite

로컬에서 실행되는 RAG (Retrieval-Augmented Generation) Agent 애플리케이션

## 기술 스택

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **Backend API**: FastAPI (별도 실행 필요)
- **AI Model**: Ollama

## 프로젝트 구조

```
rag-agent/
├── public/                 # 정적 파일
├── src/
│   ├── components/        # React 컴포넌트
│   │   ├── Header/       # 헤더 컴포넌트
│   │   ├── SetupPage/    # 초기 설정 페이지
│   │   ├── MainPage/     # 메인 채팅 페이지
│   │   ├── Sidebar/      # 사이드바 (모델, 히스토리)
│   │   ├── ChatArea/     # 채팅 영역
│   │   ├── ChatInput/    # 채팅 입력
│   │   ├── Message/      # 메시지 컴포넌트
│   │   ├── CodeBlock/    # 코드 블록
│   │   ├── ModelSelector/ # 모델 선택기
│   │   └── LoadingIndicator/ # 로딩 인디케이터
│   ├── services/         # API 서비스
│   │   └── api.ts        # API 클라이언트
│   ├── types/            # TypeScript 타입 정의
│   │   └── index.ts
│   ├── utils/            # 유틸리티 함수
│   │   └── helpers.ts
│   ├── App.tsx           # 최상위 App 컴포넌트
│   ├── main.tsx          # React 엔트리 포인트
│   └── index.css         # 전역 스타일
├── index.html            # HTML 엔트리 포인트
├── vite.config.ts        # Vite 설정
├── tsconfig.json         # TypeScript 설정
└── package.json          # 프로젝트 메타데이터
```

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 개발 서버 실행

```bash
npm run dev
```

기본적으로 `http://localhost:5173` 에서 실행됩니다.

### 3. 프로덕션 빌드

```bash
npm run build
```

빌드된 파일은 `dist/` 폴더에 생성됩니다.

### 4. 프로덕션 미리보기

```bash
npm run preview
```

## API 서버 설정

백엔드 FastAPI 서버가 `http://localhost:8000` 에서 실행되어야 합니다.

Vite 프록시 설정이 되어 있어 `/api/*` 요청은 자동으로 백엔드로 전달됩니다.

## 주요 기능

### 1. 초기 설정 (SetupPage)
- Ollama 모델 선택 및 설치
- 설치 진행 상황 표시

### 2. 채팅 인터페이스 (MainPage)
- AI 모델과 대화
- 코드 블록 자동 파싱 및 복사 기능
- 실시간 응답 스트리밍

### 3. 사이드바 (Sidebar)
- 모델 선택 및 전환
- 최신 뉴스 크롤링 기능
- 대화 기록 관리
- 통계 정보 표시

### 4. 대화 기록
- 자동 저장
- 대화 불러오기
- 대화 삭제

## 컴포넌트 설명

### Header
- 앱 로고 및 타이틀
- 연결 상태 표시

### SetupPage
- 모델 선택 UI
- 설치 진행 상황
- 로그 표시

### MainPage
- 전체 채팅 레이아웃
- Sidebar + ChatArea + ChatInput 조합

### Sidebar
- 모델 선택 드롭다운
- 크롤링 설정 (페이지 수)
- 대화 기록 리스트

### ChatArea
- 메시지 리스트 표시
- 자동 스크롤
- 웰컴 화면

### ChatInput
- 텍스트 입력 (자동 리사이즈)
- Enter로 전송 (Shift+Enter로 줄바꿈)
- 한글 IME 지원

### Message
- 사용자/봇 메시지 구분
- 코드 블록 파싱
- 타임스탬프 표시
- 소스 문서 링크

### CodeBlock
- 언어별 구문 강조
- 복사 버튼
- 복사 완료 피드백

## API 엔드포인트

```typescript
GET  /api/status              // 서버 상태 및 모델 목록
POST /api/install             // 모델 설치
POST /api/pull                // 모델 다운로드
POST /api/chat                // 채팅 메시지 전송
POST /api/crawl               // 뉴스 크롤링
GET  /api/history             // 대화 기록 목록
GET  /api/history/:convId     // 특정 대화 불러오기
DELETE /api/history/:convId   // 대화 삭제
```

## 스타일링

모든 스타일은 CSS Variables를 사용하여 테마 관리:

```css
:root {
  --bg: #0f1117;        // 배경색
  --surface: #1a1d27;   // 표면색
  --accent: #6366f1;    // 강조색
  --text: #e2e8f0;      // 텍스트색
  --muted: #64748b;     // 비활성 텍스트
  ...
}
```

## 개발 팁

### 1. Hot Module Replacement (HMR)
Vite는 자동으로 HMR을 지원하므로 코드 수정 시 브라우저가 자동 새로고침됩니다.

### 2. TypeScript 타입 체크
```bash
npm run lint
```

### 3. 컴포넌트 추가 시
1. `src/components/ComponentName/` 폴더 생성
2. `ComponentName.tsx` 파일 작성
3. `ComponentName.css` 스타일 작성
4. `index.ts` export 파일 생성

## 라이센스

MIT
