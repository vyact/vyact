"""Write long-running model process output to the current day's log file."""

import logging
import os
import subprocess
from threading import Thread

from config import get_log_file

logger = logging.getLogger(__name__)


def _copy_process_output(stream, name: str) -> None:
    path = None
    output = None
    try:
        while chunk := os.read(stream.fileno(), 64 * 1024):
            current_path = get_log_file(name)
            if current_path != path:
                if output is not None:
                    output.close()
                path = current_path
                output = None
            try:
                if output is None:
                    output = current_path.open("ab")
                output.write(chunk)
                output.flush()
            except OSError as exc:
                logger.warning("[%s] log write failed: %s", name, exc)
                if output is not None:
                    output.close()
                    output = None
    finally:
        if output is not None:
            output.close()
        stream.close()


def start_logged_process(command: list[str], log_name: str, **kwargs) -> subprocess.Popen:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
    if process.stdout is None:
        raise RuntimeError("Model process output pipe was not created")
    log_thread = Thread(target=_copy_process_output, args=(process.stdout, log_name), daemon=True)
    log_thread.start()
    process._vyact_log_thread = log_thread
    return process


def wait_for_process_log(process: subprocess.Popen, timeout: float = 1.0) -> None:
    log_thread = getattr(process, "_vyact_log_thread", None)
    if log_thread is not None:
        log_thread.join(timeout)
