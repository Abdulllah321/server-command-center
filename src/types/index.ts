export type Environment = 'production' | 'staging' | 'dev';
export type ServerStatus = 'online' | 'degraded' | 'offline' | 'unknown';
export type AuthMethod = 'password' | 'private_key' | 'ssh_agent' | 'password_key';

export interface CreateCredentialPayload {
  server_id: string;
  auth_method: AuthMethod;
  secret_payload: string;
  key_fingerprint?: string;
  master_password?: string;
}

export interface CredentialMetadata {
  id: string;
  server_id: string;
  auth_method: AuthMethod;
  key_fingerprint?: string;
  created_at: string;
}

export interface CredentialMetadataExtended extends CredentialMetadata {
  server_name: string;
}

export interface WindowsHelloStatus {
  supported: boolean;
  enrolled: boolean;
  enabled: boolean;
}

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
  tags?: string[];
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

export interface ServerGroupTree extends ServerGroup {
  children: ServerGroupTree[];
  server_ids: string[];
}

export interface UpdateGroupPayload {
  name?: string;
  parent_id?: string | null;
}

export interface Credential {
  id: string;
  server_id: string;
  auth_method: AuthMethod;
  keychain_ref: string;
  key_fingerprint: string | null;
  created_at: string;
}

export interface CreateApplicationOptions {
  server_id: string;
  name: string;
  repo_path?: string;
  pm2_name?: string;
  branch: string;
  package_mgr: string;
  rebuild_profile_id?: string;
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

export interface RebuildStep {
  label: string;
  command: string;
  continue_on_error: boolean;
}

export interface RebuildProfile {
  id: string;
  name: string;
  steps: RebuildStep[];
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

export interface CreateBackupOptions {
  target_type: 'postgres' | 'mysql' | 'redis' | 'directory' | 'custom';
  target_name: string;
  destination_dir?: string;
  custom_command?: string;
}

export interface NginxSite {
  name: string;
  domains: string[];
  proxy_pass: string | null;
  ssl_enabled: boolean;
  ssl_certificate: string | null;
  is_enabled: boolean;
  file_path: string;
}

export interface SslCertificate {
  domain: string;
  cert_name: string;
  expiry_date: string | null;
  days_remaining: number | null;
  is_valid: boolean;
}

export interface AlertRule {
  id: string;
  server_id: string;
  metric: 'cpu' | 'memory' | 'disk' | 'pm2_crash';
  threshold: number;
  operator: 'gt' | 'lt';
  enabled: boolean;
  created_at: string;
}

export interface AlertHistoryEntry {
  id: string;
  server_id: string;
  metric: string;
  value: number;
  message: string;
  triggered_at: string;
}

export interface SaveAlertRuleOptions {
  id?: string;
  server_id: string;
  metric: string;
  threshold: number;
  operator: string;
  enabled: boolean;
}

export interface EvaluateAlertsPayload {
  server_id: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  errored_pm2_count: number;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified: number;
  permissions: string;
  mode: string;
  owner: string;
  group: string;
  extension: string;
}

export interface RemoteDirectoryListing {
  current_path: string;
  parent_path: string | null;
  entries: RemoteFileEntry[];
  total_files: number;
  total_dirs: number;
  total_size: number;
}

export interface RemoteFileContent {
  path: string;
  content: string;
  size: number;
  is_binary: boolean;
  is_truncated: boolean;
  encoding: string;
}

export interface DownloadedFilePayload {
  filename: string;
  base64_content: string;
  size: number;
  is_archive: boolean;
}


