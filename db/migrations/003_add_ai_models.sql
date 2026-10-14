ALTER TABLE organizations
  MODIFY COLUMN shared_ai_provider ENUM('openai', 'claude', 'deepseek') NULL,
  ADD COLUMN shared_ai_model VARCHAR(100) NULL AFTER shared_ai_provider;

ALTER TABLE ai_connections
  MODIFY COLUMN provider ENUM('openai', 'claude', 'deepseek') NOT NULL,
  ADD COLUMN model VARCHAR(100) NULL AFTER provider;
