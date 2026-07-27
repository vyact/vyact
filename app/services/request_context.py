"""
services/request_context.py — 요청 단위 컨텍스트 공유

내부 MCP tool(예: naver_news_search)은 LLM이 만들어낸 tool-call 인자(query 등)만
받을 뿐, 사용자가 실제로 입력한 원본 프롬프트에는 접근할 수 없다. 하지만 "오늘/지금"
같은 최신성 판단은 LLM이 다듬은 검색어가 아니라 사용자 원문 기준으로 하는 게 정확하다.

asyncio Task별로 독립된 값을 갖는 ContextVar를 통해, 요청 처리 시작 시점(agent.py의
rag_query/rag_query_stream)에 원본 질문을 심어두고 tool 핸들러에서 읽어 쓴다.
"""
from contextvars import ContextVar

# 현재 처리 중인 요청의 사용자 원본 질문 (tool 핸들러에서 참조용, 읽기 전용으로 사용할 것)
current_user_question: ContextVar[str] = ContextVar("current_user_question", default="")