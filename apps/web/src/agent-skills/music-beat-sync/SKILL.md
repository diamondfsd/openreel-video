---
name: music-beat-sync
description: Music selection, generated BGM, beat analysis, and timeline synchronization. Use with luna-core whenever the user supplies music or asks for rhythm, beat cuts, BGM, drop, or a musical edit.
---

# Music Beat Sync

## Non-negotiable order

- Analyze the music before deciding cuts. Never guess BPM or replace analysis with evenly spaced estimates.
- Generated Luna music and user-provided music use the same `analyze_media_beats` and `sync_timeline_to_beats` workflow.
- If confidence is low or the BPM is ambiguous, use a sparse section-boundary grid instead of dense full-video cuts.

## Music source

- Generated background music: `list_music_templates` -> `get_music_template` -> adapt DSL -> `generate_background_music` -> `import_local_media`.
- User audio/video: import first, then call `analyze_media_beats` with the imported media id.
- Treat beat times as source-media seconds and map them through the audio clip's `startTime`, `inPoint`, and speed before editing the timeline.

## Cut mapping

- Use `sync_timeline_to_beats` mode `split` to cut existing visual clips at beat boundaries without discarding source content.
- Use mode `align` to move and trim short visual clips into beat-sized slots.
- Prefer downbeats or strong beats for major cuts. Use kick for impact, snare for substitutions, and hihat for micro-motion density.
- Do not cut on every beat. Low-energy sections should keep longer shots and holds.
- Reserve the strongest hits for the opening, climax, and ending. Read [references/beat-sync.md](references/beat-sync.md) for the detailed mapping and verification flow.

## Audio discipline

- Keep dialogue primary. Lower music under speech and restore it smoothly.
- Do not use music as a substitute for narrative structure. The edit must still make sense without the track.
- Verify the final timeline against the detected cut times before completion.
