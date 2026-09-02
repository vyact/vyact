from services.runtime_error_details import classify_runtime_load_failure, runtime_startup_error


def test_runtime_startup_error_includes_bounded_log_tail(tmp_path):
    log_path = tmp_path / "runtime.log"
    log_path.write_text("old line\nCUDA out of memory\n", encoding="utf-8")

    error = runtime_startup_error("runtime stopped", log_path)

    assert "runtime stopped" in str(error)
    assert "CUDA out of memory" not in str(error)
    assert "CUDA out of memory" in error.diagnostic


def test_runtime_failure_uses_diagnostic_for_oom_code_and_message(tmp_path):
    log_path = tmp_path / "runtime.log"
    log_path.write_text(
        "initializing model\nCUDA out of memory while allocating KV cache\n",
        encoding="utf-8",
    )
    error = runtime_startup_error("runtime stopped", log_path)

    code, message = classify_runtime_load_failure(error)

    assert code == "out_of_memory"
    assert message == "CUDA out of memory while allocating KV cache"


def test_runtime_failure_falls_back_to_exception_message_without_diagnostic():
    code, message = classify_runtime_load_failure(RuntimeError("draft model is incompatible"))

    assert code == "load_failed"
    assert message == "draft model is incompatible"
