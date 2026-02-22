# Skills Hub - AI Assistant Guidelines

## 版本發布規則

* **升版本時必須同步更新 `CHANGELOG.md`**：使用 `node scripts/version.mjs set <x.y.z>` 升版後，必須在 `CHANGELOG.md` 新增對應版本條目，列出所有 Fixed / Added / Changed 項目。Release CI 的 `extract-changelog.mjs` 腳本會從 CHANGELOG 提取 release notes，若缺少條目會導致 CI 失敗。
* **Commit 前必須通過本地 CI 檢查**：執行 `bash scripts/ci-check.sh` 確認 eslint、cargo fmt、cargo clippy、cargo test 全部通過。
* **不要手動格式化 Rust 代碼**：依賴 `cargo fmt` 自動格式化，不要猜測格式。本地跑 `cd src-tauri && cargo fmt --all` 即可。
