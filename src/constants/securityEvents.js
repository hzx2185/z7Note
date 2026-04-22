const AUTH_EVENTS = {
  ADMIN_REGISTRATION_REJECTED: 'auth_admin_registration_rejected',
  REGISTRATION_FAILED: 'auth_registration_failed',
  LOGIN_FAILED: 'auth_login_failed',
  TFA_VERIFICATION_FAILED: 'auth_tfa_verification_failed',
  LOGOUT_FAILED: 'auth_logout_failed',
  BIND_CODE_SEND_FAILED: 'auth_bind_code_send_failed',
  DB_RETRY: 'auth_db_retry',
  BIND_EMAIL_TOKEN_INVALID: 'auth_bind_email_token_invalid',
  BIND_EMAIL_FAILED: 'auth_bind_email_failed',
  PASSWORD_RESET_REQUEST_SKIPPED: 'auth_password_reset_request_skipped',
  PASSWORD_CHANGE_FAILED: 'auth_password_change_failed'
};

const SHARE_EVENTS = {
  CREATE_FAILED: 'share_create_failed',
  REVOKE_FORBIDDEN: 'share_revoke_forbidden',
  PUBLIC_ACCESS_EXPIRED: 'share_public_access_expired',
  PUBLIC_ACCESS_PRIVATE: 'share_public_access_private',
  ATTACHMENT_INVALID_FILENAME: 'share_attachment_invalid_filename',
  ATTACHMENT_FORBIDDEN: 'share_attachment_forbidden',
  DETAIL_FAILED: 'share_detail_failed'
};

const ATTACHMENT_EVENTS = {
  RAW_INVALID_FILENAME: 'attachment_raw_invalid_filename',
  RAW_BAD_PATH: 'attachment_raw_bad_path',
  RAW_SERVER_ERROR: 'attachment_raw_server_error'
};

const ADMIN_EVENTS = {
  USER_DELETE_NOT_FOUND: 'admin_user_delete_not_found',
  USER_DELETE_SUCCESS: 'admin_user_delete_success',
  USER_DELETE_FAILED: 'admin_user_delete_failed',
  USER_PASSWORD_RESET_NOT_FOUND: 'admin_user_password_reset_not_found',
  USER_PASSWORD_RESET_SUCCESS: 'admin_user_password_reset_success',
  USER_QUOTA_UPDATE_SUCCESS: 'admin_user_quota_update_success',
  USER_QUOTA_UPDATE_FAILED: 'admin_user_quota_update_failed',
  CDN_UPDATE_SUCCESS: 'admin_cdn_update_success',
  CDN_UPDATE_FAILED: 'admin_cdn_update_failed',
  CDN_CONFIG_UPDATE_SUCCESS: 'admin_cdn_config_update_success',
  CDN_CONFIG_UPDATE_FAILED: 'admin_cdn_config_update_failed',
  CDN_CLEAR_SUCCESS: 'admin_cdn_clear_success',
  CDN_CLEAR_FAILED: 'admin_cdn_clear_failed',
  SMTP_CONFIG_UPDATE_SUCCESS: 'admin_smtp_config_update_success',
  SMTP_CONFIG_UPDATE_FAILED: 'admin_smtp_config_update_failed',
  SMTP_TEST_SUCCESS: 'admin_smtp_test_success',
  SMTP_TEST_FAILED: 'admin_smtp_test_failed',
  SYSTEM_CONFIG_UPDATE_SUCCESS: 'admin_system_config_update_success',
  SYSTEM_CONFIG_UPDATE_FAILED: 'admin_system_config_update_failed',
  SYSTEM_CONFIG_RESET_SUCCESS: 'admin_system_config_reset_success',
  SYSTEM_CONFIG_RESET_FAILED: 'admin_system_config_reset_failed',
  CLEANUP_UPLOADS_SUCCESS: 'admin_cleanup_uploads_success',
  CLEANUP_UPLOADS_FAILED: 'admin_cleanup_uploads_failed',
  INIT_DEFAULTS_SUCCESS: 'admin_init_defaults_success',
  INIT_DEFAULTS_FAILED: 'admin_init_defaults_failed',
  TRASH_EMPTY_ALL_SUCCESS: 'admin_trash_empty_all_success',
  TRASH_EMPTY_ALL_FAILED: 'admin_trash_empty_all_failed',
  DATABASE_INFO_FAILED: 'admin_database_info_failed',
  DATABASE_VACUUM_STARTED: 'admin_database_vacuum_started',
  DATABASE_VACUUM_SUCCESS: 'admin_database_vacuum_success',
  DATABASE_VACUUM_FAILED: 'admin_database_vacuum_failed'
};

module.exports = {
  AUTH_EVENTS,
  SHARE_EVENTS,
  ATTACHMENT_EVENTS,
  ADMIN_EVENTS
};
