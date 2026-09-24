import os
import sys
import threading
import time

from services import runtime_log


def test_process_output_moves_to_next_day_without_restart(tmp_path, monkeypatch):
    day = ["20260924"]
    monkeypatch.setattr(runtime_log, "get_log_file", lambda name: tmp_path / f"{name}_{day[0]}.log")
    read_fd, write_fd = os.pipe()
    stream = os.fdopen(read_fd, "rb", buffering=0)
    thread = threading.Thread(target=runtime_log._copy_process_output, args=(stream, "omlx"))
    thread.start()

    try:
        os.write(write_fd, b"before midnight\n")
        old_file = tmp_path / "omlx_20260924.log"
        for _ in range(100):
            if old_file.exists() and old_file.read_bytes() == b"before midnight\n":
                break
            time.sleep(0.01)
        assert old_file.read_bytes() == b"before midnight\n"

        day[0] = "20260925"
        os.write(write_fd, b"after midnight\n")
    finally:
        os.close(write_fd)
        thread.join(timeout=2)

    assert not thread.is_alive()
    assert (tmp_path / "omlx_20260925.log").read_bytes() == b"after midnight\n"


def test_logged_process_drains_output_before_exit(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime_log, "get_log_file", lambda name: tmp_path / f"{name}.log")
    process = runtime_log.start_logged_process(
        [sys.executable, "-c", "print('model started')"], "llama-swap",
    )
    assert process.wait(timeout=5) == 0
    runtime_log.wait_for_process_log(process)
    assert (tmp_path / "llama-swap.log").read_text() == "model started\n"
