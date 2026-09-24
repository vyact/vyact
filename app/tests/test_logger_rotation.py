import logging

import logger


def test_daily_file_handler_switches_files_without_restart(tmp_path, monkeypatch):
    day = ["20260924"]
    monkeypatch.setattr(logger, "get_log_file", lambda name: tmp_path / f"{name}_{day[0]}.log")
    handler = logger.DailyFileHandler("app")
    handler.setFormatter(logging.Formatter("%(message)s"))

    try:
        handler.handle(logging.LogRecord("test", logging.INFO, __file__, 1, "before midnight", (), None))
        day[0] = "20260925"
        handler.handle(logging.LogRecord("test", logging.INFO, __file__, 1, "after midnight", (), None))
    finally:
        handler.close()

    assert (tmp_path / "app_20260924.log").read_text() == "before midnight\n"
    assert (tmp_path / "app_20260925.log").read_text() == "after midnight\n"
