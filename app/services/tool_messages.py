"""Localized messages for the shared tool execution boundary."""
import json

from routers.deps import load_ui_language_async

_MESSAGES = {
    "en": ["Tool execution failed ({tool}): {detail}", "Invalid tool name: {tool}", "Unknown MCP server: {server}", "[Image result]", "Unknown error", "(No result)"],
    "ko": ["도구 실행 실패 ({tool}): {detail}", "잘못된 도구 이름: {tool}", "알 수 없는 MCP 서버: {server}", "[이미지 결과]", "알 수 없는 오류", "(결과 없음)"],
    "ja": ["ツールの実行に失敗しました ({tool}): {detail}", "無効なツール名: {tool}", "不明なMCPサーバー: {server}", "[画像の結果]", "不明なエラー", "(結果なし)"],
    "zh": ["工具执行失败 ({tool}): {detail}", "无效的工具名称: {tool}", "未知的MCP服务器: {server}", "[图像结果]", "未知错误", "(无结果)"],
    "th": ["เรียกใช้เครื่องมือไม่สำเร็จ ({tool}): {detail}", "ชื่อเครื่องมือไม่ถูกต้อง: {tool}", "ไม่รู้จักเซิร์ฟเวอร์ MCP: {server}", "[ผลลัพธ์รูปภาพ]", "ข้อผิดพลาดที่ไม่ทราบสาเหตุ", "(ไม่มีผลลัพธ์)"],
    "vi": ["Thực thi công cụ thất bại ({tool}): {detail}", "Tên công cụ không hợp lệ: {tool}", "Máy chủ MCP không xác định: {server}", "[Kết quả hình ảnh]", "Lỗi không xác định", "(Không có kết quả)"],
    "es": ["Error al ejecutar la herramienta ({tool}): {detail}", "Nombre de herramienta no válido: {tool}", "Servidor MCP desconocido: {server}", "[Resultado de imagen]", "Error desconocido", "(Sin resultado)"],
    "fr": ["Échec de l’exécution de l’outil ({tool}) : {detail}", "Nom d’outil invalide : {tool}", "Serveur MCP inconnu : {server}", "[Résultat d’image]", "Erreur inconnue", "(Aucun résultat)"],
}
_KEYS = ("execution_failed", "invalid_name", "unknown_server", "image_result", "unknown_error", "no_result")
MESSAGES = {language: dict(zip(_KEYS, values)) for language, values in _MESSAGES.items()}


async def get_tool_language() -> str:
    try:
        return await load_ui_language_async() or "en"
    except Exception:
        return "en"


def tool_message(key: str, language: str = "en", **params) -> str:
    code = (language or "en").replace("_", "-").split("-", 1)[0].lower()
    return MESSAGES.get(code, MESSAGES["en"])[key].format(**params)


def tool_error(message: str) -> str:
    # Machine-readable failure status must not depend on translated text.
    return json.dumps({"ok": False, "error": message}, ensure_ascii=False)
