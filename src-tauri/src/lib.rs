mod commands;
mod error;
mod memory;
mod git_status;
mod image_attach;
mod project_fs;
mod omp_config;
mod omp_context;
mod pty;
mod rpc;
mod session;
mod session_history;
mod settings;
mod session_library;
mod ssh;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            match commands::initialize_app_state() {
                Ok(state) => {
                    app.manage(state);
                }
                Err(error) => {
                    let message = format!(
                        "OMP Desktop could not start.\n\n{error}\n\nCheck the OMP installation and app settings, then reopen the app."
                    );
                    eprintln!("{message}");
                    let app_handle = app.handle().clone();
                    app.dialog()
                        .message(message)
                        .title("OMP Desktop startup error")
                        .kind(MessageDialogKind::Error)
                        .show(move |_| app_handle.exit(1));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::get_model_roles,
            commands::list_available_models,
            commands::set_model_role,
            commands::save_settings,
            commands::get_setup_status,
            commands::install_impeccable,
            commands::list_skills,
            commands::list_sessions,
            commands::create_session,
            commands::create_ssh_session,
            commands::test_ssh_connection,
            commands::add_ssh_host,
            commands::list_ssh_hosts,
            commands::list_ssh_recents,
            commands::list_remote_dir,
            commands::close_session,
            commands::open_pty,
            commands::write_pty,
            commands::resize_pty,
            commands::close_pty,
            commands::prompt,
            commands::prepare_prompt_images,
            commands::abort,
            commands::get_state,
            commands::rpc_command,
            commands::respond_extension_ui,
            commands::upsert_job,
            commands::post_turn_housekeeping,
            commands::list_jobs,
            commands::list_agents,
            commands::save_role_scratchpad,
            commands::get_role_scratchpad,
            commands::delete_role_note,
            commands::add_role_note,
            commands::list_role_notes,
            commands::rewrite_assistant_message,
            commands::list_historic_sessions,
            commands::search_historic_sessions,
            commands::archive_historic_session,
            commands::unarchive_historic_session,
            commands::delete_historic_session,
            commands::rename_historic_session,
            commands::get_git_status,
            commands::list_project_dir,
            commands::read_project_file,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("OMP Desktop runtime error: {error}"));
}
