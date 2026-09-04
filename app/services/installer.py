"""
installer.py - RAG Agent 설치 관리 서비스
"""
import asyncio
import os
import platform
import re
import shutil
import sys
from pathlib import Path
from typing import AsyncGenerator

from logger import get_logger

from config import KOKORO_CACHE_READY
from services.linux_dependencies import chromium_dependencies_available, linux_package_install_command

logger = get_logger(__name__)


def get_linux_espeak_install_command() -> list[str] | None:
    """Return the first supported distro package-manager command."""
    return linux_package_install_command("espeak")


async def is_docker_available() -> bool:
    """Docker 설치+데몬 실행 여부를 부작용 없이 확인 (Docker를 켜지 않음).

    설정 마법사에서 'Docker' 선택지의 활성/비활성을 판단하는 용도.
    Installer 인스턴스(디렉토리 생성 부작용) 없이 가볍게 호출할 수 있다.
    """
    if shutil.which("docker") is None:
        return False
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "info",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        return proc.returncode == 0
    except Exception:
        return False


class Installer:
    def __init__(self, install_dir: Path, app_dir: Path, venv_dir: Path, log_file: Path):
        self.install_dir = install_dir
        self.app_dir = app_dir
        self.venv_dir = venv_dir
        self.log_file = log_file

        # 디렉토리 생성
        self.install_dir.mkdir(parents=True, exist_ok=True)
        self.log_file.touch(exist_ok=True)

    async def _run(
        self,
        cmd: list[str],
        log: bool = False,
        env: dict[str, str] | None = None,
    ) -> int:
        """명령 실행"""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self.install_dir),
            env=env,
        )
        if log:
            with open(self.log_file, "a") as f:
                async for line in proc.stdout:
                    f.write(line.decode())
        else:
            await proc.communicate()
        await proc.wait()
        return proc.returncode

    async def check_docker(self) -> tuple[bool, str]:
        """Docker 확인"""
        if shutil.which("docker") is None:
            return False, "Docker is not installed"
        ok = await self._run(["docker", "info"]) == 0
        if not ok:
            await asyncio.create_subprocess_exec("open", "-a", "Docker")
            for _ in range(20):
                await asyncio.sleep(3)
                if await self._run(["docker", "info"]) == 0:
                    ok = True
                    break

        if ok:
            return True, "Docker is running"
        else:
            return False, "Failed to start Docker"

    async def is_docker_available(self) -> bool:
        """Docker 설치+실행 여부를 부작용 없이 확인 (모듈 함수 위임)."""
        return await is_docker_available()

    async def setup_venv(self):
        if platform.system() == "Windows":
            python_path = self.venv_dir / "Scripts" / "python.exe"
        else:
            python_path = self.venv_dir / "bin" / "python3"

        if not python_path.exists():
            if await self._run([
                sys.executable,
                "-m",
                "venv",
                str(self.venv_dir),
            ]) != 0:
                logger.info("Virtual environment creation failed")
                return False, "Virtual environment creation failed"

        logger.info("Virtual environment ready")
        return True, "Virtual environment ready"

    async def install_python_packages(self) -> tuple[bool, str]:
        """가상환경에 Python 패키지 설치 (Windows/Linux/macOS 지원)"""

        logger.info("=== Python 패키지 설치 시작 ===")

        if os.name == "nt":
            python_exe = self.venv_dir / "Scripts" / "python.exe"
        else:
            python_exe = self.venv_dir / "bin" / "python"

        req_file = self.app_dir / "requirements.txt"

        logger.info(f"Python 실행파일 : {python_exe}")
        logger.info(f"requirements.txt : {req_file}")

        if not python_exe.exists():
            logger.error(f"Python 실행파일이 존재하지 않습니다. ({python_exe})")
            return False, f"venv Python not found ({python_exe})"

        if not req_file.exists():
            logger.error(f"requirements.txt not found ({req_file})")
            return False, f"requirements.txt not found ({req_file})"

        cmd = [
            str(python_exe),
            "-m",
            "pip",
            "install",
            "-r",
            str(req_file),
            "--quiet",
        ]

        logger.info(f"실행 명령어 : {' '.join(cmd)}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            logger.info("pip 프로세스 생성 완료")

            assert proc.stdout is not None

            async for raw in proc.stdout:
                line = raw.decode("utf-8", errors="replace").rstrip()

                if line:
                    logger.info(f"[pip] {line}")

                    with open(self.log_file, "a", encoding="utf-8") as f:
                        f.write(line + "\n")

            await proc.wait()

            logger.info(f"pip 종료 코드 : {proc.returncode}")

            if proc.returncode != 0:
                logger.error("Python package installation failed")
                return False, f"Python package installation failed (ExitCode={proc.returncode})"

            logger.info("Python packages installed")
            return True, "Python packages installed"

        except FileNotFoundError as e:
            logger.exception("Executable not found")
            return False, f"Executable not found ({e.filename})"

        except Exception:
            logger.exception("Error during Python package installation")
            return False, "Error during Python package installation"

    def _get_venv_python(self) -> Path:
        """현재 운영체제에 맞는 가상환경 Python 경로를 반환한다."""
        if os.name == "nt":
            return self.venv_dir / "Scripts" / "python.exe"
        return self.venv_dir / "bin" / "python"

    async def is_unidic_dictionary_installed(self) -> bool:
        python_exe = self._get_venv_python()
        if not python_exe.exists():
            return False
        check_script = (
            "from pathlib import Path\n"
            "import unidic\n"
            "raise SystemExit(not Path(unidic.DICDIR, 'mecabrc').is_file())\n"
        )
        return await self._run([str(python_exe), "-c", check_script]) == 0

    async def install_unidic_dictionary(self) -> tuple[bool, str]:
        """Kokoro 일본어 G2P에 필요한 UniDic 사전 데이터를 설치한다."""
        python_exe = self._get_venv_python()
        if not python_exe.exists():
            return False, f"venv Python not found ({python_exe})"

        if await self.is_unidic_dictionary_installed():
            logger.info("UniDic dictionary already installed")
            return True, "UniDic dictionary already installed"

        logger.info("=== UniDic dictionary installation started ===")
        if await self._run([str(python_exe), "-m", "unidic", "download"], log=True) != 0:
            logger.warning("UniDic dictionary installation failed")
            return False, "UniDic dictionary installation failed"

        if not await self.is_unidic_dictionary_installed():
            logger.warning("UniDic dictionary was downloaded but is incomplete")
            return False, "UniDic dictionary installation incomplete"

        logger.info("UniDic dictionary installed")
        return True, "UniDic dictionary installed"

    async def install_unidic_dictionary_with_progress(self) -> AsyncGenerator[tuple[int, str], None]:
        """UniDic 다운로드 출력에서 진행률을 추출해 전달한다."""
        python_exe = self._get_venv_python()
        if not python_exe.exists():
            yield 0, f"venv Python not found ({python_exe})"
            return

        if await self.is_unidic_dictionary_installed():
            yield 100, "UniDic dictionary already installed"
            return

        logger.info("=== UniDic dictionary installation started ===")
        proc = await asyncio.create_subprocess_exec(
            str(python_exe), "-m", "unidic", "download",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self.install_dir),
        )
        progress = 0
        pending = ""
        with open(self.log_file, "a") as log_file:
            while chunk := await proc.stdout.read(1024):
                text = chunk.decode("utf-8", errors="replace")
                log_file.write(text)
                pending = (pending + text)[-4096:]
                percentages = re.findall(r"(?:^|\s)(\d{1,3})%", pending)
                if percentages:
                    progress = max(progress, min(int(percentages[-1]), 99))
                yield progress, text.strip()

        await proc.wait()
        if proc.returncode != 0:
            logger.warning("UniDic dictionary installation failed")
            yield progress, "UniDic dictionary installation failed"
            return
        if not await self.is_unidic_dictionary_installed():
            logger.warning("UniDic dictionary was downloaded but is incomplete")
            yield progress, "UniDic dictionary installation incomplete"
            return

        logger.info("UniDic dictionary installed")
        yield 100, "UniDic dictionary installed"

    async def install_playwright(self) -> tuple[bool, str]:
        """Playwright 브라우저 설치"""

        logger.info("=== Playwright 설치 시작 ===")

        if os.name == "nt":
            python_exe = self.venv_dir / "Scripts" / "python.exe"
        else:
            python_exe = self.venv_dir / "bin" / "python"

        logger.info(f"Python 실행파일 : {python_exe}")

        if not python_exe.exists():
            logger.error(f"Python 실행파일이 존재하지 않습니다. ({python_exe})")
            return False, f"venv Python not found ({python_exe})"

        cmd = [
            str(python_exe),
            "-m",
            "playwright",
            "install",
            "chromium",
        ]

        logger.info(f"Command: {' '.join(cmd)}")

        try:
            if platform.system() == "Linux" and not chromium_dependencies_available():
                dependency_command = linux_package_install_command("chromium")
                if dependency_command is None or await self._run(dependency_command, log=True) != 0:
                    logger.warning("Chromium system dependencies could not be installed")
                    return False, "Playwright installation failed"
                if not chromium_dependencies_available():
                    return False, "Playwright installation failed"
            if await self._run(cmd, log=True) != 0:
                logger.warning("Playwright installation failed")
                return False, "Playwright installation failed"
            logger.info("Playwright installed")
            return True, "Playwright installed"

        except Exception:
            logger.exception("Playwright installation failed")
            return False, "Playwright installation failed"

    async def install_espeak(self) -> tuple[bool, str]:
        """espeak-ng 설치 (Kokoro TTS G2P 의존성)"""
        logger.info("=== espeak-ng 설치 확인 ===")

        if shutil.which("espeak-ng") is not None:
            logger.info("espeak-ng already installed")
            return True, "espeak-ng verified"

        system = platform.system()

        if system == "Darwin":
            if shutil.which("brew") is None:
                logger.warning("Homebrew unavailable — espeak-ng installation deferred")
                return False, "Homebrew is required to install espeak-ng"
            if await self._run(["brew", "install", "espeak-ng"], log=True) != 0:
                logger.warning("espeak-ng installation failed (some TTS features limited)")
                return False, "espeak-ng installation failed"

        elif system == "Linux":
            command = get_linux_espeak_install_command()
            if command is None:
                logger.warning("No supported Linux package manager is available for espeak-ng")
                return False, "Install espeak-ng with your Linux package manager"
            if await self._run(command, log=True) != 0:
                logger.warning("espeak-ng installation failed")
                return False, "espeak-ng installation failed"

        elif system == "Windows":
            if shutil.which("winget") is None:
                logger.warning("winget is unavailable for espeak-ng installation")
                return False, "espeak-ng installer unavailable"
            cmd = [
                "winget", "install", "--id", "eSpeak-NG.eSpeak-NG", "--exact",
                "--source", "winget",
                "--silent", "--accept-package-agreements", "--accept-source-agreements",
            ]

            if await self._run(cmd, log=True) != 0:
                logger.warning("espeak-ng installation failed on Windows")
                return False, "espeak-ng installation failed"

        return True, "espeak-ng installed"

    async def download_kokoro_model(self, huggingface_token: str | None = None) -> tuple[bool, str]:
        """Kokoro TTS 모델 및 전체 voice 파일 사전 다운로드"""
        logger.info("=== Kokoro 모델 다운로드 ===")

        # 이전에 중단된 다운로드가 남긴 완료 표시로 오프라인 모드가 켜지는 것을
        # 막는다. 모든 파일을 성공적으로 받은 경우에만 아래에서 다시 만든다.
        KOKORO_CACHE_READY.unlink(missing_ok=True)

        if os.name == "nt":
            python_exe = self.venv_dir / "Scripts" / "python.exe"
        else:
            python_exe = self.venv_dir / "bin" / "python"

        if not python_exe.exists():
            return False, "venv Python not found"

        # 모델 로드 + 전체 voice 파일 다운로드
        script = """
from kokoro import KPipeline
from huggingface_hub import hf_hub_download

VOICES = [
    'af_heart','af_alloy','af_aoede','af_bella','af_jessica','af_nicole',
    'af_nova','af_river','af_sarah','af_sky',
    'am_adam','am_echo','am_eric','am_liam','am_michael','am_onyx',
    'bf_emma','bf_isabella','bm_george','bm_lewis',
    'jf_alpha','jf_gongitsune','jf_nezumi','jf_tebukuro','jm_kumo',
    'zf_xiaobei','zf_xiaoni','zf_xiaoxiao','zf_xiaoyi',
    'zm_yunjian','zm_yunxi','zm_yunxia','zm_yunyang',
    'ef_dora','em_alex','em_santa',
    'ff_siwis',
    'hf_alpha','hf_beta','hm_omega','hm_psi',
    'if_sara','im_nicola',
    'pf_dora','pm_alex','pm_santa',
]

p = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')
print('model loaded')

failed = []
for v in VOICES:
    try:
        hf_hub_download('hexgrad/Kokoro-82M', f'voices/{v}.pt')
        print(f'voice ok: {v}')
    except Exception as e:
        failed.append(v)
        print(f'voice failed: {v} ({e})')

if failed:
    raise RuntimeError(f'voice downloads failed: {", ".join(failed)}')

print('kokoro all voices ready')
"""

        try:
            download_env = {**os.environ, "HF_HUB_OFFLINE": "0"}
            if huggingface_token:
                download_env["HF_TOKEN"] = huggingface_token
            rc = await self._run(
                [str(python_exe), "-c", script],
                log=True,
                env=download_env,
            )
            if rc != 0:
                logger.warning("Kokoro model download failed")
                return False, "Kokoro model download failed"
            KOKORO_CACHE_READY.touch()
            return True, "Kokoro model/voices downloaded"
        except Exception as e:
            logger.warning(f"Kokoro model download error: {e}")
            return False, f"Kokoro model download failed: {e}"

    async def start_elasticsearch(self) -> tuple[bool, str]:
        compose_file = self.app_dir / "docker-compose.yml"

        if await self._run(
            ["docker", "compose", "-f", str(compose_file), "up", "-d", "--build"],
            log=True
        ) != 0:
            return False, "Elasticsearch start failed"

        ready = False
        for _ in range(20):
            await asyncio.sleep(3)
            from services.db import ES_URL
            chk = await asyncio.create_subprocess_exec(
                "curl", "-s", ES_URL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await chk.wait()
            if chk.returncode == 0:
                ready = True
                break

        if not ready:
            return False, "Elasticsearch did not become ready"
        return True, "Elasticsearch ready"
