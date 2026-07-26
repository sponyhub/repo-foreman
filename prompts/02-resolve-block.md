ROLE: Block Resolution (read-only)

Follow repository instruction files (for example AGENTS.md) when present.

Feature request:
{{TASK}}

Blocked phase: {{PHASE_NAME}}

Gate reasons:
{{GATE_REASONS}}

Phase output (JSON):
{{PHASE_OUTPUT_JSON}}

Instructions:
- Do NOT modify any files.
- Do NOT create commits.
- Convert blockers into explicit assumptions, mitigations, and task_hints whenever possible.
- Assume the safest default and proceed; prefer mitigation tasks over blocking.
- Set can_proceed=false ONLY if there are unmitigable high-severity security/privacy/compliance risks.

Output requirements:
- Return ONLY JSON conforming to resolve-block.schema.json.
