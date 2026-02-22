use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

const CLAWHUB_BASE_URL: &str = "https://clawhub.ai";

// ── Search ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Vec<SearchResultItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResultItem {
    score: f64,
    slug: Option<String>,
    display_name: Option<String>,
    summary: Option<String>,
    version: Option<String>,
    updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClawHubSkill {
    pub slug: String,
    pub display_name: String,
    pub summary: Option<String>,
    pub version: Option<String>,
    pub score: f64,
    pub updated_at: Option<i64>,
}

pub fn search_clawhub(query: &str, limit: usize) -> Result<Vec<ClawHubSkill>> {
    search_clawhub_inner(CLAWHUB_BASE_URL, query, limit)
}

fn search_clawhub_inner(
    base_url: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<ClawHubSkill>> {
    let client = Client::new();
    let base_url = base_url.trim_end_matches('/');
    let url = format!(
        "{}/api/v1/search?q={}&limit={}",
        base_url,
        urlencoding::encode(query),
        limit.clamp(1, 50)
    );

    let response = client
        .get(url)
        .header("User-Agent", "skills-hub")
        .send()
        .context("ClawHub search request failed")?
        .error_for_status()
        .context("ClawHub search returned error")?;

    let result: SearchResponse = response.json().context("parse ClawHub search response")?;

    Ok(result
        .results
        .into_iter()
        .filter_map(|item| {
            Some(ClawHubSkill {
                slug: item.slug?,
                display_name: item.display_name.unwrap_or_default(),
                summary: item.summary,
                version: item.version,
                score: item.score,
                updated_at: item.updated_at,
            })
        })
        .collect())
}

// ── Get Skill Detail ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetSkillResponse {
    skill: Option<SkillInfo>,
    latest_version: Option<VersionInfo>,
    owner: Option<OwnerInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillInfo {
    slug: String,
    display_name: String,
    summary: Option<String>,
    tags: Option<serde_json::Value>,
    stats: Option<StatsInfo>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct StatsInfo {
    downloads: Option<u64>,
    stars: Option<u64>,
    installs_all_time: Option<u64>,
    installs_current: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct VersionInfo {
    version: String,
    created_at: Option<i64>,
    changelog: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerInfo {
    handle: Option<String>,
    display_name: Option<String>,
    image: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClawHubSkillDetail {
    pub slug: String,
    pub display_name: String,
    pub summary: Option<String>,
    pub version: Option<String>,
    pub changelog: Option<String>,
    pub owner_handle: Option<String>,
    pub owner_name: Option<String>,
    pub owner_image: Option<String>,
    pub github_url: Option<String>,
    pub downloads: Option<u64>,
    pub stars: Option<u64>,
    pub installs_current: Option<u64>,
    pub installs_all_time: Option<u64>,
    pub tags: Option<Vec<String>>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

pub fn get_clawhub_skill(slug: &str) -> Result<ClawHubSkillDetail> {
    get_clawhub_skill_inner(CLAWHUB_BASE_URL, slug)
}

fn get_clawhub_skill_inner(base_url: &str, slug: &str) -> Result<ClawHubSkillDetail> {
    let client = Client::new();
    let base_url = base_url.trim_end_matches('/');
    let url = format!(
        "{}/api/v1/skills/{}",
        base_url,
        urlencoding::encode(slug)
    );

    let response = client
        .get(url)
        .header("User-Agent", "skills-hub")
        .send()
        .context("ClawHub get skill request failed")?
        .error_for_status()
        .context("ClawHub get skill returned error")?;

    let result: GetSkillResponse = response.json().context("parse ClawHub skill response")?;

    let skill = result
        .skill
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", slug))?;

    // extract tag names
    let tags = skill.tags.as_ref().and_then(|v| {
        v.as_object().map(|obj| obj.keys().cloned().collect::<Vec<_>>())
    });

    let github_url = result.owner.as_ref()
        .and_then(|o| o.handle.as_ref())
        .map(|handle| format!("https://github.com/{}/{}", handle, &skill.slug));

    Ok(ClawHubSkillDetail {
        slug: skill.slug,
        display_name: skill.display_name,
        summary: skill.summary,
        version: result.latest_version.as_ref().map(|v| v.version.clone()),
        changelog: result.latest_version.and_then(|v| v.changelog),
        owner_handle: result.owner.as_ref().and_then(|o| o.handle.clone()),
        owner_name: result.owner.as_ref().and_then(|o| o.display_name.clone()),
        owner_image: result.owner.and_then(|o| o.image),
        github_url,
        downloads: skill.stats.as_ref().and_then(|s| s.downloads),
        stars: skill.stats.as_ref().and_then(|s| s.stars),
        installs_current: skill.stats.as_ref().and_then(|s| s.installs_current),
        installs_all_time: skill.stats.as_ref().and_then(|s| s.installs_all_time),
        tags,
        created_at: skill.created_at,
        updated_at: skill.updated_at,
    })
}

// ── GitHub File Tree ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GitHubTreeResponse {
    tree: Vec<GitHubTreeEntry>,
}

#[derive(Debug, Deserialize)]
struct GitHubTreeEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileEntry {
    pub path: String,
    pub is_dir: bool,
}

pub fn get_github_tree(owner: &str, repo: &str) -> Result<Vec<SkillFileEntry>> {
    let client = Client::new();

    // try main first, then master
    for branch in &["main", "master"] {
        let url = format!(
            "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            branch
        );

        let response = client
            .get(&url)
            .header("User-Agent", "skills-hub")
            .send()
            .context("GitHub tree request failed")?;

        if response.status().is_success() {
            let result: GitHubTreeResponse =
                response.json().context("parse GitHub tree response")?;

            let entries: Vec<SkillFileEntry> = result
                .tree
                .into_iter()
                .map(|e| SkillFileEntry {
                    path: e.path,
                    is_dir: e.entry_type == "tree",
                })
                .collect();

            return Ok(entries);
        }
        // if not success, try next branch
    }

    anyhow::bail!("Could not fetch tree from GitHub (tried main and master branches)")
}

// ── Download + Extract ──────────────────────────────────────────────

/// Downloads a skill zip from ClawHub and extracts it into `target_dir`.
pub fn download_and_extract_clawhub_skill(
    slug: &str,
    version: Option<&str>,
    target_dir: &Path,
) -> Result<PathBuf> {
    download_and_extract_inner(CLAWHUB_BASE_URL, slug, version, target_dir)
}

fn download_and_extract_inner(
    base_url: &str,
    slug: &str,
    version: Option<&str>,
    target_dir: &Path,
) -> Result<PathBuf> {
    let client = Client::new();
    let base_url = base_url.trim_end_matches('/');
    let mut url = format!(
        "{}/api/v1/download?slug={}",
        base_url,
        urlencoding::encode(slug)
    );
    if let Some(v) = version {
        url.push_str(&format!("&version={}", urlencoding::encode(v)));
    }

    let response = client
        .get(&url)
        .header("User-Agent", "skills-hub")
        .send()
        .context("ClawHub download request failed")?
        .error_for_status()
        .context("ClawHub download returned error")?;

    let bytes = response.bytes().context("read ClawHub download body")?;

    let reader = std::io::Cursor::new(&bytes);
    let mut archive = zip::ZipArchive::new(reader).context("open zip archive")?;

    let extract_dir = target_dir.join(slug);
    std::fs::create_dir_all(&extract_dir)
        .with_context(|| format!("create extract dir {:?}", extract_dir))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).context("read zip entry")?;
        let name = file.name().to_string();

        // Skip directory entries and hidden/special files
        if file.is_dir() || name.starts_with("__MACOSX") || name.starts_with('.') {
            continue;
        }

        let out_path = extract_dir.join(&name);

        // Ensure parent directories exist
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut out_file = std::fs::File::create(&out_path)
            .with_context(|| format!("create file {:?}", out_path))?;
        std::io::copy(&mut file, &mut out_file)
            .with_context(|| format!("write file {:?}", out_path))?;
    }

    Ok(extract_dir)
}

#[cfg(test)]
#[path = "tests/clawhub_api.rs"]
mod tests;
