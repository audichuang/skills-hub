# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Skills Hub is a Tauri 2 desktop app that manages AI coding tool skills (Cursor, Claude Code, Codex, Windsurf, etc.). It stores skills in a Central Repo (`~/.skillshub`) and syncs them to each tool via symlink/junction/copy — "Install once, sync everywhere."

## Tech Stack

- **Frontend:** React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4
- **Backend:** Rust (edition 2021, MSRV 1.77.2) + Tauri 2.9
- **Database:** SQLite via rusqlite (bundled), schema v3 with auto-migration
- **i18n:** i18next with 3 locales (en, zh-CN, zh-TW)

## Commands

```bash
# Development
npm install
npm run tauri:dev              # Full app with hot reload
npm run dev                    # Frontend only (port 5173)

# Full CI check (7 steps)
npm run check                  # lint + build + fmt:check + clippy + test
bash scripts/ci-check.sh       # Same + version/changelog validation

# Individual checks
npm run lint                   # ESLint
npm run build                  # tsc + vite build
npm run rust:fmt               # cargo fmt
npm run rust:fmt:check         # cargo fmt --check
npm run rust:clippy            # cargo clippy -D warnings
npm run rust:test              # cargo test (cd src-tauri)

# Run a single Rust test
cd src-tauri && cargo test test_name

# Version management (syncs package.json, Cargo.toml, tauri.conf.json)
npm run version:check          # Verify consistency
npm run version:set            # Set new version
```

## Architecture

```
Frontend (src/)                    Backend (src-tauri/src/)
├── App.tsx  ← state hub           ├── lib.rs  ← app init, plugin registration
├── components/skills/             ├── commands/mod.rs  ← all Tauri IPC commands
│   ├── Header, FilterBar          └── core/
│   ├── SkillCard, SkillsList          ├── skill_store.rs  ← SQLite CRUD
│   └── modals/ (11 modals)            ├── installer.rs    ← import/update logic
├── i18n/                              ├── sync_engine.rs  ← symlink/junction/copy
│   ├── index.ts  ← config            ├── git_fetcher.rs  ← git clone with fallback
│   └── resources.ts  ← all strings   ├── tool_adapters/  ← 40+ tool definitions
└── App.css  ← theme variables        ├── onboarding.rs   ← skill discovery
                                       ├── clawhub_api.rs  ← ClawHub integration
                                       ├── remote_sync.rs  ← SSH-based sync
                                       └── tests/
```

### Key Patterns

**Frontend → Backend IPC:** Components call `invoke("command_name", { args })` from `@tauri-apps/api`. All Tauri commands are in `commands/mod.rs` and use `spawn_blocking` for heavy work.

**State management:** All state lives in `App.tsx` via `useState` hooks (no Redux/Context). Data and callbacks are passed down as props.

**Sync engine priority:** symlink → junction (Windows) → copy. Content hashes detect identical vs conflicting skill variants.

**Git operations:** Prefers system `git` binary, falls back to libgit2. Clones go to temp dirs, then content is copied to Central Repo.

**Error conventions in commands:** Structured error prefixes for frontend parsing: `MULTI_SKILLS|`, `TARGET_EXISTS|`, `TOOL_NOT_INSTALLED|`.

**Tool adapters:** Each supported tool is defined with `key`, `display_name`, `skills_dir`, `detect_dir` in `core/tool_adapters/mod.rs`. Detection is via directory existence.

**i18n:** All user-facing strings go in `src/i18n/resources.ts`. Three locales must stay in sync: `en`, `zhCN`, `zhTW`. Use `t('key.path')` via `useTranslation()`.

**Database migrations:** Schema versioning in `skill_store.rs`. Migrations run on app startup. Current schema version is 3.

## Conventions

- Rust tests live in `src-tauri/src/core/tests/`. Test modules mirror the source file they test.
- Clippy runs with `-D warnings` (all warnings are errors).
- Version must be consistent across `package.json`, `Cargo.toml`, and `tauri.conf.json` — use `npm run version:set` to change it.
- Commit messages follow conventional commits: `feat:`, `fix:`, `chore:`, `style:`, `ci:`, `docs:`.
- PR checklist: lint + build + clippy + test must all pass. UI changes need screenshots.
