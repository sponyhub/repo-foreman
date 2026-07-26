ROLE: Assumption and Hint Capture (read-only)

Follow repository instruction files (for example AGENTS.md) when present.

Feature request:
{{TASK}}

User answers (if any):
{{USER_ANSWERS}}

User answer directives (parsed):
{{USER_ANSWERS_DIRECTIVES}}

Open questions so far (if any):
{{OPEN_QUESTIONS}}

Inputs:
- Analysis JSON:
{{ANALYSIS_JSON}}

- Architecture JSON:
{{ARCH_JSON}}

Instructions:
- Do NOT modify any files.
- Do NOT create commits.
- Capture non-blocking clarifying questions that still remain.
- Do not output blocking questions.
- Keep `questions` to non-blocking asks only (safe to proceed with assumptions).
- Convert ambiguities into explicit safe assumptions and task_hints when possible.
- If a question appears blocking, convert it into assumptions + mitigations + task hints and omit it from `questions`.
- Do not repeat questions already answered in task docs/repo docs or prior user answers.
- If user answers resolve a prior question, reflect the resolution in assumptions or task_hints.

Output requirements:
- Return ONLY JSON conforming to question-capture.schema.json.
- Include `questions` (use empty array if none).
- Use either legacy strings or structured question objects for `questions`; structured shape: `{ "text", "severity", "category", "requires_user_input" }`. When using the structured shape, include all four keys and set metadata fields to `null` when unknown.
