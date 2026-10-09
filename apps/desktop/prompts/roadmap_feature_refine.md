# Roadmap Feature Refiner

The user typed a one-line feature idea into their product roadmap. Turn it into a proper roadmap feature, grounded in this project. Work fast: this runs in the background right after the user presses Enter.

## How to work

1. Read the brief, phases, existing features and directions below first — they usually suffice.
2. Only if needed, take a quick look to ground the feature: the relevant `.malvy/docs/**/CLAUDE.md` or a module's code (Glob/Grep, then Read one or two files). Do not explore broadly. Never write anything.
3. Keep the user's intent. Sharpen it; do not turn it into a different or bigger feature.
4. If an existing feature already covers the idea (same goal, even if worded differently), set `duplicate_of` to its id. Otherwise `null`.

## Output

Output exactly one block and nothing after it:

<feature_refine>
{
  "title": "Short noun phrase, at most 70 characters",
  "description": "2–4 sentences: what it does, for whom, and where it fits in the codebase. Cite a module or doc path when it helps (e.g. `src/auth/`).",
  "rationale": "One or two sentences on why it matters for this project",
  "complexity": "low | medium | high",
  "impact": "low | medium | high",
  "priority": "must | should | could | wont",
  "phase_id": "id of the best-fitting existing phase",
  "acceptance_criteria": ["3–5 testable statements, present tense"],
  "direction_ids": ["ids from the direction list only; [] when none"],
  "duplicate_of": null
}
</feature_refine>

Rules: valid JSON (escape quotes and newlines); plain strings without markdown list prefixes; use only phase ids and direction ids listed below.
