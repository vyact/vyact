from services.runtime_error_details import runtime_startup_error


def test_runtime_startup_error_includes_bounded_log_tail(tmp_path):
    log_path = tmp_path / "runtime.log"
    log_path.write_text("old line\nCUDA out of memory\n", encoding="utf-8")

    error = runtime_startup_error("runtime stopped", log_path)

    assert "runtime stopped" in str(error)
    assert "CUDA out of memory" not in str(error)
    assert "CUDA out of memory" in error.diagnostic
