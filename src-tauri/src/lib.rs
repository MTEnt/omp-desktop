mod commands;
mod memory;
mod omp_config;
mod error;
mod pty;
mod rpc;
mod session;
mod session_history;
mod settings;
mod ssh;

use tauri::Manager;

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
            let state = commands::initialize_app_state()?;
            app.manage(state);
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
            commands::abort,
            commands::get_state,
            commands::rpc_command,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
