# Changelog

## 0.1.0

- Add native iTerm2 working, waiting, and idle status for interactive omp sessions, including descendant agents and pending background work.
- Report questions, tool approvals, plan reviews, automatic retries, and automatic compaction through lifecycle hooks.
- Clear status on graceful shutdown and discard stale activity on session changes.
- Add `/iterm2` diagnostics and `/iterm2 clip Title | Markdown` for native review Clippings.
- Sanitize OSC detail fields, target Clippings by the originating terminal UUID, and avoid shell interpolation.
- Leave non-iTerm, headless, and multiplexer sessions untouched. No fork implementation or omp source changes.
