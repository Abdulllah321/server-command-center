export type Environment = 'production' | 'staging' | 'dev';
export type ServerStatus = 'online' | 'degraded' | 'offline' | 'unknown';
export type AuthMethod = 'password' | 'private_key' | 'ssh_agent' | 'password_key';

export interface Server {
  id: string;
  name: string;
  hostname: string;
  ssh_port: number;
  username: string;
  os: string | null;
  provider: string | null;
  environment: Environment;
  description: string | null;
  status: ServerStatus;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerTag {
  server_id: string;
  tag: string;
}

export interface ServerGroup {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface Credential {
  id: string;
  server_id: string;
  auth_method: AuthMethod;
  keychain_ref: string;
  key_fingerprint: string | null;
  created_at: string;
}

export interface Application {
  id: string;
  server_id: string;
  name: string;
  repo_path: string | null;
  pm2_name: string | null;
  branch: string;
  package_mgr: string;
  rebuild_profile_id: string | null;
  created_at: string;
}

export interface RebuildProfile {
  id: string;
  name: string;
  steps_json: string; // Ordered JSON array of {label, command}
  is_builtin: boolean;
  created_at: string;
}

export interface Deployment {
  id: string;
  application_id: string;
  commit_hash: string | null;
  branch: string | null;
  status: 'running' | 'success' | 'failed' | 'rolled_back';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  triggered_by: string | null;
  log_blob: string | null;
}

export interface DeploymentStep {
  id: string;
  deployment_id: string;
  step_order: number;
  label: string;
  command: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  exit_code: number | null;
  output: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface Service {
  id: string;
  server_id: string;
  unit_name: string;
  is_enabled: boolean | null;
  last_status: string | null;
  last_checked_at: string | null;
}

export interface Command {
  id: string;
  server_id: string | null;
  name: string;
  command: string;
  category: string | null;
  icon: string | null;
  is_destructive: boolean;
  created_at: string;
}

export interface EnvVar {
  id: string;
  application_id: string;
  key: string;
  value_encrypted: Uint8Array; // Or base64 string depending on how Rust sends it
  updated_at: string;
}

export interface Backup {
  id: string;
  server_id: string;
  target: string;
  destination: string;
  size_bytes: number | null;
  status: 'running' | 'success' | 'failed';
  created_at: string;
}

export interface ActivityLog {
  id: string;
  server_id: string | null;
  actor: string;
  action: string;
  target: string | null;
  status: 'success' | 'failed';
  detail: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface LogSession {
  id: string;
  application_id: string;
  started_at: string;
  ended_at: string | null;
  file_path: string | null;
}
