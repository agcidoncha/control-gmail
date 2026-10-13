-- Esquema MySQL para la persistencia SaaS de Asistente Comercial.
-- Los secretos y cuerpos de correo llegan cifrados desde Node.js.

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  shared_ai_provider ENUM('openai', 'claude') NULL,
  shared_ai_user_emails JSON NOT NULL,
  created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  email VARCHAR(320) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  role ENUM('admin', 'commercial') NOT NULL,
  access_status ENUM('active', 'pending', 'revoked') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  last_login_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  INDEX idx_users_organization (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS google_tokens (
  email VARCHAR(320) PRIMARY KEY,
  payload_ciphertext MEDIUMTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_connections (
  organization_id VARCHAR(128) NOT NULL,
  user_email VARCHAR(320) NOT NULL,
  provider ENUM('openai', 'claude') NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (organization_id, user_email),
  CONSTRAINT fk_ai_connections_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_ai_connections_user FOREIGN KEY (user_email) REFERENCES users(email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gmail_accounts (
  account_email VARCHAR(320) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  sync_state JSON NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_gmail_accounts_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  INDEX idx_gmail_accounts_organization (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gmail_messages (
  account_email VARCHAR(320) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  thread_id VARCHAR(255) NULL,
  mailbox ENUM('inbox', 'sent', 'spam') NOT NULL,
  subject TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipients TEXT NOT NULL,
  message_date VARCHAR(255) NULL,
  sort_timestamp BIGINT NOT NULL,
  snippet TEXT NOT NULL,
  label_ids JSON NOT NULL,
  important BOOLEAN NOT NULL DEFAULT FALSE,
  bounced BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at DATETIME(3) NOT NULL,
  PRIMARY KEY (account_email, message_id),
  CONSTRAINT fk_gmail_messages_account FOREIGN KEY (account_email) REFERENCES gmail_accounts(account_email),
  INDEX idx_gmail_messages_mailbox_date (account_email, mailbox, sort_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gmail_threads (
  account_email VARCHAR(320) NOT NULL,
  thread_id VARCHAR(255) NOT NULL,
  messages_ciphertext LONGTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (account_email, thread_id),
  CONSTRAINT fk_gmail_threads_account FOREIGN KEY (account_email) REFERENCES gmail_accounts(account_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gmail_actions (
  id CHAR(36) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  user_email VARCHAR(320) NOT NULL,
  account_email VARCHAR(320) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  action ENUM('markRead', 'markUnread', 'archive', 'unarchive', 'trash', 'restore', 'send') NOT NULL,
  outcome ENUM('success', 'error') NOT NULL,
  error_code VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_gmail_actions_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_gmail_actions_user FOREIGN KEY (user_email) REFERENCES users(email),
  INDEX idx_gmail_actions_account_created (account_email, created_at),
  INDEX idx_gmail_actions_user_created (user_email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
