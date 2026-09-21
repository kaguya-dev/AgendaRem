export const schema = `
CREATE TABLE IF NOT EXISTS agenda_meta (
  id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL
);
INSERT INTO agenda_meta (id, data) VALUES (1, '{"retentionDays":30,"nextTaskId":1,"revision":0}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agenda_groups (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_group_name ON agenda_groups (lower(data->>'name'));
CREATE TABLE IF NOT EXISTS agenda_tasks (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS agenda_task_purge ON agenda_tasks ((data->>'purgeAt'));
CREATE TABLE IF NOT EXISTS agenda_history (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS agenda_history_task ON agenda_history ((data->>'taskId'));
CREATE TABLE IF NOT EXISTS agenda_operations (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS agenda_conversations (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS agenda_messages (
  id text PRIMARY KEY, external_id text NOT NULL UNIQUE, channel text NOT NULL,
  body text, reply text, status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), error text,
  created_at timestamptz NOT NULL DEFAULT now(), received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agenda_messages_queue ON agenda_messages (status, next_attempt_at, received_at);
CREATE TABLE IF NOT EXISTS agenda_limits (key text PRIMARY KEY, count integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS agenda_llm_providers (
  id text PRIMARY KEY, config jsonb NOT NULL, encrypted_key text NOT NULL,
  cooldown_until timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agenda_llm_usage (
  provider_id text NOT NULL REFERENCES agenda_llm_providers(id) ON DELETE CASCADE,
  day text NOT NULL, requests integer NOT NULL DEFAULT 0,
  tokens bigint NOT NULL DEFAULT 0, reserved_tokens bigint NOT NULL DEFAULT 0,
  reserved_until timestamptz,
  PRIMARY KEY (provider_id, day)
);
`;
