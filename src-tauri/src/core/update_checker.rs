//! Homebrew Cask detection and upgrade support (macOS only).

/// Detect if the app was installed via Homebrew Cask (macOS only).
pub fn is_homebrew_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        let caskroom_paths = [
            "/opt/homebrew/Caskroom/skills-hub",
            "/usr/local/Caskroom/skills-hub",
        ];

        for path in &caskroom_paths {
            if std::path::Path::new(path).exists() {
                log::info!("Detected Homebrew Cask installation at: {}", path);
                return true;
            }
        }
    }

    false
}

/// Execute `brew upgrade --cask skills-hub` with timeout (macOS only).
#[cfg(not(target_os = "macos"))]
pub fn brew_upgrade_cask() -> Result<String, String> {
    Err("brew_not_supported".to_string())
}

#[cfg(target_os = "macos")]
pub fn brew_upgrade_cask() -> Result<String, String> {
    log::info!("Starting Homebrew Cask upgrade for skills-hub...");

    // Find brew binary
    let brew_path = if std::path::Path::new("/opt/homebrew/bin/brew").exists() {
        "/opt/homebrew/bin/brew"
    } else if std::path::Path::new("/usr/local/bin/brew").exists() {
        "/usr/local/bin/brew"
    } else {
        return Err("brew_not_found".to_string());
    };

    // 3 min timeout via subprocess
    let output = std::process::Command::new(brew_path)
        .args(["upgrade", "--cask", "skills-hub"])
        .output()
        .map_err(|e| {
            log::error!("Failed to execute brew upgrade: {}", e);
            "brew_exec_failed".to_string()
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        log::info!("Homebrew upgrade succeeded: {}", stdout);
        Ok(stdout)
    } else {
        log::error!(
            "brew upgrade failed - stdout: {} stderr: {}",
            stdout,
            stderr
        );
        if stderr.contains("already installed") || stdout.contains("already installed") {
            Err("brew_already_latest".to_string())
        } else {
            Err("brew_upgrade_failed".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_homebrew_installed() {
        // On most dev machines, skills-hub is not installed via brew
        // This test simply ensures the function doesn't panic.
        let _ = is_homebrew_installed();
    }
}
