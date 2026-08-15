from services import code_tools


def test_undo_code_changes_can_restore_one_file_then_the_remainder(tmp_path):
    first = tmp_path / "first.txt"
    second = tmp_path / "second.txt"
    first.write_text("after first", encoding="utf-8")
    second.write_text("after second", encoding="utf-8")
    token = "per-file-undo-test"
    code_tools._code_change_undo_registry[token] = {
        "files": [
            {
                "folder_id": "root", "folder": str(tmp_path), "path": "first.txt",
                "before": b"before first", "after": b"after first",
            },
            {
                "folder_id": "root", "folder": str(tmp_path), "path": "second.txt",
                "before": None, "after": b"after second",
            },
        ],
    }

    first_result = code_tools.undo_code_changes(token, "root", "first.txt")

    assert first_result == {
        "ok": True, "complete": False,
        "files": [{"folderId": "root", "path": "first.txt"}],
    }
    assert first.read_bytes() == b"before first"
    assert second.exists()

    remaining_result = code_tools.undo_code_changes(token)

    assert remaining_result["ok"] is True
    assert remaining_result["complete"] is True
    assert not second.exists()
    assert code_tools.get_code_changes_undo_status(token) == {
        "available": False,
        "complete": True,
        "undoneFiles": [
            {"folderId": "root", "path": "first.txt"},
            {"folderId": "root", "path": "second.txt"},
        ],
    }
    code_tools._code_change_undo_registry.pop(token, None)


def test_file_undo_rejects_a_file_changed_after_the_llm_edit(tmp_path):
    target = tmp_path / "changed.txt"
    target.write_text("changed later", encoding="utf-8")
    token = "per-file-undo-conflict-test"
    code_tools._code_change_undo_registry[token] = {
        "files": [{
            "folder_id": "root", "folder": str(tmp_path), "path": "changed.txt",
            "before": b"before", "after": b"llm edit",
        }],
    }

    result = code_tools.undo_code_changes(token, "root", "changed.txt")

    assert result == {"ok": False, "reason": "conflict", "path": "changed.txt"}
    assert target.read_bytes() == b"changed later"
    code_tools._code_change_undo_registry.pop(token, None)
