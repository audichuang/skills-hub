# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.3.1] - 2026-02-28

### Added

* **Custom target directories**: CRUD management for custom sync targets (local and remote), with per-skill toggle sync in SkillCard and SkillDetailModal.
* **SKILL.md content preview**: Read and display SKILL.md contents in SkillDetailModal via new `read_skill_content` backend command.
* **Remote directory browser**: Browse remote host directories when adding a custom target in Settings.
* Custom targets section in SkillCard merged into per-host VM sections; standalone local custom targets shown separately.
* `CLAUDE.md` added for Claude Code integration guidelines.
* New i18n keys for custom target UI across all three locales (EN / zh-CN / zh-TW).

### Changed

* Sync mode display refined: only non-symlink modes (e.g. `copy`) are explicitly labeled; `symlink` / `remote` / `sftp` modes show no extra badge.
* SkillDetailModal now shows VM tool matrix and custom target toggles alongside local tools.
* README updated to reflect Homebrew as the primary installation method; source build instructions simplified.

### Fixed

* `remoteToolStatuses` state now persisted from `sync_selected_skills_to_remote` so SkillCard can render the VM tool matrix.

## [0.3.0] - 2026-02-27

### Added

* **Traditional Chinese (zh-TW) locale**: Full translation with all 330+ keys; renamed `zh` to `zh-CN` (Simplified Chinese).
* **Source type filter**: Segment-control style pill buttons in FilterBar to filter skills by source (All / Local / Git / ClawHub).
* Language selector upgraded from toggle to 3-option `<select>` dropdown (EN / 简中 / 繁中) in both Header and Settings.
* Auto-migration of stored `zh` language preference to `zh-CN`.

### Changed

* **UI overhaul**: Migrated color palette from Zinc to Slate scale for a modern feel.
* Increased border-radius across the design system (4→6, 8→10, 12→14 px).
* Three-tier shadow system (`--shadow-sm`, `--shadow-md`, `--shadow-lg`).
* Header gains subtle `box-shadow` for depth separation.
* Skill cards use `bg-panel` with `shadow-sm` for elevated appearance; stronger hover lift (`shadow-md`).
* Empty state uses solid border + centered text instead of dashed border.
* Primary buttons gain `active` press-down effect.
* Modal backdrop uses `backdrop-filter: blur(4px)` for frosted-glass effect.
* Remote host description in Settings uses dedicated `.settings-hint` class instead of input styling.

### Fixed

* **VM connection handling**: TCP connect timeout (15 s), SSH session timeout (30 s).
* SSH `stderr` read order fixed (read before `wait_close`).
* SFTP `mkdir_p` now propagates errors instead of silently ignoring them.
* `default_tool_adapters()` cached outside loop in `sync_all_skills_to_remote`.
* `sync_all_skills_to_remote` uses partial-success mode (continues on individual skill failure).
* Port range validation (1–65535) added to `add_remote_host` / `update_remote_host`.
* Frontend tool detection race condition fixed (uses `Set` instead of single ID).
* Vertical centering for remote host description row in Settings.

## [0.2.2] - 2026-02-22

### Fixed

* SKILL.md frontmatter parser now accepts `***` and long dashes as delimiters.
* Orphan central directories (exist on disk but no DB record) are auto-cleaned during installation.
* `subpath="."` no longer derives skill name as `.`; uses repo name instead.
* Safety check prevents deleting central repo root during orphan cleanup.
* ESLint `set-state-in-effect` in ClawHubDetailModal and SkillDetailModal.

### Added

* CI auto-updates homebrew-tap cask after release (`update-homebrew-tap` job).
* Local CI check script (`scripts/ci-check.sh`).

## [0.2.1] - 2026-02-22

### Fixed

* Antigravity global skills directory corrected from `~/.gemini/antigravity/global_skills` to `~/.gemini/antigravity/skills` to match official Antigravity documentation.
* Release workflow now gracefully handles missing `TAURI_SIGNING_PRIVATE_KEY` by using `--no-sign` for macOS builds.

## [0.2.0] - 2026-02-01

### Added

* **Windows platform support**: Full support for Windows build and release (thanks @jrtxio [PR#6](https://github.com/qufei1993/skills-hub/pull/6)).
* Support and display for many new tools (e.g., Kimi Code CLI, Augment, OpenClaw, Cline, CodeBuddy, Command Code, Continue, Crush, Junie, iFlow CLI, Kiro CLI, Kode, MCPJam, Mistral Vibe, Mux, OpenClaude IDE, OpenHands, Pi, Qoder, Qwen Code, Trae/Trae CN, Zencoder, Neovate, Pochi, AdaL).
* UI confirmation and linked selection for tools that share the same global skills directory.
* Local import multi-skill discovery aligned with Git rules, with a selection list and invalid-item reasons.
* New local import commands for listing candidates and installing a selected subpath with SKILL.md validation.

### Changed

* Antigravity global skills directory updated to `~/.gemini/antigravity/skills`.
* OpenCode global skills directory corrected to `~/.config/opencode/skills`.
* Tool status now includes `skills_dir`; frontend tool list/sync is driven by backend data and deduped by directory.
* Sync/unsync now updates records across tools sharing a skills directory to avoid duplicate filesystem work and inconsistent state.
* Local import flow now scans candidates first; single valid candidate installs directly, multi-candidate opens selection.

## [0.1.1] - 2026-01-26

### Changed

* GitHub Actions release workflow for macOS packaging and uploading `updater.json` (`.github/workflows/release.yml`).
* Cursor sync now always uses directory copy due to Cursor not following symlinks when discovering skills: https://forum.cursor.com/t/cursor-doesnt-follow-symlinks-to-discover-skills/149693/4
* Managed skill update now re-syncs copy-mode targets using copy-only overwrite, and forces Cursor targets to copy to avoid accidental relinking.

## [0.1.0] - 2026-01-25

### Added

* Initial release of Skills Hub desktop app (Tauri + React).
* Central repository for Skills; sync to multiple AI coding tools (symlink/junction preferred, copy fallback).
* Local import from folders.
* Git import via repository URL or folder URL (`/tree/<branch>/<path>`), with multi-skill selection and batch install.
* Sync and update: copy-mode targets can be refreshed; managed skills can be updated from source.
* Migration intake: scan existing tool directories, import into central repo, and one‑click sync.
* New tool detection and optional sync.
* Basic settings: storage path, language, and theme.
* Git cache with cleanup (days) and freshness window (seconds).

### Build & Release

* Local packaging scripts for macOS (dmg), Windows (msi/nsis), Linux (deb/appimage).
* GitHub Actions build validation and tag-based draft releases (release notes pulled from `CHANGELOG.md`).

### Performance

* Git import and batch install optimizations: cached clones reduce repeated fetches; timeouts and non‑interactive git improve stability.
