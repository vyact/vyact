"""
models_config.py - 모델 설정 중앙 관리
"""
import platform

IS_WINDOWS = platform.system() == "Windows"

DEFAULT_MODEL = ""
RECOMMENDED_MODELS: list[dict] = []
IMAGE_MODEL_IDS: set[str] = set()

# =========================
# LLM(Chat) 설정
# =========================

LLM_TEMPERATURE = 0.2

# Local LLM context window
# 입력(Input) + 출력(Output)을 모두 포함한 전체 컨텍스트 크기.
# 모델은 32K KV cache로 준비하고, 요청별 context는 아래 최대값까지
# 32K 단위에서 2배씩 확장한다.
LLM_INITIAL_NUM_CTX = 32768
LLM_MAX_NUM_CTX = 65536 if IS_WINDOWS else 131072
LLM_NUM_CTX = LLM_MAX_NUM_CTX

# Local LLM 최대 출력 토큰
LLM_NUM_PREDICT = 32768

# Claude 최대 출력 토큰
LLM_MAX_TOKENS = 4096

# Sampling
TOP_K = None  # None이면 API에 전달하지 않음 (모델 기본값 사용)
TOP_P = None  # None이면 API에 전달하지 않음 (모델 기본값 사용)

# =========================
# 대화 히스토리 설정
# =========================

# 최근 메시지를 이 토큰 예산까지 포함하여 전송
# (시스템 프롬프트, 현재 질문, RAG Context와 함께 컨텍스트를 공유)
# 256K Context 기준 약 64K를 히스토리로 사용
HISTORY_TOKEN_BUDGET = 32768

# 근사 토큰 환산 (문자 수 / 값)
# tiktoken 없이 사용하는 보수적인 근사값
HISTORY_CHARS_PER_TOKEN = 2.0

# =========================
# BGE-M3 임베딩 설정
# =========================

# BGE-M3의 실제 최대 컨텍스트는 8192 토큰.
# 이보다 큰 컨텍스트를 요청해도 임베딩 모델의 한도를 넘을 수 없다.
# 따라서 입력 길이 계산은 반드시 이 값을 기준으로 해야 한다.
BGE_NUM_CTX = 8192

# =========================
# Elasticsearch 설정
# =========================

# Docker 없이 Elasticsearch 바이너리를 직접 다운로드하여 실행
# (회사 PC 등 Docker 사용이 어려운 환경용)
ES_VERSION = "9.4.3"

ES_DOWNLOAD_BASE = "https://artifacts.elastic.co/downloads/elasticsearch"

ES_ARTIFACTS = {
    # 플랫폼 : (파일명, 압축형식)
    "windows": (
        f"elasticsearch-{ES_VERSION}-windows-x86_64.zip",
        "zip",
    ),
    "darwin-arm64": (
        f"elasticsearch-{ES_VERSION}-darwin-aarch64.tar.gz",
        "tar.gz",
    ),
}
