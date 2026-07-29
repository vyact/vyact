"""
es_native.py — Docker 없이 Elasticsearch 바이너리를 직접 설치/실행한다.

Docker가 보안정책(EDR·가상화 차단 등)에 막히는 환경을 위한 대안.
지원: Windows(x86_64), Apple Silicon macOS(arm64).

흐름:
  1. OS 감지 → 해당 아티팩트 URL 결정
  2. zip/tar.gz 다운로드 (~/.vyact/es_download)
  3. 압축 해제 → ~/.vyact/elasticsearch-<ver>/
  4. config/elasticsearch.yml 에 path.data/logs, security off, single-node, 포트 주입
  5. nori(한국어 분석기) 플러그인 설치
  6. 백그라운드 실행
  7. 부팅 자동시작 등록 (Windows: 시작프로그램 폴더 .vbs / mac: LaunchAgent)
  8. 포트 응답 대기

각 단계는 (진행률, 메시지, level) 을 yield 한다.
"""
import asyncio
import os
import platform
import sys
import tarfile
import zipfile
from pathlib import Path
from typing import AsyncGenerator

import httpx

from config import INSTALL_DIR
from config.models import ES_VERSION, ES_DOWNLOAD_BASE, ES_ARTIFACTS
from services.db import ES_PORT, ES_TRANSPORT_PORT
from logger import get_logger

logger = get_logger(__name__)

ES_HOME = INSTALL_DIR / f"elasticsearch-{ES_VERSION}"
ES_DATA = INSTALL_DIR / "data"
ES_LOGS = INSTALL_DIR / "logs"
DOWNLOAD_DIR = INSTALL_DIR / "es_download"


def detect_platform() -> str | None:
    """지원 플랫폼 키 반환. 미지원이면 None."""
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows":
        return "windows"
    if system == "Darwin" and machine in ("arm64", "aarch64"):
        return "darwin-arm64"
    # Intel Mac / Linux 등은 설치형 미지원 (Docker 권장)
    return None


def is_native_supported() -> bool:
    return detect_platform() is not None


def _es_binary() -> Path:
    """OS별 elasticsearch 실행 파일 경로."""
    if platform.system() == "Windows":
        return ES_HOME / "bin" / "elasticsearch.bat"
    return ES_HOME / "bin" / "elasticsearch"


def _es_plugin_binary() -> Path:
    if platform.system() == "Windows":
        return ES_HOME / "bin" / "elasticsearch-plugin.bat"
    return ES_HOME / "bin" / "elasticsearch-plugin"


def _write_es_config():
    """elasticsearch.yml 에 vyact 설정 주입."""
    cfg = ES_HOME / "config" / "elasticsearch.yml"
    ES_DATA.mkdir(parents=True, exist_ok=True)
    ES_LOGS.mkdir(parents=True, exist_ok=True)
    # 경로는 OS 구분자 이슈를 피하려 forward slash 사용 (ES가 양쪽 다 허용)
    data_path = str(ES_DATA).replace("\\", "/")
    logs_path = str(ES_LOGS).replace("\\", "/")
    lines = [
        "# ── vyact auto-config ──",
        "cluster.name: vyact-es",
        "node.name: vyact-node",
        f"path.data: {data_path}",
        f"path.logs: {logs_path}",
        "network.host: 127.0.0.1",
        f"http.port: {ES_PORT}",
        f"transport.port: {ES_TRANSPORT_PORT}",
        "discovery.type: single-node",
        "xpack.security.enabled: false",
        "xpack.security.http.ssl.enabled: false",
        "xpack.security.transport.ssl.enabled: false",
        "",
    ]
    cfg.write_text("\n".join(lines), encoding="utf-8")


async def _already_running() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"http://127.0.0.1:{ES_PORT}")
            return r.status_code == 200
    except Exception:
        return False


async def _download(url: str, dest: Path) -> AsyncGenerator[tuple, None]:
    """스트리밍 다운로드하며 진행률(5~55%)을 yield."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            got = 0
            last_pct = 0
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=1 << 20):
                    f.write(chunk)
                    got += len(chunk)
                    if total:
                        pct = 5 + int(got / total * 50)  # 5→55
                        if pct >= last_pct + 5:
                            last_pct = pct
                            mb = got / (1024 * 1024)
                            tmb = total / (1024 * 1024)
                            yield (pct, f"다운로드 중... {mb:.0f}/{tmb:.0f} MB", "info")
    yield (55, "다운로드 완료", "ok")


def _extract(archive: Path, kind: str):
    """zip/tar.gz 를 INSTALL_DIR 에 풀면 elasticsearch-<ver>/ 폴더가 생긴다."""
    if kind == "zip":
        with zipfile.ZipFile(archive) as z:
            z.extractall(INSTALL_DIR)
    else:
        with tarfile.open(archive, "r:gz") as t:
            t.extractall(INSTALL_DIR)


def _register_autostart():
    """부팅(로그인) 시 ES 자동 시작 등록. 권한 이슈 최소화."""
    if platform.system() == "Windows":
        # 시작프로그램 폴더에 콘솔창 없이 백그라운드 실행하는 .vbs 배치
        startup = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / \
                  "Start Menu" / "Programs" / "Startup"
        startup.mkdir(parents=True, exist_ok=True)
        bat = _es_binary()
        vbs = startup / "vyact-elasticsearch.vbs"
        # WScript.Shell 로 창 숨김(0) 실행
        vbs.write_text(
            'Set WshShell = CreateObject("WScript.Shell")\n'
            f'WshShell.Run """{bat}""", 0, False\n',
            encoding="utf-8",
        )
        return str(vbs)
    else:
        # macOS: LaunchAgent plist
        agents = Path.home() / "Library" / "LaunchAgents"
        agents.mkdir(parents=True, exist_ok=True)
        plist = agents / "com.vyact.elasticsearch.plist"
        binary = _es_binary()
        plist.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
            '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0"><dict>\n'
            '  <key>Label</key><string>com.vyact.elasticsearch</string>\n'
            f'  <key>ProgramArguments</key><array><string>{binary}</string></array>\n'
            '  <key>RunAtLoad</key><true/>\n'
            '  <key>KeepAlive</key><false/>\n'
            '</dict></plist>\n',
            encoding="utf-8",
        )
        return str(plist)


async def _start_es_background():
    """ES를 백그라운드로 기동."""
    binary = _es_binary()
    if platform.system() == "Windows":
        # 콘솔창 없이 실행
        CREATE_NO_WINDOW = 0x08000000
        await asyncio.create_subprocess_exec(
            str(binary),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
    else:
        os.chmod(binary, 0o755)
        await asyncio.create_subprocess_exec(
            str(binary), "-d",  # -d: 데몬 모드
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )


async def install_native_es() -> AsyncGenerator[tuple, None]:
    """설치형 ES 전체 설치 파이프라인. (progress, message, level) 을 yield."""
    plat = detect_platform()
    if plat is None:
        yield (0, "설치형 ES는 Windows 또는 Apple Silicon Mac만 지원합니다. Docker를 사용하세요.", "error")
        return

    # 이미 떠 있으면 스킵
    if await _already_running():
        logger.info(f"Elasticsearch가 이미 실행 중입니다(포트 {ES_PORT}).")
        yield (100, f"Elasticsearch가 이미 실행 중입니다(포트 {ES_PORT}).", "ok")
        return

    # 이미 설치돼 있으면 다운로드/해제 스킵하고 실행만
    filename, kind = ES_ARTIFACTS[plat]
    if _es_binary().exists():
        logger.info("기존 설치 감지됨 — 다운로드를 건너뜁니다.")
        yield (60, "기존 설치 감지됨 — 다운로드를 건너뜁니다.", "ok")
    else:
        url = f"{ES_DOWNLOAD_BASE}/{filename}"
        yield (5, f"Elasticsearch {ES_VERSION} 다운로드 시작...", "info")
        archive = DOWNLOAD_DIR / filename
        try:
            async for ev in _download(url, archive):
                yield ev
        except Exception as e:
            logger.error(f"다운로드 실패: {e}")
            yield (0, f"다운로드 실패: {e}", "error")
            return

        logger.info("압축 해제 중...")
        yield (58, "압축 해제 중...", "info")
        try:
            await asyncio.get_event_loop().run_in_executor(None, _extract, archive, kind)
        except Exception as e:
            logger.error(f"압축 해제 실패: {e}")
            yield (0, f"압축 해제 실패: {e}", "error")
            return
        # 다운로드 파일 정리
        try:
            archive.unlink()
        except Exception:
            pass

    # 설정 주입
    logger.info("설정 파일 구성 중 (포트/경로/보안)...")
    yield (65, "설정 파일 구성 중 (포트/경로/보안)...", "info")
    try:
        _write_es_config()
    except Exception as e:
        logger.error(f"설정 실패: {e}")
        yield (0, f"설정 실패: {e}", "error")
        return

    # 다국어 RAG 분석 플러그인 설치. 영어·프랑스어·스페인어·태국어는 ES 내장 analyzer다.
    analysis_plugins = ("analysis-nori", "analysis-kuromoji", "analysis-smartcn", "analysis-icu")
    logger.info("다국어 분석기 설치 중: %s", ", ".join(analysis_plugins))
    yield (72, "다국어 검색 분석기 설치 중...", "info")
    try:
        plugin = _es_plugin_binary()
        if platform.system() != "Windows":
            os.chmod(plugin, 0o755)
        proc = await asyncio.create_subprocess_exec(
            str(plugin), "install", "--batch", *analysis_plugins,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        # 이미 설치돼 있으면 non-zero 나올 수 있으나 치명적 아님
    except Exception as e:
        logger.error(f"분석기 설치 경고: {e}")
        yield (72, f"분석기 설치 경고: {e}", "info")

    # 부팅 자동시작 등록
    logger.info("부팅 시 자동 시작 등록 중...")
    yield (80, "부팅 시 자동 시작 등록 중...", "info")
    try:
        _register_autostart()
    except Exception as e:
        logger.error(f"자동시작 등록 경고: {e}")
        yield (80, f"자동시작 등록 경고: {e}", "info")

    # 기동
    logger.info("Elasticsearch 시작 중...")
    yield (85, "Elasticsearch 시작 중...", "info")
    try:
        await _start_es_background()
    except Exception as e:
        logger.error(f"시작 실패: {e}")
        yield (0, f"시작 실패: {e}", "error")
        return

    # 응답 대기 (최대 ~120초 — 첫 기동은 JVM 부팅에 시간 걸림)
    logger.info("기동 대기 중... (최초 실행은 1~2분 걸릴 수 있음)")
    yield (88, "기동 대기 중... (최초 실행은 1~2분 걸릴 수 있음)", "info")
    for i in range(40):
        await asyncio.sleep(3)
        if await _already_running():
            yield (100, f"Elasticsearch 준비 완료 (포트 {ES_PORT})", "ok")
            return
    logger.info("기동 확인 시간 초과 — 잠시 후 자동으로 연결될 수 있습니다.")
    yield (95, "기동 확인 시간 초과 — 잠시 후 자동으로 연결될 수 있습니다.", "info")
