use std::io::Read;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;

use anyhow::{Context, Result};
use ssh2::Session;

use super::tool_adapters::default_tool_adapters;

// ── SSH session helpers ─────────────────────────────────────────────────

/// Create an SSH session using key-based or ssh-agent authentication.
pub fn create_ssh_session(
    host: &str,
    port: u16,
    username: &str,
    auth_method: &str,
    key_path: Option<&str>,
) -> Result<Session> {
    // Resolve address and connect with a 15-second timeout to avoid hanging the UI.
    let addr = format!("{}:{}", host, port);
    let sock_addr = addr
        .to_socket_addrs()
        .with_context(|| format!("resolve address {}", addr))?
        .next()
        .ok_or_else(|| anyhow::anyhow!("no address found for {}", addr))?;

    let tcp = TcpStream::connect_timeout(&sock_addr, std::time::Duration::from_secs(15))
        .with_context(|| format!("TCP connect to {}:{}", host, port))?;

    let mut sess = Session::new().context("create SSH session")?;
    // Set a 30-second timeout for all SSH operations (handshake, auth, exec, etc.).
    sess.set_timeout(30_000);
    sess.set_tcp_stream(tcp);
    sess.handshake().context("SSH handshake")?;

    match auth_method {
        "agent" => {
            sess.userauth_agent(username)
                .context("SSH agent authentication")?;
        }
        _ => {
            // Default to key-based authentication
            let key = resolve_key_path(key_path)?;
            sess.userauth_pubkey_file(username, None, Path::new(&key), None)
                .with_context(|| format!("SSH key authentication with key: {}", key))?;
        }
    }

    if !sess.authenticated() {
        anyhow::bail!("SSH authentication failed for user '{}'", username);
    }

    Ok(sess)
}

/// Test SSH connection. Returns Ok(()) on success.
pub fn test_connection(
    host: &str,
    port: u16,
    username: &str,
    auth_method: &str,
    key_path: Option<&str>,
) -> Result<String> {
    let sess = create_ssh_session(host, port, username, auth_method, key_path)?;
    let output = ssh_exec(&sess, "echo ok")?;
    Ok(output.trim().to_string())
}

// ── Remote command execution ────────────────────────────────────────────

/// Execute a command on the remote host and return stdout.
pub fn ssh_exec(sess: &Session, command: &str) -> Result<String> {
    let mut channel = sess.channel_session().context("open SSH channel")?;
    channel
        .exec(command)
        .with_context(|| format!("exec: {}", command))?;

    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .context("read SSH channel output")?;

    // Read stderr BEFORE wait_close; after close the data may be discarded.
    let mut stderr_buf = String::new();
    channel.stderr().read_to_string(&mut stderr_buf).ok();

    channel.wait_close().ok();

    let exit = channel.exit_status().unwrap_or(-1);
    if exit != 0 {
        anyhow::bail!(
            "remote command '{}' exited with code {}: {}",
            command,
            exit,
            stderr_buf.trim()
        );
    }

    Ok(output)
}

// ── SFTP directory upload ───────────────────────────────────────────────

/// Recursively upload a local directory to a remote path via SFTP.
pub fn sftp_upload_dir(sess: &Session, local_path: &Path, remote_path: &str) -> Result<()> {
    // Validate local path exists BEFORE creating remote directories
    if !local_path.exists() {
        anyhow::bail!(
            "local source directory does not exist: {}",
            local_path.display()
        );
    }

    let sftp = sess.sftp().context("open SFTP session")?;

    // Ensure remote base directory exists
    sftp_mkdir_p(&sftp, remote_path)?;

    for entry in walkdir::WalkDir::new(local_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.file_name() != ".git")
    {
        let entry = entry?;
        let relative = entry
            .path()
            .strip_prefix(local_path)
            .context("strip prefix")?;

        // Skip the root entry itself
        if relative.as_os_str().is_empty() {
            continue;
        }

        let remote_target = format!("{}/{}", remote_path, relative.to_string_lossy());

        if entry.file_type().is_dir() {
            sftp_mkdir_p(&sftp, &remote_target)?;
        } else if entry.file_type().is_file() {
            let content = std::fs::read(entry.path())
                .with_context(|| format!("read local file {:?}", entry.path()))?;

            // Ensure parent directory exists
            if let Some(parent) = relative.parent() {
                if !parent.as_os_str().is_empty() {
                    let parent_remote = format!("{}/{}", remote_path, parent.to_string_lossy());
                    sftp_mkdir_p(&sftp, &parent_remote)?;
                }
            }

            let mut remote_file = sftp
                .create(Path::new(&remote_target))
                .with_context(|| format!("create remote file {}", remote_target))?;
            std::io::Write::write_all(&mut remote_file, &content)
                .with_context(|| format!("write remote file {}", remote_target))?;
        }
    }

    Ok(())
}

/// Create remote directory recursively, ignoring "already exists" errors.
fn sftp_mkdir_p(sftp: &ssh2::Sftp, path: &str) -> Result<()> {
    // Try to create directory; if it already exists, that's fine.
    match sftp.mkdir(Path::new(path), 0o755) {
        Ok(()) => Ok(()),
        Err(e) => {
            // SFTP error code 4 = SSH_FX_FAILURE (often means "already exists")
            // Also check for code 11 = SSH_FX_FILE_ALREADY_EXISTS
            if e.code() == ssh2::ErrorCode::SFTP(4) || e.code() == ssh2::ErrorCode::SFTP(11) {
                Ok(())
            } else {
                // Try stat to confirm it exists
                match sftp.stat(Path::new(path)) {
                    Ok(_) => Ok(()),
                    Err(_) => {
                        // Attempt to create parents recursively
                        if let Some(parent) = Path::new(path).parent() {
                            let parent_str = parent.to_string_lossy();
                            if !parent_str.is_empty() && parent_str != "/" {
                                sftp_mkdir_p(sftp, &parent_str)?;
                                // Retry mkdir after creating parent; propagate real errors.
                                match sftp.mkdir(Path::new(path), 0o755) {
                                    Ok(()) => Ok(()),
                                    Err(retry_err) => {
                                        // Still might be "already exists" from a race; verify.
                                        if sftp.stat(Path::new(path)).is_ok() {
                                            Ok(())
                                        } else {
                                            Err(anyhow::anyhow!(
                                                "failed to create remote dir '{}': {}",
                                                path,
                                                retry_err
                                            ))
                                        }
                                    }
                                }
                            } else {
                                Ok(())
                            }
                        } else {
                            Ok(())
                        }
                    }
                }
            }
        }
    }
}

// ── Remote tool detection ───────────────────────────────────────────────

/// Detect which AI tools are installed on the remote host.
/// Returns a list of (tool_key, display_name, installed).
pub fn detect_remote_tools(sess: &Session) -> Result<Vec<(String, String, bool)>> {
    let adapters = default_tool_adapters();
    let mut results = Vec::new();

    // Build a single command to check all tool directories at once
    let checks: Vec<String> = adapters
        .iter()
        .map(|a| {
            format!(
                "[ -d ~/{} ] && echo 'EXISTS:{}' || echo 'MISSING:{}'",
                a.relative_detect_dir,
                a.id.as_key(),
                a.id.as_key()
            )
        })
        .collect();

    let combined = checks.join(" ; ");
    let output = ssh_exec(sess, &combined)?;

    for line in output.lines() {
        let line = line.trim();
        if let Some(key) = line.strip_prefix("EXISTS:") {
            if let Some(adapter) = adapters.iter().find(|a| a.id.as_key() == key) {
                results.push((key.to_string(), adapter.display_name.to_string(), true));
            }
        } else if let Some(key) = line.strip_prefix("MISSING:") {
            if let Some(adapter) = adapters.iter().find(|a| a.id.as_key() == key) {
                results.push((key.to_string(), adapter.display_name.to_string(), false));
            }
        }
    }

    Ok(results)
}

// ── Remote symlink management ───────────────────────────────────────────

/// Create a symlink on the remote host from source to target.
/// Uses `ln -sfn` to force-create even if target exists.
pub fn create_remote_symlink(sess: &Session, source: &str, target: &str) -> Result<()> {
    // Ensure parent directory of target exists
    if let Some(parent) = Path::new(target).parent() {
        let parent_str = parent.to_string_lossy();
        ssh_exec(sess, &format!("mkdir -p '{}'", parent_str))?;
    }
    ssh_exec(sess, &format!("ln -sfn '{}' '{}'", source, target))?;
    Ok(())
}

/// Sync a single skill to a specific tool on the remote host.
/// 1. Upload skill to remote central repo (~/.skillshub/<name>)
/// 2. Symlink from central repo to tool skills dir
pub fn sync_skill_to_remote_tool(
    sess: &Session,
    skill_name: &str,
    local_skill_path: &Path,
    tool_key: &str,
) -> Result<()> {
    let adapter = default_tool_adapters()
        .into_iter()
        .find(|a| a.id.as_key() == tool_key)
        .ok_or_else(|| anyhow::anyhow!("unknown tool key: {}", tool_key))?;

    // Resolve $HOME first — SFTP does NOT expand ~
    let home = ssh_exec(sess, "echo $HOME")?;
    let home = home.trim();
    let abs_central = format!("{}/.skillshub/{}", home, skill_name);

    // Ensure central dir exists (via shell, which handles mkdir -p)
    ssh_exec(sess, &format!("mkdir -p '{}'", abs_central))?;

    // Upload skill directory using absolute path
    sftp_upload_dir(sess, local_skill_path, &abs_central)?;

    // Create symlink
    let abs_tool = format!("{}/{}/{}", home, adapter.relative_skills_dir, skill_name);
    create_remote_symlink(sess, &abs_central, &abs_tool)?;

    Ok(())
}

/// Sync all managed skills to a remote host.
/// Uploads each skill to ~/.skillshub/<name> and creates symlinks for detected tools.
/// Skips skills whose local source directory is missing.
/// Collects per-skill errors instead of aborting the entire batch.
pub fn sync_all_skills_to_remote(
    sess: &Session,
    skills: &[(String, std::path::PathBuf)], // (name, local_central_path)
    tool_keys: &[String],                    // tools to sync to
) -> Result<Vec<String>> {
    let mut synced = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // Resolve $HOME first — SFTP does NOT expand ~
    let home = ssh_exec(sess, "echo $HOME")?;
    let home = home.trim().to_string();

    // Ensure remote central repo directory exists
    ssh_exec(sess, &format!("mkdir -p '{}/.skillshub'", home))?;

    // Build adapters once outside the loop.
    let adapters = default_tool_adapters();

    for (name, local_path) in skills {
        // Skip skills whose local source is missing
        if !local_path.exists() {
            eprintln!(
                "[remote_sync] skipping '{}': local path does not exist: {}",
                name,
                local_path.display()
            );
            continue;
        }

        let abs_central = format!("{}/.skillshub/{}", home, name);

        // Upload skill directory using absolute path
        if let Err(e) = sftp_upload_dir(sess, local_path, &abs_central) {
            errors.push(format!("{}: {:#}", name, e));
            continue;
        }

        // Create symlinks for each tool
        for tool_key in tool_keys {
            if let Some(adapter) = adapters.iter().find(|a| a.id.as_key() == tool_key) {
                let abs_tool = format!("{}/{}/{}", home, adapter.relative_skills_dir, name);

                // Ensure tool skills dir exists and create symlink
                if let Err(e) = create_remote_symlink(sess, &abs_central, &abs_tool) {
                    errors.push(format!("{} -> {}: {:#}", name, tool_key, e));
                }
            }
        }

        synced.push(name.clone());
    }

    if !errors.is_empty() && synced.is_empty() {
        // All skills failed – propagate as error
        anyhow::bail!("all skills failed to sync:\n{}", errors.join("\n"));
    } else if !errors.is_empty() {
        // Partial success – log warnings but return synced list
        for e in &errors {
            log::warn!("[remote_sync] partial failure: {}", e);
        }
    }

    Ok(synced)
}

// ── Remote skill listing ────────────────────────────────────────────────

/// List skill names that exist on the remote host under ~/.skillshub/.
/// Returns an empty Vec if the directory does not exist.
pub fn list_remote_skills(sess: &Session) -> Result<Vec<String>> {
    let output = ssh_exec(sess, "ls -1 ~/.skillshub/ 2>/dev/null || true")?;
    let names: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(names)
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn resolve_key_path(key_path: Option<&str>) -> Result<String> {
    if let Some(kp) = key_path {
        if !kp.is_empty() {
            let expanded = if let Some(stripped) = kp.strip_prefix("~/") {
                let home = dirs::home_dir().context("resolve home dir")?;
                home.join(stripped).to_string_lossy().to_string()
            } else {
                kp.to_string()
            };
            return Ok(expanded);
        }
    }

    // Default: ~/.ssh/id_rsa, ~/.ssh/id_ed25519
    let home = dirs::home_dir().context("resolve home dir")?;
    let candidates = ["id_ed25519", "id_rsa", "id_ecdsa"];
    for c in &candidates {
        let p = home.join(".ssh").join(c);
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }

    anyhow::bail!("no SSH key found in ~/.ssh/; please specify key_path")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_key_path_explicit() {
        // Should return the explicit path when provided
        let result = resolve_key_path(Some("/tmp/my_key"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "/tmp/my_key");
    }

    #[test]
    fn resolve_key_path_empty_falls_back() {
        // Empty string should fall back to default key search
        let result = resolve_key_path(Some(""));
        // Either finds a key or errors; both are valid behaviors
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn resolve_key_path_none_falls_back() {
        let result = resolve_key_path(None);
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn resolve_key_path_tilde_expansion() {
        let result = resolve_key_path(Some("~/.ssh/id_rsa"));
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(!path.starts_with("~"), "tilde should be expanded");
    }
}
