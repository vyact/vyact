"""
config/default_skills.py – Default skills auto-registered on first install.

Each skill has name, description (for matching), and instructions (LLM directive).
description is matched via vector similarity against user queries,
so it should contain expressions users are likely to type.
"""

DEFAULT_SKILLS = [
    {
        "name": "code-review",
        "description": (
            "Performs code review. Analyzes bugs, performance issues, security vulnerabilities, "
            "and readability improvements. Review my code, check this code, code feedback, "
            "code quality check, find issues in this code."
        ),
        "instructions": (
            "Systematically review the provided code using the criteria below.\n\n"
            "## Criteria\n"
            "1. **Bugs & potential errors**: runtime errors, missed edge cases, type mismatches, null/undefined risks\n"
            "2. **Performance bottlenecks**: unnecessary computation, N+1 queries, memory leaks, inefficient data structures\n"
            "3. **Security vulnerabilities**: injection, XSS, missing auth, sensitive data exposure\n"
            "4. **Readability & maintainability**: naming, function decomposition, duplication, magic numbers, comments\n"
            "5. **Coding conventions**: consistency with existing project style, import ordering, formatting\n\n"
            "## Output format\n"
            "- Mark each issue with severity (🔴 High / 🟡 Medium / 🟢 Low)\n"
            "- Show before/after code comparisons for suggested fixes\n"
            "- Include positive feedback for well-written parts\n"
            "- End with a summary (total issues, severity distribution, priority fixes)"
        ),
    },
    {
        "name": "code-refactor",
        "description": (
            "Performs code refactoring. Code restructuring, duplication removal, clean code, "
            "design pattern application, tidy up code, improve structure, make it cleaner."
        ),
        "instructions": (
            "Refactor the provided code following these principles.\n\n"
            "## Principles\n"
            "1. **Remove duplication**: extract repeated logic into functions/hooks/utilities\n"
            "2. **Single responsibility**: ensure each function/component handles one concern\n"
            "3. **Improve naming**: make variable/function/class names clearly reflect their purpose\n"
            "4. **Eliminate magic numbers**: extract hardcoded values into constants\n"
            "5. **Strengthen error handling**: add missing exception handling, make error messages specific\n"
            "6. **Type safety**: add and improve type hints/interfaces\n\n"
            "## Output format\n"
            "- Briefly explain the reasoning, then provide the full refactored code\n"
            "- Preserve existing behavior (behavior-preserving refactoring)\n"
            "- Maintain the project's existing coding style and naming conventions\n"
            "- If changes are extensive, explain them in stages"
        ),
    },
    {
        "name": "api-design",
        "description": (
            "Designs REST API endpoints. API structure design, create endpoints, "
            "write routers, API schema, request/response design, add an API."
        ),
        "instructions": (
            "Design API endpoints following RESTful principles.\n\n"
            "## Design principles\n"
            "1. Resource-oriented URL design (nouns, not verbs)\n"
            "2. Appropriate HTTP methods (GET/POST/PUT/PATCH/DELETE)\n"
            "3. Consistent response structure and status codes\n"
            "4. Clear error messages and codes in error responses\n\n"
            "## Include in output\n"
            "- Each endpoint: HTTP method, path, description\n"
            "- Pydantic request/response models (BaseModel)\n"
            "- FastAPI router code (router = APIRouter)\n"
            "- Response examples by status code (200, 201, 400, 404, 500)\n"
            "- Auth/authorization considerations (if applicable)\n\n"
            "## Style\n"
            "- Follow vyact project patterns: get_es() → try/finally → await es.close()\n"
            "- Pydantic v2 style (BaseModel, Field)"
        ),
    },
    {
        "name": "commit-message",
        "description": (
            "Writes Git commit messages. Commit message, write a commit, PR description, "
            "summarize changes, create a commit message, write a PR."
        ),
        "instructions": (
            "Write commit messages in Conventional Commits format.\n\n"
            "## Format\n"
            "```\n"
            "<type>(<scope>): <subject>\n"
            "\n"
            "<body>\n"
            "```\n\n"
            "## Rules\n"
            "1. **type**: feat / fix / refactor / chore / docs / style / perf / test\n"
            "2. **scope**: infer from changed module/file (e.g., chat, skills, settings)\n"
            "3. **subject**: under 50 chars, English, imperative present tense (add, fix, update)\n"
            "4. **body**: concisely describe the reason for changes and key modifications\n\n"
            "## Guidelines\n"
            "- If a file list or diff is provided, analyze the scope of changes\n"
            "- Suggest splitting commits if changes span multiple concerns\n"
            "- For PR descriptions: include title, change summary, and test instructions\n"
            "- Add BREAKING CHANGE: footer if there are breaking changes"
        ),
    },
    {
        "name": "bug-analysis",
        "description": (
            "Analyzes bugs and errors. Error message interpretation, stack trace analysis, "
            "root cause identification, debugging, fix errors, find bugs, why is this failing."
        ),
        "instructions": (
            "Systematically analyze the provided error/bug information.\n\n"
            "## Analysis steps\n"
            "1. **Identify the error**: pinpoint error type, message, and location\n"
            "2. **Root cause analysis**: analyze stack trace, code flow, and data state\n"
            "3. **Reproduction conditions**: define when and how the error occurs\n"
            "4. **Solution**: provide specific fix code with the solution\n"
            "5. **Prevention**: suggest ways to prevent similar bugs\n\n"
            "## Output format\n"
            "- Summarize the cause in 1-2 sentences, then provide detailed analysis\n"
            "- Show before/after code comparisons for fixes\n"
            "- If uncertain, list possibilities with verification steps\n"
            "- Include relevant logs or debugging commands when applicable"
        ),
    },
    {
        "name": "document-summary",
        "description": (
            "Summarizes documents or articles. Summarize this, give me the key points, "
            "document summary, article summary, condense this, brief overview, TL;DR."
        ),
        "instructions": (
            "Summarize the provided document/article/text following these principles.\n\n"
            "## Principles\n"
            "1. Include all core topics and arguments without omission\n"
            "2. Remove unnecessary modifiers, repetition, and filler\n"
            "3. Maintain the original logical flow and order\n"
            "4. Do not add content not in the original or alter its meaning\n"
            "5. Preserve technical terminology as-is\n\n"
            "## Output format\n"
            "- **Key summary** (3 lines or fewer): overview of the entire content\n"
            "- **Main points** (3-5): focus on specific facts, figures, and decisions\n"
            "- **Implications/conclusion** (if applicable): significance or impact\n\n"
            "## Notes\n"
            "- If the user requests a specific format or length, adapt accordingly\n"
            "- For multiple documents, summarize with focus on commonalities and differences"
        ),
    },
    {
        "name": "translate-review",
        "description": (
            "Reviews translations. Translation quality check, is this natural, "
            "fix awkward translation, improve translation, proofread translation."
        ),
        "instructions": (
            "Review and improve the provided translation using these criteria.\n\n"
            "## Review criteria\n"
            "1. **Accuracy**: verify the original meaning is conveyed correctly\n"
            "2. **Naturalness**: ensure it reads naturally to a native speaker\n"
            "3. **Consistency**: check that terminology is consistent throughout\n"
            "4. **Omissions/additions**: identify missing or extra content\n"
            "5. **Tone**: verify the style matches the document's purpose (technical, marketing, conversational)\n\n"
            "## Output format\n"
            "- Present corrections as: original → current translation → suggested revision\n"
            "- Include a brief reason for each correction\n"
            "- Provide overall quality assessment (Good / Fair / Needs improvement)\n"
            "- Mention well-translated parts as well"
        ),
    },
    {
        "name": "sql-query",
        "description": (
            "Writes SQL or Elasticsearch queries. Write SQL, create a query, "
            "database lookup, ES query, search query, data retrieval, query optimization."
        ),
        "instructions": (
            "Write SQL or Elasticsearch queries as requested.\n\n"
            "## SQL principles\n"
            "1. Prefer standard SQL syntax; note DB-specific syntax when used\n"
            "2. Uppercase keywords, proper indentation for readability\n"
            "3. Use table aliases for JOINs, clear ON conditions\n"
            "4. Order WHERE conditions by selectivity (most selective first)\n"
            "5. Structure queries with index utilization in mind\n\n"
            "## Elasticsearch principles\n"
            "1. Combine bool query clauses (must/should/filter/must_not) appropriately\n"
            "2. Use filter context for conditions that don't need scoring (caching, no score)\n"
            "3. For aggregations, set size: 0 to skip hits when not needed\n"
            "4. For kNN search, set num_candidates, k, and filter appropriately\n\n"
            "## Output format\n"
            "- Complete query code\n"
            "- Query logic explanation (for complex queries)\n"
            "- Performance considerations or index recommendations (if applicable)\n"
            "- Expected result structure"
        ),
    },
]
