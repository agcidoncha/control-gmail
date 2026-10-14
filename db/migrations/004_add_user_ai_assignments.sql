ALTER TABLE users
  ADD COLUMN ai_access_enabled BOOLEAN NULL AFTER access_status,
  ADD COLUMN ai_provider ENUM('openai', 'claude', 'deepseek') NULL AFTER ai_access_enabled,
  ADD COLUMN ai_model VARCHAR(100) NULL AFTER ai_provider;
