# Implementation plans — sequence

The locked spec (`docs/spec.md`) spans several subsystems. Each plan below ships working, testable software on its own and builds on the previous one. Blueprint reference: `docs/blueprint.md` §10.3 steps in brackets.

| # | Plan | Delivers | Blueprint steps |
|---|---|---|---|
| 1 ✅ | `2026-10-18-caption-pipeline-v1.md` | Upload → whisperX transcript → segmented captions → Remotion MP4 + SRT/VTT, job progress over SSE, phrase editing, mobile-first project page (done on `feat/caption-pipeline-v1`; real-speech run pending whisperX env) | 1, 2, 4, 6, 7 |
| 2 ✅ | `2026-10-18-edit-plan-and-shots.md` | Ollama planner: filler/pause cuts (heuristic, toggleable, applied in the render), typed shots `Hook/B-Roll/Talking Head/Talking Head & B-Roll`, emphasis tagging (nouns/keywords/pictorial), emoji placement, translation tracks (SRT/VTT + optional burn-in), Edit plan panel (done on `worktree-edit-plan-and-shots`; real Ollama run pending install) | 3 |
| 3 | `2026-10-19-broll-and-overlays.md` (next) | Beat planner → Pexels stock / fal.ai image+video (per-project `mediaSource`), overlay layers in the Remotion composition, caption-aware placement | 5 |
| 4 | editor-ui | Touch-first timeline, overlay/B-roll panels, template customisation, consent banner, demo project, staged progress polish | §10.2, §10.6, spec 11.1/11.2/11.5 |
| 5 | agent-and-ops | Chat agent tool loop (`inspect_project / model_catalog / generate_assets / apply_actions / render_frame`), 30-day retention sweep, credit ledger, S3/R2 storage adapter, BullMQ runner | 7, 8, spec 11.2/11.9 |

Deviations recorded in plan 1: caption render uses Remotion (local FFmpeg has no libass); storage starts as filesystem under `DATA_DIR` with an S3 adapter deferred to plan 5; jobs start as an in-process runner (zero infra) with BullMQ deferred to plan 5.
