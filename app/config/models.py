"""
models_config.py - 모델 설정 중앙 관리
"""
import platform

# MLX 빌드는 Apple Silicon 전용이다. 그 밖의 환경에서는 Ollama의 일반 빌드를 사용한다.
IS_MLX_SUPPORTED = (
        platform.system() == "Darwin"
        and platform.machine().lower() in {"arm64", "aarch64"}
)
IS_WINDOWS = platform.system() == "Windows"
DEFAULT_MODEL = "gemma4:e2b-mlx" if IS_MLX_SUPPORTED else "gemma4:e2b"

# 모델 타입 상수
MODEL_TYPE_CHAT = "chat"  # 일반 대화
MODEL_TYPE_IMAGE_GEN = "image_gen"  # 텍스트→이미지 생성 전용
MODEL_TYPE_IMAGE_EDIT = "image_edit"  # 이미지 입력+편집+생성 (멀티모달)

# Windows에서는 지원하지 않는 이미지 모델
IMAGE_MODELS = [
    {
        "id": "x/flux2-klein:9b",
        "name": "FLUX.2 Klein (4B/9B)",
        "type": MODEL_TYPE_IMAGE_EDIT,
        "desc": "Black Forest Labs의 이미지 생성·편집 모델 · VRAM 16GB 이상 권장 · 텍스트-이미지 및 참조 이미지 편집 지원"
    },
    {
        "id": "x/z-image-turbo:latest",
        "name": "Z-Image Turbo (6B)",
        "type": MODEL_TYPE_IMAGE_GEN,
        "desc": "Alibaba의 실사 이미지 생성 모델 · VRAM 12GB 이상 권장 · 영어·중국어 텍스트 렌더링 최적화"
    },
]

# Windows에서는 이미지 모델을 기본 목록에 포함하지 않는다.
RECOMMENDED_MODELS = [] if IS_WINDOWS else list(IMAGE_MODELS)

WINDOWS_CHAT_MODELS = [
    {
        "id": "gemma4:e2b",
        "name": "Gemma 4 E2B (Effective 2B)",
        "type": MODEL_TYPE_CHAT,
        "desc": "Google DeepMind의 초경량 모델 · Windows용 Ollama 일반 빌드 · Text·Image 입력 지원 · 빠른 추론·간단한 코딩·멀티모달 작업에 적합"
    },
    {
        "id": "gemma4:e4b",
        "name": "Gemma 4 E4B (Effective 4B)",
        "type": MODEL_TYPE_CHAT,
        "desc": "Google DeepMind의 경량 모델 · Windows용 Ollama 일반 빌드 · Text·Image 입력 지원 · 가벼운 추론·코딩·멀티모달 작업에 적합"
    },
    {
        "id": "gemma4:12b",
        "name": "Gemma 4 12B",
        "type": MODEL_TYPE_CHAT,
        "desc": "Google DeepMind의 범용 모델 · Windows용 Ollama 일반 빌드 · Text·Image 입력 지원 · 추론·코딩·에이전트 작업에 적합"
    },
]

MLX_CHAT_MODELS = [
    {
        "id": "gemma4:e2b-mlx",
        "name": "Gemma 4 E2B MLX (Effective 2B)",
        "type": MODEL_TYPE_CHAT,
        "desc": "Google DeepMind의 초경량 엣지용 모델 · Apple Silicon(MLX) 최적화 · 약 6.5GB · 128K 컨텍스트 · Text·Image 입력 지원 · 빠른 추론·번역·일반 대화·경량 에이전트 작업에 적합"
    },
    {
        "id": "gemma4:e4b-mlx",
        "name": "Gemma 4 E4B MLX (Effective 4B)",
        "type": MODEL_TYPE_CHAT,
        "desc": "Google DeepMind의 엣지용 모델 · Apple Silicon(MLX) 최적화 · 약 8.8GB · 128K 컨텍스트 · Text·Image 입력 지원 · 경량 환경의 추론·코딩·멀티모달 작업에 적합"
    },
    {
        "id": "gemma4:12b-mlx",
        "name": "Gemma 4 12B MLX",
        "type": MODEL_TYPE_CHAT,
        "desc": "Google DeepMind의 워크스테이션용 모델 · Apple Silicon(MLX) 최적화 · 약 7.7GB · 256K 컨텍스트 · Text·Image 입력 지원 · 추론·코딩·에이전트 작업에 적합"
    },
    {
        "id": "gemma4:26b-mlx",
        "name": "Gemma 4 26B A4B MoE MLX",
        "type": MODEL_TYPE_CHAT,
        "desc": "Google DeepMind의 워크스테이션용 MoE 모델 · Apple Silicon(MLX) 최적화 · 약 18GB · 256K 컨텍스트 · Text·Image 입력 지원 · 128개 Expert 중 8개 활성화 · 고급 추론·코딩·에이전트 작업에 적합"
    },
    {
        "id": "laguna-xs-2.1:nvfp4",
        "name": "Laguna XS 2.1 NVFP4 MLX",
        "type": MODEL_TYPE_CHAT,
        "desc": "Poolside의 에이전트 코딩용 MoE 모델 · Apple Silicon(MLX) 최적화 · 약 19GB · 256K 컨텍스트 · Text 입력 지원 · 총 33B 중 3B 활성화 · 장기 추론·코딩·에이전트 작업에 적합"
    },
]

RECOMMENDED_MODELS.extend(MLX_CHAT_MODELS if IS_MLX_SUPPORTED else WINDOWS_CHAT_MODELS)

# 이미지 생성 관련 모델 id 집합 (빠른 조회용)
IMAGE_MODEL_IDS = {
    m["id"] for m in RECOMMENDED_MODELS
    if m["type"] in (MODEL_TYPE_IMAGE_GEN, MODEL_TYPE_IMAGE_EDIT)
}

# =========================
# LLM(Chat) 설정
# =========================

LLM_TEMPERATURE = 0.2

# Ollama context window
# 입력(Input) + 출력(Output)을 모두 포함한 전체 컨텍스트 크기.
# Windows는 일반 Ollama 빌드에서 채팅 모델과 bge-m3를 함께 유지하므로,
# 메모리 부족을 피하기 위해 더 작은 기본 컨텍스트를 사용한다.
# 모델은 32K KV cache로 준비하고, 요청별 context는 아래 최대값까지
# 32K 단위에서 2배씩 확장한다.
LLM_INITIAL_NUM_CTX = 32768
LLM_MAX_NUM_CTX = 65536 if IS_WINDOWS else 131072
LLM_NUM_CTX = LLM_MAX_NUM_CTX

# Ollama 최대 출력 토큰
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
# Ollama 공통 설정
# =========================

# 모든 Ollama 요청(embed/chat)에 공통으로 사용하는 keep_alive
#
# Ollama는 요청마다 keep_alive가 없으면 기본값(5분)으로 다시 초기화된다.
# 따라서 예열뿐 아니라 실제 chat/embed 요청에도 항상 이 값을 포함해야
# 모델이 메모리에 계속 유지된다.
OLLAMA_KEEP_ALIVE = -1

# =========================
# BGE-M3 임베딩 설정
# =========================

# BGE-M3의 실제 최대 컨텍스트는 8192 토큰.
# 이보다 큰 num_ctx를 요청해도 Ollama가 자동으로 8192로 제한한다.
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
