from services.conversation_title import readable_conversation_title


def test_code_first_titles_show_filename_instead_of_fence():
    assert readable_conversation_title('```python\n"""\nmain.py – FastAPI app') == "main.py"
    assert readable_conversation_title('```python """ main.py ...') == "main.py"


def test_code_without_filename_uses_meaningful_first_line():
    assert readable_conversation_title('```\nprint(1)\nprint(2)') == "print(1)"
    assert readable_conversation_title('```json {"manifest_ver...') == "manifest.json"


def test_normal_title_stays_unchanged():
    assert readable_conversation_title("Spring Boot 설정") == "Spring Boot 설정"
