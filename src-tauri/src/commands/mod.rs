use anyhow::Context;
use serde::Serialize;
use tauri::State;

use crate::core::cache_cleanup::{
    cleanup_git_cache_dirs, get_git_cache_cleanup_days as get_git_cache_cleanup_days_core,
    get_git_cache_ttl_secs as get_git_cache_ttl_secs_core,
    set_git_cache_cleanup_days as set_git_cache_cleanup_days_core,
    set_git_cache_ttl_secs as set_git_cache_ttl_secs_core,
};
use crate::core::central_repo::{ensure_central_repo, resolve_central_repo_path};
use crate::core::clawhub_api;
use crate::core::github_search::{search_github_repos, RepoSummary};
use crate::core::installer::{
    check_skill_updates as check_skill_updates_core, install_git_skill,
    install_git_skill_from_selection, install_local_skill, install_local_skill_from_selection,
    list_git_skills, list_local_skills, update_managed_skill_from_source, GitSkillCandidate,
    InstallResult, LocalSkillCandidate, SkillUpdateStatus,
};
use crate::core::onboarding::{build_onboarding_plan, OnboardingPlan};
use crate::core::remote_sync;
use crate::core::skill_store::{
    CustomTargetRecord, RemoteHostRecord, SkillStore, SkillTargetRecord,
};
use crate::core::sync_engine::{
    copy_dir_recursive, sync_dir_for_tool_with_overwrite, sync_dir_hybrid, SyncMode,
};
use crate::core::tool_adapters::{adapter_by_key, is_tool_installed, resolve_default_path};
use uuid::Uuid;

fn format_anyhow_error(err: anyhow::Error) -> String {
    let first = err.to_string();
    // Frontend relies on these prefixes for special flows.
    if first.starts_with("MULTI_SKILLS|")
        || first.starts_with("TARGET_EXISTS|")
        || first.starts_with("TOOL_NOT_INSTALLED|")
    {
        return first;
    }

    // Include the full error chain (causes), not just the top context.
    let mut full = format!("{:#}", err);

    // Redact noisy temp paths from clone context (we care about the cause, not the dest).
    // Example: `clone https://... into "/Users/.../skills-hub-git-<uuid>"`
    if let Some(head) = full.lines().next() {
        if head.starts_with("clone ") {
            if let Some(pos) = head.find(" into ") {
                let head_redacted = format!("{} (已省略临时目录)", &head[..pos]);
                let rest: String = full.lines().skip(1).collect::<Vec<_>>().join("\n");
                full = if rest.is_empty() {
                    head_redacted
                } else {
                    format!("{}\n{}", head_redacted, rest)
                };
            }
        }
    }

    let root = err.root_cause().to_string();
    let lower = full.to_lowercase();

    // Heuristic-friendly messaging for GitHub clone failures.
    if lower.contains("github.com")
        && (lower.contains("clone ") || lower.contains("remote") || lower.contains("fetch"))
    {
        if lower.contains("securetransport") {
            return format!(
        "无法从 GitHub 拉取仓库：TLS/证书校验失败（macOS SecureTransport）。\n\n建议：\n- 检查网络/代理是否拦截 HTTPS\n- 如在公司网络，可能需要安装公司根证书或使用可信代理\n- 也可在终端确认 `git clone {}` 是否可用\n\n详细：{}",
        "https://github.com/<owner>/<repo>",
        root
      );
        }
        let hint = if lower.contains("authentication")
            || lower.contains("permission denied")
            || lower.contains("credentials")
        {
            "无法访问该仓库：可能是私有仓库/权限不足/需要鉴权。"
        } else if lower.contains("not found") {
            "仓库不存在或无权限访问（GitHub 返回 not found）。"
        } else if lower.contains("failed to resolve")
            || lower.contains("could not resolve")
            || lower.contains("dns")
        {
            "无法解析 GitHub 域名（DNS）。请检查网络/代理。"
        } else if lower.contains("timed out") || lower.contains("timeout") {
            "连接 GitHub 超时。请检查网络/代理。"
        } else if lower.contains("connection refused") || lower.contains("connection reset") {
            "连接 GitHub 失败（连接被拒绝/重置）。请检查网络/代理。"
        } else {
            "无法从 GitHub 拉取仓库。请检查网络/代理，或稍后重试。"
        };

        return format!("{}\n\n详细：{}", hint, root);
    }

    full
}

#[derive(Debug, Serialize)]
pub struct ToolInfoDto {
    pub key: String,
    pub label: String,
    pub installed: bool,
    pub skills_dir: String,
}

#[derive(Debug, Serialize)]
pub struct ToolStatusDto {
    pub tools: Vec<ToolInfoDto>,
    pub installed: Vec<String>,
    pub newly_installed: Vec<String>,
}

#[tauri::command]
pub async fn get_tool_status(store: State<'_, SkillStore>) -> Result<ToolStatusDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let adapters = crate::core::tool_adapters::default_tool_adapters();
        let mut tools: Vec<ToolInfoDto> = Vec::new();
        let mut installed: Vec<String> = Vec::new();

        for adapter in &adapters {
            let ok = is_tool_installed(adapter)?;
            let key = adapter.id.as_key().to_string();
            let skills_dir = resolve_default_path(adapter)?.to_string_lossy().to_string();
            tools.push(ToolInfoDto {
                key: key.clone(),
                label: adapter.display_name.to_string(),
                installed: ok,
                skills_dir,
            });
            if ok {
                installed.push(key);
            }
        }

        installed.dedup();

        let prev: Vec<String> = store
            .get_setting("installed_tools_v1")?
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default();

        let prev_set: std::collections::HashSet<String> = prev.into_iter().collect();
        let newly_installed: Vec<String> = installed
            .iter()
            .filter(|k| !prev_set.contains(*k))
            .cloned()
            .collect();

        // Persist current set (best effort).
        let _ = store.set_setting(
            "installed_tools_v1",
            &serde_json::to_string(&installed).unwrap_or_else(|_| "[]".to_string()),
        );

        Ok::<_, anyhow::Error>(ToolStatusDto {
            tools,
            installed,
            newly_installed,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_onboarding_plan(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
) -> Result<OnboardingPlan, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || build_onboarding_plan(&app, &store))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_git_cache_cleanup_days(store: State<'_, SkillStore>) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, anyhow::Error>(get_git_cache_cleanup_days_core(&store))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn set_git_cache_cleanup_days(
    store: State<'_, SkillStore>,
    days: i64,
) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || set_git_cache_cleanup_days_core(&store, days))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn clear_git_cache_now(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_git_cache_dirs(&app, std::time::Duration::from_secs(0))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_git_cache_ttl_secs(store: State<'_, SkillStore>) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, anyhow::Error>(get_git_cache_ttl_secs_core(&store))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn set_git_cache_ttl_secs(
    store: State<'_, SkillStore>,
    secs: i64,
) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || set_git_cache_ttl_secs_core(&store, secs))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct InstallResultDto {
    pub skill_id: String,
    pub name: String,
    pub central_path: String,
    pub content_hash: Option<String>,
}

fn expand_home_path(input: &str) -> Result<std::path::PathBuf, anyhow::Error> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        anyhow::bail!("storage path is empty");
    }
    if trimmed == "~" {
        let home = dirs::home_dir().context("failed to resolve home directory")?;
        return Ok(home);
    }
    if let Some(stripped) = trimmed.strip_prefix("~/") {
        let home = dirs::home_dir().context("failed to resolve home directory")?;
        return Ok(home.join(stripped));
    }
    Ok(std::path::PathBuf::from(trimmed))
}

#[tauri::command]
pub async fn get_central_repo_path(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
) -> Result<String, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_central_repo_path(&app, &store)?;
        ensure_central_repo(&path)?;
        Ok::<_, anyhow::Error>(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn set_central_repo_path(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    path: String,
) -> Result<String, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let new_base = expand_home_path(&path)?;
        if !new_base.is_absolute() {
            anyhow::bail!("storage path must be absolute");
        }
        ensure_central_repo(&new_base)?;

        let current_base = resolve_central_repo_path(&app, &store)?;
        let skills = store.list_skills()?;
        if current_base == new_base {
            store.set_setting("central_repo_path", new_base.to_string_lossy().as_ref())?;
            return Ok::<_, anyhow::Error>(new_base.to_string_lossy().to_string());
        }

        if !skills.is_empty() {
            for skill in skills {
                let old_path = std::path::PathBuf::from(&skill.central_path);
                if !old_path.exists() {
                    anyhow::bail!("central path not found: {:?}", old_path);
                }
                let file_name = old_path
                    .file_name()
                    .ok_or_else(|| anyhow::anyhow!("invalid central path: {:?}", old_path))?;
                let new_path = new_base.join(file_name);
                if new_path.exists() {
                    anyhow::bail!("target path already exists: {:?}", new_path);
                }

                if let Err(err) = std::fs::rename(&old_path, &new_path) {
                    copy_dir_recursive(&old_path, &new_path)
                        .with_context(|| format!("copy {:?} -> {:?}", old_path, new_path))?;
                    std::fs::remove_dir_all(&old_path)
                        .with_context(|| format!("cleanup {:?}", old_path))?;
                    // Surface rename error in logs for troubleshooting.
                    eprintln!("rename failed, fallback used: {}", err);
                }

                let mut updated = skill.clone();
                updated.central_path = new_path.to_string_lossy().to_string();
                updated.updated_at = now_ms();
                store.upsert_skill(&updated)?;
            }
        }

        store.set_setting("central_repo_path", new_base.to_string_lossy().as_ref())?;
        Ok::<_, anyhow::Error>(new_base.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn install_local(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    sourcePath: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_local_skill(&app, &store, sourcePath.as_ref(), name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn list_local_skills_cmd(basePath: String) -> Result<Vec<LocalSkillCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::PathBuf::from(basePath);
        list_local_skills(&path)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn install_local_selection(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    basePath: String,
    subpath: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let base = std::path::PathBuf::from(basePath);
        let result =
            install_local_skill_from_selection(&app, &store, base.as_ref(), &subpath, name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn install_git(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    repoUrl: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_git_skill(&app, &store, &repoUrl, name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn list_git_skills_cmd(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    repoUrl: String,
) -> Result<Vec<GitSkillCandidate>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || list_git_skills(&app, &store, &repoUrl))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn install_git_selection(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    repoUrl: String,
    subpath: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_git_skill_from_selection(&app, &store, &repoUrl, &subpath, name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct SyncResultDto {
    pub mode_used: String,
    pub target_path: String,
}

#[tauri::command]
pub async fn sync_skill_dir(
    source_path: String,
    target_path: String,
) -> Result<SyncResultDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = sync_dir_hybrid(source_path.as_ref(), target_path.as_ref())?;
        Ok::<_, anyhow::Error>(SyncResultDto {
            mode_used: match result.mode_used {
                SyncMode::Auto => "auto",
                SyncMode::Symlink => "symlink",
                SyncMode::Junction => "junction",
                SyncMode::Copy => "copy",
            }
            .to_string(),
            target_path: result.target_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn sync_skill_to_tool(
    store: State<'_, SkillStore>,
    sourcePath: String,
    skillId: String,
    tool: String,
    name: String,
    overwrite: Option<bool>,
) -> Result<SyncResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let adapter = adapter_by_key(&tool).ok_or_else(|| anyhow::anyhow!("unknown tool"))?;
        if !is_tool_installed(&adapter)? {
            anyhow::bail!("TOOL_NOT_INSTALLED|{}", adapter.id.as_key());
        }
        let tool_root = resolve_default_path(&adapter)?;
        let target = tool_root.join(&name);
        let overwrite = overwrite.unwrap_or(false);
        let result =
            sync_dir_for_tool_with_overwrite(&tool, sourcePath.as_ref(), &target, overwrite)
                .map_err(|err| {
                    let msg = err.to_string();
                    if msg.contains("target already exists") {
                        anyhow::anyhow!("TARGET_EXISTS|{}", target.to_string_lossy())
                    } else {
                        anyhow::anyhow!(msg)
                    }
                })?;

        // Some tools share the same global skills directory; keep DB records consistent across them.
        let group = crate::core::tool_adapters::adapters_sharing_skills_dir(&adapter);
        for a in group {
            if !is_tool_installed(&a)? {
                continue;
            }
            let record = SkillTargetRecord {
                id: Uuid::new_v4().to_string(),
                skill_id: skillId.clone(),
                tool: a.id.as_key().to_string(),
                target_path: result.target_path.to_string_lossy().to_string(),
                mode: match result.mode_used {
                    SyncMode::Auto => "auto",
                    SyncMode::Symlink => "symlink",
                    SyncMode::Junction => "junction",
                    SyncMode::Copy => "copy",
                }
                .to_string(),
                status: "ok".to_string(),
                last_error: None,
                synced_at: Some(now_ms()),
            };
            store.upsert_skill_target(&record)?;
        }

        Ok::<_, anyhow::Error>(SyncResultDto {
            mode_used: match result.mode_used {
                SyncMode::Auto => "auto",
                SyncMode::Symlink => "symlink",
                SyncMode::Junction => "junction",
                SyncMode::Copy => "copy",
            }
            .to_string(),
            target_path: result.target_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn unsync_skill_from_tool(
    store: State<'_, SkillStore>,
    skillId: String,
    tool: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Some tools share the same global skills directory; unsync should update all of them.
        let group_tool_keys: Vec<String> = if let Some(adapter) = adapter_by_key(&tool) {
            let group = crate::core::tool_adapters::adapters_sharing_skills_dir(&adapter);
            // If none of the group tools are installed, do nothing (treat as already not effective).
            let mut any_installed = false;
            for a in &group {
                if is_tool_installed(a)? {
                    any_installed = true;
                    break;
                }
            }
            if !any_installed {
                return Ok::<_, anyhow::Error>(());
            }
            group
                .into_iter()
                .map(|a| a.id.as_key().to_string())
                .collect()
        } else {
            vec![tool.clone()]
        };

        // Remove filesystem target once (shared dir => shared target path).
        let mut removed = false;
        for k in &group_tool_keys {
            if let Some(target) = store.get_skill_target(&skillId, k)? {
                if !removed {
                    remove_path_any(&target.target_path).map_err(anyhow::Error::msg)?;
                    removed = true;
                }
                store.delete_skill_target(&skillId, k)?;
            }
        }

        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct UpdateResultDto {
    pub skill_id: String,
    pub name: String,
    pub content_hash: Option<String>,
    pub source_revision: Option<String>,
    pub updated_targets: Vec<String>,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn update_managed_skill(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    skillId: String,
) -> Result<UpdateResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let res = update_managed_skill_from_source(&app, &store, &skillId)?;
        Ok::<_, anyhow::Error>(UpdateResultDto {
            skill_id: res.skill_id,
            name: res.name,
            content_hash: res.content_hash,
            source_revision: res.source_revision,
            updated_targets: res.updated_targets,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn check_skill_updates(
    store: State<'_, SkillStore>,
) -> Result<Vec<SkillUpdateStatus>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || Ok::<_, String>(check_skill_updates_core(&store)))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn search_github(query: String, limit: Option<u32>) -> Result<Vec<RepoSummary>, String> {
    let limit = limit.unwrap_or(10) as usize;
    tauri::async_runtime::spawn_blocking(move || search_github_repos(&query, limit))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn import_existing_skill(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    sourcePath: String,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_local_skill(&app, &store, sourcePath.as_ref(), name)?;
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct ManagedSkillDto {
    pub id: String,
    pub name: String,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub central_path: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_sync_at: Option<i64>,
    pub status: String,
    pub targets: Vec<SkillTargetDto>,
}

#[derive(Debug, Serialize)]
pub struct SkillTargetDto {
    pub tool: String,
    pub mode: String,
    pub status: String,
    pub target_path: String,
    pub synced_at: Option<i64>,
}

#[tauri::command]
pub fn get_managed_skills(store: State<'_, SkillStore>) -> Result<Vec<ManagedSkillDto>, String> {
    get_managed_skills_impl(store.inner())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn delete_managed_skill(
    store: State<'_, SkillStore>,
    skillId: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // 便于排查“按钮点了没反应”：确认前端确实触发了命令
        println!("[delete_managed_skill] skillId={}", skillId);

        // 先删除已同步到各工具目录的副本/软链接
        // 注意：如果先删 skills 行，会触发 skill_targets cascade，导致无法再拿到 target_path
        let targets = store.list_skill_targets(&skillId)?;

        let mut remove_failures: Vec<String> = Vec::new();
        for target in targets {
            if let Err(err) = remove_path_any(&target.target_path) {
                remove_failures.push(format!("{}: {}", target.target_path, err));
            }
        }

        let record = store.get_skill_by_id(&skillId)?;
        if let Some(skill) = record {
            let path = std::path::PathBuf::from(skill.central_path);
            if path.exists() {
                std::fs::remove_dir_all(&path)?;
            }
            store.delete_skill(&skillId)?;
        }

        if !remove_failures.is_empty() {
            anyhow::bail!(
                "已删除托管记录，但清理部分工具目录失败：\n- {}",
                remove_failures.join("\n- ")
            );
        }

        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

fn remove_path_any(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Ok(());
    }

    let meta = std::fs::symlink_metadata(p).map_err(|err| err.to_string())?;
    let ft = meta.file_type();

    // 软链接（即使指向目录）也应该用 remove_file 删除链接本身
    if ft.is_symlink() {
        std::fs::remove_file(p).map_err(|err| err.to_string())?;
        return Ok(());
    }

    if ft.is_dir() {
        std::fs::remove_dir_all(p).map_err(|err| err.to_string())?;
        return Ok(());
    }

    std::fs::remove_file(p).map_err(|err| err.to_string())?;
    Ok(())
}

fn to_install_dto(result: InstallResult) -> InstallResultDto {
    InstallResultDto {
        skill_id: result.skill_id,
        name: result.name,
        central_path: result.central_path.to_string_lossy().to_string(),
        content_hash: result.content_hash,
    }
}

fn now_ms() -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    now.as_millis() as i64
}

fn get_managed_skills_impl(store: &SkillStore) -> Result<Vec<ManagedSkillDto>, String> {
    let skills = store.list_skills().map_err(|err| err.to_string())?;
    Ok(skills
        .into_iter()
        .map(|skill| {
            let targets = store
                .list_skill_targets(&skill.id)
                .unwrap_or_default()
                .into_iter()
                .map(|target| SkillTargetDto {
                    tool: target.tool,
                    mode: target.mode,
                    status: target.status,
                    target_path: target.target_path,
                    synced_at: target.synced_at,
                })
                .collect();

            ManagedSkillDto {
                id: skill.id,
                name: skill.name,
                source_type: skill.source_type,
                source_ref: skill.source_ref,
                central_path: skill.central_path,
                created_at: skill.created_at,
                updated_at: skill.updated_at,
                last_sync_at: skill.last_sync_at,
                status: skill.status,
                targets,
            }
        })
        .collect())
}

// ── Skill content preview ───────────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn read_skill_content(
    store: State<'_, SkillStore>,
    skillId: String,
) -> Result<String, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skill = store
            .get_skill_by_id(&skillId)?
            .ok_or_else(|| anyhow::anyhow!("skill not found"))?;
        let path = std::path::PathBuf::from(&skill.central_path).join("SKILL.md");
        if !path.exists() {
            anyhow::bail!("SKILL.md not found");
        }
        let content = std::fs::read_to_string(&path).with_context(|| format!("read {:?}", path))?;
        Ok::<_, anyhow::Error>(content)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

// ── ClawHub commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn search_clawhub(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<clawhub_api::ClawHubSkill>, String> {
    let limit = limit.unwrap_or(20) as usize;
    tauri::async_runtime::spawn_blocking(move || clawhub_api::search_clawhub(&query, limit))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_clawhub_skill_cmd(
    slug: String,
) -> Result<clawhub_api::ClawHubSkillDetail, String> {
    tauri::async_runtime::spawn_blocking(move || clawhub_api::get_clawhub_skill(&slug))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn get_github_tree_cmd(
    owner: String,
    repo: String,
) -> Result<Vec<clawhub_api::SkillFileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || clawhub_api::get_github_tree(&owner, &repo))
        .await
        .map_err(|err| err.to_string())?
        .map_err(format_anyhow_error)
}

#[tauri::command]
pub async fn install_clawhub_skill(
    app: tauri::AppHandle,
    store: State<'_, SkillStore>,
    slug: String,
    version: Option<String>,
    name: Option<String>,
) -> Result<InstallResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let temp_dir = tempfile::tempdir().context("create temp dir for clawhub download")?;
        let extracted_path = clawhub_api::download_and_extract_clawhub_skill(
            &slug,
            version.as_deref(),
            temp_dir.path(),
        )?;

        let display_name = name.unwrap_or_else(|| slug.clone());
        let result = install_local_skill(&app, &store, &extracted_path, Some(display_name))?;

        // Fix source info: replace temp path with clawhub slug so the record
        // remains valid after the temp dir is cleaned up.
        if let Some(mut record) = store.get_skill_by_id(&result.skill_id)? {
            record.source_type = "clawhub".to_string();
            record.source_ref = Some(format!("clawhub://{}", slug));
            store.upsert_skill(&record)?;
        }

        // temp_dir is automatically cleaned up when dropped
        Ok::<_, anyhow::Error>(to_install_dto(result))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

// ── Remote Host commands ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct RemoteHostDto {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_method: String,
    pub key_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_sync_at: Option<i64>,
    pub status: String,
}

fn record_to_dto(r: RemoteHostRecord) -> RemoteHostDto {
    RemoteHostDto {
        id: r.id,
        label: r.label,
        host: r.host,
        port: r.port,
        username: r.username,
        auth_method: r.auth_method,
        key_path: r.key_path,
        created_at: r.created_at,
        updated_at: r.updated_at,
        last_sync_at: r.last_sync_at,
        status: r.status,
    }
}

#[tauri::command]
pub async fn list_remote_hosts(store: State<'_, SkillStore>) -> Result<Vec<RemoteHostDto>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let hosts = store.list_remote_hosts().map_err(format_anyhow_error)?;
        Ok(hosts.into_iter().map(record_to_dto).collect())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn add_remote_host(
    store: State<'_, SkillStore>,
    label: String,
    host: String,
    port: Option<i64>,
    username: String,
    authMethod: Option<String>,
    keyPath: Option<String>,
) -> Result<RemoteHostDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let port = port.unwrap_or(22);
        if !(1..=65535).contains(&port) {
            anyhow::bail!("port must be between 1 and 65535, got {}", port);
        }
        let now = now_ms();
        let record = RemoteHostRecord {
            id: Uuid::new_v4().to_string(),
            label,
            host,
            port,
            username,
            auth_method: authMethod.unwrap_or_else(|| "key".to_string()),
            key_path: keyPath,
            created_at: now,
            updated_at: now,
            last_sync_at: None,
            status: "idle".to_string(),
        };
        store.upsert_remote_host(&record)?;
        Ok::<_, anyhow::Error>(record_to_dto(record))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case, clippy::too_many_arguments)]
pub async fn update_remote_host(
    store: State<'_, SkillStore>,
    id: String,
    label: String,
    host: String,
    port: Option<i64>,
    username: String,
    authMethod: Option<String>,
    keyPath: Option<String>,
) -> Result<RemoteHostDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let port = port.unwrap_or(22);
        if !(1..=65535).contains(&port) {
            anyhow::bail!("port must be between 1 and 65535, got {}", port);
        }
        let existing = store
            .get_remote_host_by_id(&id)?
            .ok_or_else(|| anyhow::anyhow!("remote host not found: {}", id))?;

        let record = RemoteHostRecord {
            id: existing.id,
            label,
            host,
            port,
            username,
            auth_method: authMethod.unwrap_or_else(|| "key".to_string()),
            key_path: keyPath,
            created_at: existing.created_at,
            updated_at: now_ms(),
            last_sync_at: existing.last_sync_at,
            status: existing.status,
        };
        store.upsert_remote_host(&record)?;
        Ok::<_, anyhow::Error>(record_to_dto(record))
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn delete_remote_host(
    store: State<'_, SkillStore>,
    hostId: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .delete_remote_host(&hostId)
            .map_err(format_anyhow_error)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn test_remote_connection(
    host: String,
    port: Option<u16>,
    username: String,
    authMethod: Option<String>,
    keyPath: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remote_sync::test_connection(
            &host,
            port.unwrap_or(22),
            &username,
            &authMethod.unwrap_or_else(|| "key".to_string()),
            keyPath.as_deref(),
        )
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[derive(Debug, Serialize)]
pub struct RemoteToolInfoDto {
    pub key: String,
    pub label: String,
    pub installed: bool,
}

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct RemoteToolStatusDto {
    pub hostId: String,
    pub tools: Vec<RemoteToolInfoDto>,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_remote_tool_status(
    store: State<'_, SkillStore>,
    hostId: String,
) -> Result<RemoteToolStatusDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let host = store
            .get_remote_host_by_id(&hostId)
            .map_err(format_anyhow_error)?
            .ok_or_else(|| format!("remote host not found: {}", hostId))?;

        let sess = remote_sync::create_ssh_session(
            &host.host,
            host.port as u16,
            &host.username,
            &host.auth_method,
            host.key_path.as_deref(),
        )
        .map_err(format_anyhow_error)?;

        let tools = remote_sync::detect_remote_tools(&sess).map_err(format_anyhow_error)?;

        Ok(RemoteToolStatusDto {
            hostId,
            tools: tools
                .into_iter()
                .map(|(key, label, installed)| RemoteToolInfoDto {
                    key,
                    label,
                    installed,
                })
                .collect(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct RemoteSyncResultDto {
    pub syncedSkills: Vec<String>,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn sync_all_skills_to_remote(
    store: State<'_, SkillStore>,
    hostId: String,
    toolKeys: Vec<String>,
) -> Result<RemoteSyncResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let host = store
            .get_remote_host_by_id(&hostId)
            .map_err(format_anyhow_error)?
            .ok_or_else(|| format!("remote host not found: {}", hostId))?;

        store
            .update_remote_host_sync_status(&hostId, "syncing", None)
            .ok();

        let sess = remote_sync::create_ssh_session(
            &host.host,
            host.port as u16,
            &host.username,
            &host.auth_method,
            host.key_path.as_deref(),
        )
        .map_err(|e| {
            store
                .update_remote_host_sync_status(&hostId, "error", None)
                .ok();
            format_anyhow_error(e)
        })?;

        let skills = store.list_skills().map_err(format_anyhow_error)?;
        let skill_pairs: Vec<(String, std::path::PathBuf)> = skills
            .into_iter()
            .map(|s| (s.name, std::path::PathBuf::from(s.central_path)))
            .collect();

        let synced = remote_sync::sync_all_skills_to_remote(&sess, &skill_pairs, &toolKeys)
            .map_err(|e| {
                store
                    .update_remote_host_sync_status(&hostId, "error", None)
                    .ok();
                format_anyhow_error(e)
            })?;

        store
            .update_remote_host_sync_status(&hostId, "ok", Some(now_ms()))
            .ok();

        Ok(RemoteSyncResultDto {
            syncedSkills: synced,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn sync_remote_skill_to_tool(
    store: State<'_, SkillStore>,
    hostId: String,
    skillId: String,
    toolKey: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let host = store
            .get_remote_host_by_id(&hostId)
            .map_err(format_anyhow_error)?
            .ok_or_else(|| format!("remote host not found: {}", hostId))?;

        let skill = store
            .get_skill_by_id(&skillId)
            .map_err(format_anyhow_error)?
            .ok_or_else(|| format!("skill not found: {}", skillId))?;

        let sess = remote_sync::create_ssh_session(
            &host.host,
            host.port as u16,
            &host.username,
            &host.auth_method,
            host.key_path.as_deref(),
        )
        .map_err(format_anyhow_error)?;

        let local_path = std::path::PathBuf::from(&skill.central_path);
        remote_sync::sync_skill_to_remote_tool(&sess, &skill.name, &local_path, &toolKey)
            .map_err(format_anyhow_error)?;

        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct RemoteSkillsDto {
    pub hostId: String,
    pub skills: Vec<String>,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn list_remote_skills(
    store: State<'_, SkillStore>,
    hostId: String,
) -> Result<RemoteSkillsDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let host = store
            .get_remote_host_by_id(&hostId)
            .map_err(format_anyhow_error)?
            .ok_or_else(|| format!("remote host not found: {}", hostId))?;

        let sess = remote_sync::create_ssh_session(
            &host.host,
            host.port as u16,
            &host.username,
            &host.auth_method,
            host.key_path.as_deref(),
        )
        .map_err(format_anyhow_error)?;

        let skills = remote_sync::list_remote_skills(&sess).map_err(format_anyhow_error)?;

        // SSH succeeded → reset status if it was previously "error"
        store
            .update_remote_host_sync_status(&hostId, "ok", None)
            .ok();

        Ok(RemoteSkillsDto { hostId, skills })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn sync_selected_skills_to_remote(
    store: State<'_, SkillStore>,
    hostId: String,
    skillIds: Vec<String>,
    toolKeys: Vec<String>,
) -> Result<RemoteSyncResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let host = store
            .get_remote_host_by_id(&hostId)
            .map_err(format_anyhow_error)?
            .ok_or_else(|| format!("remote host not found: {}", hostId))?;

        store
            .update_remote_host_sync_status(&hostId, "syncing", None)
            .ok();

        let sess = remote_sync::create_ssh_session(
            &host.host,
            host.port as u16,
            &host.username,
            &host.auth_method,
            host.key_path.as_deref(),
        )
        .map_err(|e| {
            store
                .update_remote_host_sync_status(&hostId, "error", None)
                .ok();
            format_anyhow_error(e)
        })?;

        let all_skills = store.list_skills().map_err(format_anyhow_error)?;
        let skill_ids_set: std::collections::HashSet<&str> =
            skillIds.iter().map(|s| s.as_str()).collect();
        let skill_pairs: Vec<(String, std::path::PathBuf)> = all_skills
            .into_iter()
            .filter(|s| skill_ids_set.contains(s.id.as_str()))
            .map(|s| (s.name, std::path::PathBuf::from(s.central_path)))
            .collect();

        let synced = remote_sync::sync_all_skills_to_remote(&sess, &skill_pairs, &toolKeys)
            .map_err(|e| {
                store
                    .update_remote_host_sync_status(&hostId, "error", None)
                    .ok();
                format_anyhow_error(e)
            })?;

        store
            .update_remote_host_sync_status(&hostId, "ok", Some(now_ms()))
            .ok();

        Ok(RemoteSyncResultDto {
            syncedSkills: synced,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

// ── Custom Target Commands ──────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CustomTargetDto {
    pub id: String,
    pub label: String,
    pub path: String,
    #[serde(rename = "remote_host_id")]
    pub remote_host_id: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub async fn list_custom_targets(
    store: State<'_, SkillStore>,
) -> Result<Vec<CustomTargetDto>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let targets = store.list_custom_targets()?;
        Ok::<_, anyhow::Error>(
            targets
                .into_iter()
                .map(|t| CustomTargetDto {
                    id: t.id,
                    label: t.label,
                    path: t.path,
                    remote_host_id: t.remote_host_id,
                    created_at: t.created_at,
                })
                .collect(),
        )
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn add_custom_target(
    store: State<'_, SkillStore>,
    label: String,
    path: String,
    remoteHostId: Option<String>,
) -> Result<CustomTargetDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = if remoteHostId.is_some() {
            // Remote: path is a remote path, just validate it looks absolute-ish
            if !path.starts_with('/') {
                anyhow::bail!("remote custom target path must be absolute (start with /)");
            }
            // Verify the remote host exists
            if let Some(ref rh_id) = remoteHostId {
                store
                    .get_remote_host_by_id(rh_id)?
                    .ok_or_else(|| anyhow::anyhow!("remote host not found"))?;
            }
            path.clone()
        } else {
            // Local: expand ~ and ensure directory exists
            let expanded = expand_home_path(&path)?;
            if !expanded.is_absolute() {
                anyhow::bail!("custom target path must be absolute");
            }
            std::fs::create_dir_all(&expanded)
                .with_context(|| format!("failed to create directory {:?}", expanded))?;
            expanded.to_string_lossy().to_string()
        };

        let id = Uuid::new_v4().to_string();
        let record = CustomTargetRecord {
            id: id.clone(),
            label: label.clone(),
            path: canonical.clone(),
            remote_host_id: remoteHostId.clone(),
            created_at: now_ms(),
        };
        store.upsert_custom_target(&record)?;
        Ok::<_, anyhow::Error>(CustomTargetDto {
            id,
            label,
            path: canonical,
            remote_host_id: remoteHostId,
            created_at: record.created_at,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn delete_custom_target(
    store: State<'_, SkillStore>,
    targetId: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let tool_key = format!("custom:{}", targetId);
        // Remove filesystem targets for all skills synced to this custom target.
        let all_skills = store.list_skills()?;
        for skill in &all_skills {
            if let Some(target) = store.get_skill_target(&skill.id, &tool_key)? {
                let _ = remove_path_any(&target.target_path);
            }
        }
        store.delete_custom_target(&targetId)?;
        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn sync_skill_to_custom_target(
    store: State<'_, SkillStore>,
    sourcePath: String,
    skillId: String,
    customTargetId: String,
    name: String,
    overwrite: Option<bool>,
) -> Result<SyncResultDto, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ct = store
            .get_custom_target_by_id(&customTargetId)?
            .ok_or_else(|| anyhow::anyhow!("custom target not found"))?;

        let tool_key = format!("custom:{}", customTargetId);

        if let Some(ref remote_host_id) = ct.remote_host_id {
            // ── Remote sync via SSH (symlink from central) ──────────
            let host = store
                .get_remote_host_by_id(remote_host_id)?
                .ok_or_else(|| anyhow::anyhow!("remote host not found"))?;

            let sess = crate::core::remote_sync::create_ssh_session(
                &host.host,
                host.port as u16,
                &host.username,
                &host.auth_method,
                host.key_path.as_deref(),
            )?;

            let local_path = std::path::Path::new(&sourcePath);

            // 1. Ensure skill exists in VM central (~/.skillshub/<name>/)
            let home = crate::core::remote_sync::ssh_exec(&sess, "echo $HOME")?;
            let home = home.trim();
            let abs_central = format!("{}/.skillshub/{}", home, name);
            crate::core::remote_sync::ssh_exec(&sess, &format!("mkdir -p '{}'", abs_central))?;
            crate::core::remote_sync::sftp_upload_dir(&sess, local_path, &abs_central)?;

            // 2. Symlink from central to custom target path
            let remote_dest = format!("{}/{}", ct.path.trim_end_matches('/'), name);
            crate::core::remote_sync::create_remote_symlink(&sess, &abs_central, &remote_dest)?;

            let record = SkillTargetRecord {
                id: Uuid::new_v4().to_string(),
                skill_id: skillId.clone(),
                tool: tool_key,
                target_path: remote_dest.clone(),
                mode: "symlink".to_string(),
                status: "ok".to_string(),
                last_error: None,
                synced_at: Some(now_ms()),
            };
            store.upsert_skill_target(&record)?;

            Ok::<_, anyhow::Error>(SyncResultDto {
                mode_used: "symlink".to_string(),
                target_path: remote_dest,
            })
        } else {
            // ── Local sync ──────────────────────────────────────────
            let target_root = std::path::PathBuf::from(&ct.path);
            let target = target_root.join(&name);
            let overwrite = overwrite.unwrap_or(false);
            let result = crate::core::sync_engine::sync_dir_hybrid_with_overwrite(
                sourcePath.as_ref(),
                &target,
                overwrite,
            )
            .map_err(|err| {
                let msg = err.to_string();
                if msg.contains("target already exists") {
                    anyhow::anyhow!("TARGET_EXISTS|{}", target.to_string_lossy())
                } else {
                    anyhow::anyhow!(msg)
                }
            })?;

            let record = SkillTargetRecord {
                id: Uuid::new_v4().to_string(),
                skill_id: skillId.clone(),
                tool: tool_key,
                target_path: result.target_path.to_string_lossy().to_string(),
                mode: match result.mode_used {
                    SyncMode::Auto => "auto",
                    SyncMode::Symlink => "symlink",
                    SyncMode::Junction => "junction",
                    SyncMode::Copy => "copy",
                }
                .to_string(),
                status: "ok".to_string(),
                last_error: None,
                synced_at: Some(now_ms()),
            };
            store.upsert_skill_target(&record)?;

            Ok::<_, anyhow::Error>(SyncResultDto {
                mode_used: match result.mode_used {
                    SyncMode::Auto => "auto",
                    SyncMode::Symlink => "symlink",
                    SyncMode::Junction => "junction",
                    SyncMode::Copy => "copy",
                }
                .to_string(),
                target_path: result.target_path.to_string_lossy().to_string(),
            })
        }
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn unsync_skill_from_custom_target(
    store: State<'_, SkillStore>,
    skillId: String,
    customTargetId: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ct = store.get_custom_target_by_id(&customTargetId)?;
        let tool_key = format!("custom:{}", customTargetId);

        if let Some(target) = store.get_skill_target(&skillId, &tool_key)? {
            if let Some(ct) = ct {
                if let Some(ref remote_host_id) = ct.remote_host_id {
                    // ── Remote: rm via SSH ───────────────────────────
                    let host = store
                        .get_remote_host_by_id(remote_host_id)?
                        .ok_or_else(|| anyhow::anyhow!("remote host not found"))?;
                    let sess = crate::core::remote_sync::create_ssh_session(
                        &host.host,
                        host.port as u16,
                        &host.username,
                        &host.auth_method,
                        host.key_path.as_deref(),
                    )?;
                    crate::core::remote_sync::ssh_exec(
                        &sess,
                        &format!("rm -rf '{}'", target.target_path),
                    )?;
                } else {
                    // ── Local: remove path ───────────────────────────
                    remove_path_any(&target.target_path).map_err(anyhow::Error::msg)?;
                }
            } else {
                // custom target was deleted but skill_target remains; just clean up local
                let _ = remove_path_any(&target.target_path);
            }
            store.delete_skill_target(&skillId, &tool_key)?;
        }
        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

// ── Remote Directory Browsing ───────────────────────────────────────────

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct RemoteDirEntry {
    pub name: String,
    pub isDir: bool,
}

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct RemoteBrowseResult {
    pub currentPath: String,
    pub entries: Vec<RemoteDirEntry>,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn browse_remote_directory(
    store: State<'_, SkillStore>,
    hostId: String,
    path: Option<String>,
) -> Result<RemoteBrowseResult, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let host = store
            .get_remote_host_by_id(&hostId)?
            .ok_or_else(|| anyhow::anyhow!("remote host not found"))?;

        let sess = crate::core::remote_sync::create_ssh_session(
            &host.host,
            host.port as u16,
            &host.username,
            &host.auth_method,
            host.key_path.as_deref(),
        )?;

        // Resolve path: default to ~ (home), resolve ~ prefix
        let raw_path = path.unwrap_or_else(|| "~".to_string());
        let resolved = if raw_path == "~" || raw_path.starts_with("~/") {
            let home = crate::core::remote_sync::ssh_exec(&sess, "echo $HOME")?;
            let home = home.trim();
            if raw_path == "~" {
                home.to_string()
            } else {
                format!("{}{}", home, &raw_path[1..])
            }
        } else {
            raw_path.clone()
        };

        // List directories only, one per line
        let cmd = format!(
            "find '{}' -maxdepth 1 -mindepth 1 -type d -printf '%f\\n' 2>/dev/null | sort",
            resolved
        );
        let output = crate::core::remote_sync::ssh_exec(&sess, &cmd).unwrap_or_default();

        let entries: Vec<RemoteDirEntry> = output
            .lines()
            .filter(|l| !l.is_empty())
            .map(|name| RemoteDirEntry {
                name: name.to_string(),
                isDir: true,
            })
            .collect();

        Ok::<_, anyhow::Error>(RemoteBrowseResult {
            currentPath: resolved,
            entries,
        })
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(format_anyhow_error)
}

#[cfg(test)]
#[path = "tests/commands.rs"]
mod tests;
