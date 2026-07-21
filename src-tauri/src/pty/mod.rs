use std::ffi::OsString;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::ssh::{ssh_destination, RemoteTarget};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::thread;

const INITIAL_PTY_SIZE: PtySize = PtySize {
    rows: 24,
    cols: 80,
    pixel_width: 0,
    pixel_height: 0,
};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutput {
    session_id: String,
    data: String,
}

impl PtyOutput {
    pub fn new(session_id: impl Into<String>, data: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            data: data.into(),
        }
    }
}

struct PtyProcess {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    processes: HashMap<String, PtyProcess>,
}

impl PtyManager {
    pub fn open_pty<F>(
        &mut self,
        session_id: &str,
        cwd: &Path,
        remote: Option<&RemoteTarget>,
        on_output: F,
    ) -> AppResult<bool>
    where
        F: Fn(String) + Send + 'static,
    {
        if let Some(target) = remote {
            return self.open_remote_pty(session_id, target, on_output);
        }
        let shell = local_shell();
        self.open_pty_with_shell(session_id, cwd, &shell, on_output)
    }

    fn open_remote_pty<F>(
        &mut self,
        session_id: &str,
        target: &RemoteTarget,
        on_output: F,
    ) -> AppResult<bool>
    where
        F: Fn(String) + Send + 'static,
    {
        if self.processes.contains_key(session_id) {
            return Ok(false);
        }

        let pair = native_pty_system()
            .openpty(INITIAL_PTY_SIZE)
            .map_err(|error| pty_error("open PTY", error))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| pty_error("clone PTY reader", error))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| pty_error("take PTY writer", error))?;

        let mut command = CommandBuilder::new("ssh");
        for arg in remote_ssh_pty_args(target) {
            command.arg(arg);
        }
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| pty_error("spawn remote SSH PTY", error))?;
        drop(pair.slave);

        let reader_session_id = session_id.to_owned();
        if let Err(error) = thread::Builder::new()
            .name(format!("pty-reader-{reader_session_id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 16 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read) => {
                            on_output(String::from_utf8_lossy(&buffer[..read]).into_owned());
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
            })
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(pty_error("start PTY reader", error));
        }

        self.processes.insert(
            session_id.to_owned(),
            PtyProcess {
                master: pair.master,
                writer,
                child,
            },
        );
        Ok(true)
    }

    fn open_pty_with_shell<F>(
        &mut self,
        session_id: &str,
        cwd: &Path,
        shell: &Path,
        on_output: F,
    ) -> AppResult<bool>
    where
        F: Fn(String) + Send + 'static,
    {
        if self.processes.contains_key(session_id) {
            return Ok(false);
        }

        let pair = native_pty_system()
            .openpty(INITIAL_PTY_SIZE)
            .map_err(|error| pty_error("open PTY", error))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| pty_error("clone PTY reader", error))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| pty_error("take PTY writer", error))?;

        let mut command = CommandBuilder::new(shell);
        command.cwd(cwd);
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| pty_error("spawn PTY shell", error))?;
        drop(pair.slave);

        let reader_session_id = session_id.to_owned();
        if let Err(error) = thread::Builder::new()
            .name(format!("pty-reader-{reader_session_id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 16 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read) => {
                            on_output(String::from_utf8_lossy(&buffer[..read]).into_owned());
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
            })
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(pty_error("start PTY reader", error));
        }

        self.processes.insert(
            session_id.to_owned(),
            PtyProcess {
                master: pair.master,
                writer,
                child,
            },
        );
        Ok(true)
    }

    pub fn write_pty(&mut self, session_id: &str, data: &str) -> AppResult<()> {
        let process = self.process_mut(session_id)?;
        process.writer.write_all(data.as_bytes())?;
        process.writer.flush()?;
        Ok(())
    }

    pub fn resize_pty(&mut self, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let process = self.process_mut(session_id)?;
        process
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| pty_error("resize PTY", error))
    }

    pub fn close_pty(&mut self, session_id: &str) -> AppResult<()> {
        if let Some(mut process) = self.processes.remove(session_id) {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
        Ok(())
    }

    fn process_mut(&mut self, session_id: &str) -> AppResult<&mut PtyProcess> {
        self.processes
            .get_mut(session_id)
            .ok_or_else(|| AppError::Msg(format!("PTY not open for session {session_id}")))
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        for (_, mut process) in self.processes.drain() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

fn pty_error(action: &str, error: impl std::fmt::Display) -> AppError {
    AppError::Msg(format!("unable to {action}: {error}"))
}

fn remote_ssh_pty_args(target: &RemoteTarget) -> Vec<String> {
    let mut args = vec![
        "-tt".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=8".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
    ];
    if let Some(port) = target.port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    if let Some(key) = &target.key_path {
        if !key.is_empty() {
            args.push("-i".into());
            args.push(key.clone());
        }
    }
    args.push("--".into());
    args.push(ssh_destination(target));

    let remote_cwd = target.remote_cwd.trim();
    let remote_cwd = if remote_cwd.is_empty() {
        "~"
    } else {
        remote_cwd
    };
    let quoted = shell_single_quote(remote_cwd);
    // Login shell in the remote project directory.
    let script = format!(
        "set -e; TARGET={quoted}; if [ \"$TARGET\" = '~' ] || [ -z \"$TARGET\" ]; then TARGET=\"$HOME\"; fi; case \"$TARGET\" in ~/*) TARGET=\"$HOME${{TARGET#\\~}}\";; esac; cd \"$TARGET\"; exec \"${{SHELL:-/bin/bash}}\" -l"
    );
    args.push(script);
    args
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

fn local_shell() -> PathBuf {
    #[cfg(windows)]
    {
        // Prefer an interactive PowerShell when available.
        if let Some(shell) = std::env::var_os("COMSPEC") {
            if !shell.is_empty() {
                // COMSPEC is usually cmd.exe; still allow PWSH override.
                if let Ok(pwsh) = which::which("pwsh") {
                    return pwsh;
                }
                if let Ok(powershell) = which::which("powershell") {
                    return powershell;
                }
                return PathBuf::from(shell);
            }
        }
        if let Ok(pwsh) = which::which("pwsh") {
            return pwsh;
        }
        if let Ok(powershell) = which::which("powershell") {
            return powershell;
        }
        return fallback_shell();
    }
    #[cfg(not(windows))]
    {
        shell_from_env(std::env::var_os("SHELL"))
    }
}

fn shell_from_env(shell: Option<OsString>) -> PathBuf {
    shell
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(fallback_shell)
}

#[cfg(target_os = "macos")]
fn fallback_shell() -> PathBuf {
    PathBuf::from("/bin/zsh")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn fallback_shell() -> PathBuf {
    PathBuf::from("/bin/sh")
}

#[cfg(windows)]
fn fallback_shell() -> PathBuf {
    std::env::var_os("COMSPEC")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("cmd.exe"))
}

#[cfg(test)]
mod tests {
    use super::{shell_from_env, PtyManager, PtyOutput};
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn shell_selection_prefers_nonempty_shell_environment() {
        assert_eq!(
            shell_from_env(Some(OsString::from("/custom/shell"))),
            PathBuf::from("/custom/shell")
        );
        assert_eq!(shell_from_env(Some(OsString::new())), fallback_shell());
        assert_eq!(shell_from_env(None), fallback_shell());
    }

    #[test]
    fn output_event_serializes_for_the_ui_contract() {
        let output = PtyOutput::new("session-1", "hello\r\n");

        assert_eq!(
            serde_json::to_value(output).unwrap(),
            serde_json::json!({
                "sessionId": "session-1",
                "data": "hello\r\n",
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn opening_an_existing_session_keeps_its_original_pty() {
        let mut manager = PtyManager::default();
        assert!(manager
            .open_pty_with_shell("session-1", Path::new("/"), Path::new("/bin/sh"), |_| {})
            .unwrap());

        assert!(!manager
            .open_pty_with_shell(
                "session-1",
                Path::new("/"),
                Path::new("/definitely/missing/shell"),
                |_| {},
            )
            .unwrap());
        manager.close_pty("session-1").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn pty_runs_shell_in_session_cwd_and_bridges_io() {
        let cwd = std::env::temp_dir().join(format!("omp-desktop-pty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&cwd).unwrap();
        let (output_tx, output_rx) = mpsc::channel();
        let mut manager = PtyManager::default();

        assert!(manager
            .open_pty_with_shell("session-1", &cwd, Path::new("/bin/sh"), move |data| {
                output_tx.send(data).unwrap();
            })
            .unwrap());
        manager
            .write_pty("session-1", "printf '__PTY_CWD__%s\\n' \"$PWD\"\n")
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut output = String::new();
        while !output.contains("__PTY_CWD__") || !output.contains(&cwd.to_string_lossy()[..]) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(!remaining.is_zero(), "PTY output timed out: {output:?}");
            output.push_str(&output_rx.recv_timeout(remaining).unwrap());
        }

        manager.resize_pty("session-1", 100, 30).unwrap();
        manager.close_pty("session-1").unwrap();
        assert!(manager.write_pty("session-1", "echo closed\n").is_err());
        std::fs::remove_dir(cwd).unwrap();
    }

    fn fallback_shell() -> PathBuf {
        #[cfg(target_os = "macos")]
        return PathBuf::from("/bin/zsh");

        #[cfg(all(unix, not(target_os = "macos")))]
        return PathBuf::from("/bin/sh");

        #[cfg(windows)]
        return PathBuf::from("cmd.exe");
    }
}
