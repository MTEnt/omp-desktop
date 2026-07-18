mod commands;
mod memory;
mod omp_config;
mod error;
mod pty;
mod rpc;
mod session;
mod session_history;
mod settings;

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
            commands::list_sessions,
            commands::create_session,
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
