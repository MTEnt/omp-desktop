use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Default preview budget for local project file reads.
pub const DEFAULT_MAX_BYTES: usize = 256_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryDto {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Resolve `path` so it is contained under `root`.
///
/// - Empty / omitted path → root itself.
/// - Relative paths join under root.
/// - Absolute paths must still resolve inside root after canonicalization.
/// - Rejects `..` escapes and symlink escapes outside root.
pub fn resolve_contained(root: &Path, path: &Path) -> AppResult<PathBuf> {
    if root.as_os_str().is_empty() {
        return Err(AppError::Msg("project root is empty".into()));
    }

    let root_canon = fs::canonicalize(root).map_err(|e| {
        AppError::Msg(format!(
            "project root unavailable ({}): {e}",
            root.display()
        ))
    })?;

    if !root_canon.is_dir() {
        return Err(AppError::Msg(format!(
            "project root is not a directory: {}",
            root_canon.display()
        )));
    }

    let candidate = if path.as_os_str().is_empty() {
        root_canon.clone()
    } else if path.is_absolute() {
        path.to_path_buf()
    } else {
        // Normalize relative components without requiring the target to exist yet
        // for intermediate joins; final canonicalize enforces real containment.
        let mut joined = root_canon.clone();
        for comp in path.components() {
            match comp {
                Component::CurDir => {}
                Component::ParentDir => {
                    if !joined.pop() {
                        return Err(AppError::Msg(
                            "path escapes project root".into(),
                        ));
                    }
                }
                Component::Normal(seg) => joined.push(seg),
                Component::RootDir | Component::Prefix(_) => {
                    return Err(AppError::Msg(
                        "invalid path component".into(),
                    ));
                }
            }
        }
        joined
    };

    // If the path does not exist yet, walk up to the nearest existing ancestor
    // and verify that ancestor stays under root, then re-append the missing tail.
    let resolved = canonicalize_existing_prefix(&candidate).map_err(|e| {
        AppError::Msg(format!("path unavailable ({}): {e}", candidate.display()))
    })?;

    if !is_path_within(&root_canon, &resolved) {
        return Err(AppError::Msg(
            "path is outside the project working directory".into(),
        ));
    }

    Ok(resolved)
}

fn canonicalize_existing_prefix(path: &Path) -> std::io::Result<PathBuf> {
    if path.exists() {
        return fs::canonicalize(path);
    }

    let mut cursor = path.to_path_buf();
    let mut missing = Vec::new();
    while !cursor.exists() {
        match cursor.file_name() {
            Some(name) => {
                missing.push(name.to_os_string());
                if !cursor.pop() {
                    break;
                }
            }
            None => break,
        }
    }

    if !cursor.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("no existing path prefix for {}", path.display()),
        ));
    }

    let mut resolved = fs::canonicalize(&cursor)?;
    for name in missing.into_iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}

fn is_path_within(root: &Path, candidate: &Path) -> bool {
    if candidate == root {
        return true;
    }
    candidate.starts_with(root)
}

/// List directory entries under `path` (relative or absolute) contained in `root`.
///
/// Sorts directories first, then by name (case-insensitive). Skips hidden names
/// (leading `.`), including `.git`.
pub fn list_project_dir(root: &Path, path: &Path) -> AppResult<Vec<DirEntryDto>> {
    let dir = resolve_contained(root, path)?;
    if !dir.is_dir() {
        return Err(AppError::Msg(format!(
            "not a directory: {}",
            dir.display()
        )));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir();
        let full = entry.path();
        entries.push(DirEntryDto {
            name,
            path: full.to_string_lossy().into_owned(),
            is_dir,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a
            .name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase()),
    });

    Ok(entries)
}

/// Read a UTF-8 text file contained under `root`, capped at `max_bytes`.
///
/// Files larger than `max_bytes` return a truncated body with a trailing note.
/// Non-UTF-8 content is rejected with a clear error.
pub fn read_project_file(root: &Path, path: &Path, max_bytes: usize) -> AppResult<String> {
    let file_path = resolve_contained(root, path)?;
    if !file_path.is_file() {
        return Err(AppError::Msg(format!(
            "not a file: {}",
            file_path.display()
        )));
    }

    let meta = fs::metadata(&file_path)?;
    let len = meta.len() as usize;
    let limit = max_bytes.max(1);

    let bytes = if len > limit {
        let mut buf = vec![0u8; limit];
        use std::io::Read;
        let mut f = fs::File::open(&file_path)?;
        let n = f.read(&mut buf)?;
        buf.truncate(n);
        buf
    } else {
        fs::read(&file_path)?
    };

    let mut text = String::from_utf8(bytes).map_err(|_| {
        AppError::Msg(format!(
            "file is not valid UTF-8 text: {}",
            file_path.display()
        ))
    })?;

    if len > limit {
        text.push_str(&format!(
            "\n\n… truncated ({len} bytes total; showing first {limit} bytes)"
        ));
    }

    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("omp-project-fs-{label}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_tree(root: &Path) {
        fs::create_dir_all(root.join("src/nested")).expect("dirs");
        fs::write(root.join("README.md"), "hello root").expect("readme");
        fs::write(root.join("src/main.rs"), "fn main() {}").expect("main");
        fs::write(root.join("src/nested/lib.rs"), "pub fn x() {}").expect("lib");
        fs::create_dir_all(root.join(".git")).expect("git");
        fs::write(root.join(".git/config"), "hidden").expect("git config");
        fs::write(root.join(".env"), "SECRET=1").expect("env");
        fs::write(root.join("big.txt"), "x".repeat(1000)).expect("big");
        // binary-ish non-utf8
        fs::write(root.join("bin.dat"), [0xff, 0xfe, 0x00, 0x01]).expect("bin");
    }

    #[test]
    fn list_sorts_dirs_first_skips_hidden() {
        let root = temp_dir("list");
        write_tree(&root);

        let entries = list_project_dir(&root, Path::new("")).expect("list root");
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"src"));
        assert!(names.contains(&"README.md"));
        assert!(names.contains(&"big.txt"));
        assert!(!names.iter().any(|n| n.starts_with('.')), "hidden skipped: {names:?}");
        // dirs first
        let first_file = entries.iter().position(|e| !e.is_dir);
        let last_dir = entries.iter().rposition(|e| e.is_dir);
        if let (Some(f), Some(d)) = (first_file, last_dir) {
            assert!(d < f, "dirs should sort before files");
        }

        let nested = list_project_dir(&root, Path::new("src")).expect("list src");
        assert!(nested.iter().any(|e| e.name == "nested" && e.is_dir));
        assert!(nested.iter().any(|e| e.name == "main.rs" && !e.is_dir));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn read_utf8_and_truncate() {
        let root = temp_dir("read");
        write_tree(&root);

        let text = read_project_file(&root, Path::new("README.md"), DEFAULT_MAX_BYTES)
            .expect("read readme");
        assert_eq!(text, "hello root");

        let truncated = read_project_file(&root, Path::new("big.txt"), 50).expect("truncate");
        assert!(truncated.starts_with(&"x".repeat(50)));
        assert!(truncated.contains("truncated"));
        assert!(truncated.contains("1000 bytes total"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reject_non_utf8() {
        let root = temp_dir("bin");
        write_tree(&root);
        let err = read_project_file(&root, Path::new("bin.dat"), DEFAULT_MAX_BYTES)
            .expect_err("binary");
        assert!(
            err.to_string().to_ascii_lowercase().contains("utf-8"),
            "unexpected: {err}"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn containment_rejects_escape() {
        let root = temp_dir("escape");
        write_tree(&root);

        let err = list_project_dir(&root, Path::new("../")).expect_err("escape list");
        assert!(
            err.to_string().to_ascii_lowercase().contains("outside")
                || err.to_string().to_ascii_lowercase().contains("escape"),
            "unexpected: {err}"
        );

        let err = read_project_file(&root, Path::new("../../etc/passwd"), 100)
            .expect_err("escape read");
        assert!(
            err.to_string().to_ascii_lowercase().contains("outside")
                || err.to_string().to_ascii_lowercase().contains("escape")
                || err.to_string().to_ascii_lowercase().contains("unavailable"),
            "unexpected: {err}"
        );

        // Absolute path outside root
        let outside = temp_dir("outside-target");
        fs::write(outside.join("secret.txt"), "nope").expect("secret");
        let err = read_project_file(&root, &outside.join("secret.txt"), 100)
            .expect_err("abs outside");
        assert!(
            err.to_string().to_ascii_lowercase().contains("outside"),
            "unexpected: {err}"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn relative_nested_read_ok() {
        let root = temp_dir("nested");
        write_tree(&root);
        let text = read_project_file(&root, Path::new("src/nested/lib.rs"), DEFAULT_MAX_BYTES)
            .expect("nested");
        assert!(text.contains("pub fn x"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_root_errors() {
        let err = list_project_dir(Path::new(""), Path::new("."))
            .expect_err("empty root");
        assert!(err.to_string().contains("empty"));
    }

    #[test]
    fn dto_serializes_camel_case() {
        let dto = DirEntryDto {
            name: "src".into(),
            path: "/tmp/proj/src".into(),
            is_dir: true,
        };
        let json = serde_json::to_value(&dto).expect("ser");
        assert_eq!(json["name"], "src");
        assert_eq!(json["path"], "/tmp/proj/src");
        assert_eq!(json["isDir"], true);
    }
}
