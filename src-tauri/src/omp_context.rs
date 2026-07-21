use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct OmpProcessContext {
    pub cwd: PathBuf,
    pub profile: Option<String>,
    pub omp_bin: PathBuf,
}

impl OmpProcessContext {
    pub fn base_rpc_args(&self, no_session: bool) -> Vec<String> {
        let mut args = vec![
            "--mode".into(),
            "rpc".into(),
            "--cwd".into(),
            self.cwd.display().to_string(),
        ];
        if let Some(profile) = self.profile.as_deref().filter(|p| !p.is_empty()) {
            args.push("--profile".into());
            args.push(profile.to_string());
        }
        if no_session {
            args.push("--no-session".into());
        }
        args
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn prefers_explicit_profile_over_default() {
        let ctx = OmpProcessContext {
            cwd: PathBuf::from("/tmp/proj"),
            profile: Some("work".into()),
            omp_bin: PathBuf::from("omp"),
        };
        let args = ctx.base_rpc_args(true);
        assert!(args.windows(2).any(|w| w == ["--profile", "work"]));
        assert!(args.windows(2).any(|w| w == ["--cwd", "/tmp/proj"]));
    }

    #[test]
    fn omits_profile_flag_when_none() {
        let ctx = OmpProcessContext {
            cwd: PathBuf::from("/tmp/proj"),
            profile: None,
            omp_bin: PathBuf::from("omp"),
        };
        let args = ctx.base_rpc_args(true);
        assert!(!args.iter().any(|a| a == "--profile"));
    }
}
