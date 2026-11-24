import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { 
  Rocket, 
  Server as ServerIcon, 
  Shield, 
  Cpu, 
  Database, 
  Globe, 
  HardDrive, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Loader2, 
  Copy, 
  Check, 
  Download, 
  Code2, 
  Sparkles, 
  Layers, 
  Terminal, 
  Clock, 
  StopCircle,
  ExternalLink,
  History
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  useServers,
} from '@/features/servers/api/use-servers';
import { 
  generateProvisionScript, 
  startServerProvisioning, 
  cancelServerProvisioning 
} from '@/lib/tauri-client';
import type { 
  ProvisionPlan, 
  NewServerDetails, 
  ProvisionStep, 
  ProvisionStepEvent, 
  ProvisionLogEvent, 
  ProvisionCompleteEvent 
} from '@/types';
import { ProvisionHistoryModal } from './ProvisionHistoryModal';

interface ServerProvisionWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedServerId?: string;
}

type PresetType = 'node-pm2' | 'full-postgres' | 'full-mysql' | 'hardened-minimal' | 'custom';

export const ServerProvisionWizard: React.FC<ServerProvisionWizardProps> = ({
  open,
  onOpenChange,
  preselectedServerId,
}) => {
  const navigate = useNavigate();
  const { data: servers, refetch: refetchServers } = useServers();

  // Wizard Navigation
  const [activeTab, setActiveTab] = useState<'config' | 'preview' | 'running'>('config');
  const [historyOpen, setHistoryOpen] = useState(false);

  // Target Mode: 'new' or 'existing'
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>(
    preselectedServerId ? 'existing' : 'new'
  );
  const [selectedServerId, setSelectedServerId] = useState<string>(preselectedServerId || '');

  // New Server Credentials
  const [newServer, setNewServer] = useState<NewServerDetails>({
    name: '',
    hostname: '',
    ssh_port: 22,
    username: 'root',
    auth_method: 'password',
    secret: '',
    master_password_if_needed: '',
    environment: 'production',
    description: 'Fresh server provisioned via Server Command Center',
    tags: ['production', 'web'],
  });

  // Preset Selection
  const [preset, setPreset] = useState<PresetType>('node-pm2');

  // Modular Configuration Plan (Zero Docker)
  const [plan, setPlan] = useState<ProvisionPlan>({
    create_deploy_user: true,
    deploy_username: 'deploy',
    deploy_public_key: '',
    disable_root_login: false,
    disable_password_auth: false,
    server_hostname: '',
    timezone: 'UTC',
    enable_unattended_upgrades: true,
    swap_size_gb: 2,
    swappiness: 10,
    enable_ufw: true,
    ufw_allow_ports: ['22', '80', '443'],
    enable_fail2ban: true,
    install_essentials: true,
    install_node: true,
    node_version: '20',
    install_pm2: true,
    install_bun: false,
    install_python: false,
    install_nginx: true,
    install_certbot: true,
    database_engine: 'none',
    install_redis: false,
  });

  // Script Preview State
  const [generatedScript, setGeneratedScript] = useState<string>('');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);

  // Live Execution State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [targetServerId, setTargetServerId] = useState<string | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ProvisionStep[]>([]);
  const [stepStates, setStepStates] = useState<Record<number, { status: string; duration_ms: number; exit_code?: number | null }>>({});
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [completionStatus, setCompletionStatus] = useState<'idle' | 'success' | 'failed' | 'aborted'>('idle');
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [totalElapsedTime, setTotalElapsedTime] = useState(0);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);

  // Handle Preset Switching
  const applyPreset = (presetKey: PresetType) => {
    setPreset(presetKey);
    if (presetKey === 'node-pm2') {
      setPlan(prev => ({
        ...prev,
        create_deploy_user: true,
        swap_size_gb: 2,
        enable_ufw: true,
        ufw_allow_ports: ['22', '80', '443'],
        enable_fail2ban: true,
        install_essentials: true,
        install_node: true,
        node_version: '20',
        install_pm2: true,
        install_bun: false,
        install_python: false,
        install_nginx: true,
        install_certbot: true,
        database_engine: 'none',
        install_redis: false,
      }));
    } else if (presetKey === 'full-postgres') {
      setPlan(prev => ({
        ...prev,
        create_deploy_user: true,
        swap_size_gb: 2,
        enable_ufw: true,
        ufw_allow_ports: ['22', '80', '443'],
        enable_fail2ban: true,
        install_essentials: true,
        install_node: true,
        node_version: '20',
        install_pm2: true,
        install_bun: false,
        install_python: false,
        install_nginx: true,
        install_certbot: true,
        database_engine: 'postgresql',
        install_redis: true,
      }));
    } else if (presetKey === 'full-mysql') {
      setPlan(prev => ({
        ...prev,
        create_deploy_user: true,
        swap_size_gb: 2,
        enable_ufw: true,
        ufw_allow_ports: ['22', '80', '443'],
        enable_fail2ban: true,
        install_essentials: true,
        install_node: true,
        node_version: '20',
        install_pm2: true,
        install_bun: false,
        install_python: false,
        install_nginx: true,
        install_certbot: true,
        database_engine: 'mariadb',
        install_redis: true,
      }));
    } else if (presetKey === 'hardened-minimal') {
      setPlan(prev => ({
        ...prev,
        create_deploy_user: true,
        swap_size_gb: 2,
        enable_ufw: true,
        ufw_allow_ports: ['22'],
        enable_fail2ban: true,
        install_essentials: true,
        install_node: false,
        install_pm2: false,
        install_bun: false,
        install_python: false,
        install_nginx: false,
        install_certbot: false,
        database_engine: 'none',
        install_redis: false,
      }));
    }
  };

  // Compile full plan with server details
  const getCompiledPlan = (): ProvisionPlan => {
    return {
      ...plan,
      server_id: targetMode === 'existing' ? selectedServerId : undefined,
      new_server: targetMode === 'new' ? newServer : undefined,
    };
  };

  // Generate Script Preview
  const handlePreviewScript = async () => {
    try {
      setIsGeneratingScript(true);
      const compiled = getCompiledPlan();
      const script = await generateProvisionScript(compiled);
      setGeneratedScript(script);
      setActiveTab('preview');
    } catch (err: any) {
      toast.error('Failed to generate bootstrap script', {
        description: typeof err === 'string' ? err : err?.message || 'Script generation error',
      });
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Copy Script to Clipboard
  const handleCopyScript = () => {
    navigator.clipboard.writeText(generatedScript);
    setScriptCopied(true);
    toast.success('Bootstrap script copied to clipboard');
    setTimeout(() => setScriptCopied(false), 2000);
  };

  // Download Script as file
  const handleDownloadScript = () => {
    const blob = new Blob([generatedScript], { type: 'text/x-sh' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bootstrap-${targetMode === 'new' ? newServer.name || 'server' : selectedServerId}.sh`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded bootstrap.sh');
  };

  // Launch Provisioning Execution
  const handleStartProvisioning = async () => {
    if (targetMode === 'new') {
      if (!newServer.name.trim()) {
        toast.error('Server Name is required');
        return;
      }
      if (!newServer.hostname.trim()) {
        toast.error('Server IP / Hostname is required');
        return;
      }
      if (!newServer.secret.trim()) {
        toast.error('SSH Password or Private Key is required');
        return;
      }
    } else {
      if (!selectedServerId) {
        toast.error('Please select an existing server to provision');
        return;
      }
    }

    try {
      setIsProvisioning(true);
      setCompletionStatus('idle');
      setCompletionError(null);
      setLogs([]);
      setStepStates({});
      setTotalElapsedTime(0);
      setActiveTab('running');

      const compiled = getCompiledPlan();
      const session = await startServerProvisioning(compiled);

      setSessionId(session.session_id);
      setTargetServerId(session.server_id);
      setExecutionSteps(session.steps);

      // Start elapsed timer
      timerRef.current = setInterval(() => {
        setTotalElapsedTime(prev => prev + 1);
      }, 1000);

      toast.info('Starting server bootstrap sequence', {
        description: `Connecting to ${session.server_name}...`,
      });
    } catch (err: any) {
      setIsProvisioning(false);
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to start provisioning';
      toast.error('Provisioning failed to start', { description: msg });
    }
  };

  // Cancel Running Provisioning
  const handleCancelProvisioning = async () => {
    if (!sessionId) return;
    try {
      await cancelServerProvisioning(sessionId);
      toast.warning('Cancel signal dispatched to remote host');
    } catch (err: any) {
      toast.error('Failed to cancel session');
    }
  };

  // Real-time Tauri Event Listeners
  useEffect(() => {
    if (!sessionId) return;

    let unlistenStep: UnlistenFn | null = null;
    let unlistenLog: UnlistenFn | null = null;
    let unlistenComplete: UnlistenFn | null = null;

    const setupListeners = async () => {
      unlistenStep = await listen<ProvisionStepEvent>(`provision://step:${sessionId}`, event => {
        const payload = event.payload;
        setCurrentStepIndex(payload.step_index);
        setStepStates(prev => ({
          ...prev,
          [payload.step_index]: {
            status: payload.status,
            duration_ms: payload.duration_ms,
            exit_code: payload.exit_code,
          },
        }));
      });

      unlistenLog = await listen<ProvisionLogEvent>(`provision://log:${sessionId}`, event => {
        setLogs(prev => [...prev, event.payload.text]);
      });

      unlistenComplete = await listen<ProvisionCompleteEvent>(`provision://complete:${sessionId}`, event => {
        const payload = event.payload;
        setIsProvisioning(false);
        if (timerRef.current) clearInterval(timerRef.current);

        if (payload.status === 'success') {
          setCompletionStatus('success');
          refetchServers();
          toast.success('🎉 Server provisioned successfully!', {
            description: `All daemons running natively in ${Math.round(payload.total_duration_ms / 1000)}s`,
          });
        } else if (payload.status === 'aborted') {
          setCompletionStatus('aborted');
          toast.warning('Server provisioning was aborted');
        } else {
          setCompletionStatus('failed');
          setCompletionError(payload.error || 'Execution encountered an unrecoverable step error.');
          toast.error('Provisioning encountered an error', {
            description: payload.error || 'Inspect terminal logs below.',
          });
        }
      });
    };

    setupListeners();

    return () => {
      if (unlistenStep) unlistenStep();
      if (unlistenLog) unlistenLog();
      if (unlistenComplete) unlistenComplete();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionId, refetchServers]);

  // Auto-scroll terminal
  useEffect(() => {
    if (activeTab === 'running') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 overflow-hidden bg-card border-border shadow-2xl">
          {/* Header */}
          <div className="p-5 sm:p-6 border-b border-border/60 bg-muted/20 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-xs">
                <Rocket className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                    Fresh Server Provisioning & Setup Wizard
                  </DialogTitle>
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] font-mono">
                    Zero Docker • Native Linux
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Transform clean VPS or bare-metal instances into hardened, production-ready servers with systemd orchestration.
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
                className="h-8 text-xs gap-1.5 border-border hover:bg-muted"
              >
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                History
              </Button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="px-6 pt-3 border-b border-border/40 bg-card">
            <Tabs value={activeTab} onValueChange={(val: any) => setActiveTab(val)}>
              <TabsList className="bg-muted/60 p-0.5 rounded-xl">
                <TabsTrigger value="config" disabled={isProvisioning} className="text-xs font-semibold px-4 py-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs">
                  <Layers className="w-3.5 h-3.5 mr-1.5" />
                  Blueprint & Presets
                </TabsTrigger>
                <TabsTrigger value="preview" disabled={isProvisioning} onClick={handlePreviewScript} className="text-xs font-semibold px-4 py-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs">
                  <Code2 className="w-3.5 h-3.5 mr-1.5" />
                  Bash Script Preview
                </TabsTrigger>
                <TabsTrigger value="running" disabled={!sessionId} className="text-xs font-semibold px-4 py-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs">
                  <Terminal className="w-3.5 h-3.5 mr-1.5" />
                  Live Provisioning
                  {isProvisioning && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping ml-1.5" />
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            {activeTab === 'config' && (
              <>
                {/* 1. Target Server Cluster */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <ServerIcon className="w-3.5 h-3.5" /> 1. Target Host Destination
                    </Label>
                    <div className="flex rounded-lg bg-muted/60 p-0.5 border border-border/40">
                      <button
                        type="button"
                        onClick={() => setTargetMode('new')}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${
                          targetMode === 'new'
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        New Fresh VPS
                      </button>
                      <button
                        type="button"
                        onClick={() => setTargetMode('existing')}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${
                          targetMode === 'existing'
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Existing Server ({servers?.length || 0})
                      </button>
                    </div>
                  </div>

                  {targetMode === 'new' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 rounded-2xl bg-muted/20 border border-border">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Server Display Name</Label>
                        <Input
                          placeholder="e.g. Production Web LON-1"
                          value={newServer.name}
                          onChange={e => setNewServer({ ...newServer, name: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">IP Address / Hostname</Label>
                        <Input
                          placeholder="e.g. 159.65.120.45"
                          value={newServer.hostname}
                          onChange={e => setNewServer({ ...newServer, hostname: e.target.value })}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">SSH Port</Label>
                        <Input
                          type="number"
                          value={newServer.ssh_port}
                          onChange={e => setNewServer({ ...newServer, ssh_port: parseInt(e.target.value) || 22 })}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Initial Root User</Label>
                        <Input
                          value={newServer.username}
                          onChange={e => setNewServer({ ...newServer, username: e.target.value })}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Auth Method</Label>
                        <select
                          value={newServer.auth_method}
                          onChange={e => setNewServer({ ...newServer, auth_method: e.target.value as any })}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none"
                        >
                          <option value="password">Root Password</option>
                          <option value="private_key">SSH Private Key (Vault)</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">
                          {newServer.auth_method === 'password' ? 'Root Password' : 'SSH Private Key Content'}
                        </Label>
                        <Input
                          type={newServer.auth_method === 'password' ? 'password' : 'text'}
                          placeholder={newServer.auth_method === 'password' ? '••••••••••••' : '-----BEGIN OPENSSH...'}
                          value={newServer.secret}
                          onChange={e => setNewServer({ ...newServer, secret: e.target.value })}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-muted/20 border border-border space-y-2">
                      <Label className="text-xs font-medium">Select Managed Server</Label>
                      <select
                        value={selectedServerId}
                        onChange={e => setSelectedServerId(e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none"
                      >
                        <option value="">-- Choose a server to bootstrap --</option>
                        {servers?.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.hostname}:{s.ssh_port}) — {s.environment}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted-foreground">
                        The provisioner will establish a pooled SSH connection using this server's saved credentials.
                      </p>
                    </div>
                  )}
                </div>

                {/* 2. One-Click Blueprint Presets */}
                <div className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> 2. One-Click Architecture Presets
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    <Card
                      onClick={() => applyPreset('node-pm2')}
                      className={`p-3.5 rounded-xl cursor-pointer transition-all border ${
                        preset === 'node-pm2'
                          ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                          : 'border-border/60 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                          <Rocket className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-xs">Node & PM2 Stack</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Node LTS, global PM2 + systemd, 2GB Swap, UFW (22, 80, 443), Fail2ban, Nginx & Certbot SSL.
                      </p>
                    </Card>

                    <Card
                      onClick={() => applyPreset('full-postgres')}
                      className={`p-3.5 rounded-xl cursor-pointer transition-all border ${
                        preset === 'full-postgres'
                          ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                          : 'border-border/60 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                          <Database className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-xs">PostgreSQL + Redis</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Node & PM2 web stack plus native PostgreSQL & Redis server (Zero Docker overhead).
                      </p>
                    </Card>

                    <Card
                      onClick={() => applyPreset('full-mysql')}
                      className={`p-3.5 rounded-xl cursor-pointer transition-all border ${
                        preset === 'full-mysql'
                          ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                          : 'border-border/60 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                          <Database className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-xs">MariaDB + Redis</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Node & PM2 web stack plus native MariaDB/MySQL engine & Redis cache server.
                      </p>
                    </Card>

                    <Card
                      onClick={() => applyPreset('hardened-minimal')}
                      className={`p-3.5 rounded-xl cursor-pointer transition-all border ${
                        preset === 'hardened-minimal'
                          ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                          : 'border-border/60 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                          <Shield className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-xs">Hardened Base</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Clean baseline: sudo deploy user, swapfile, UFW (22 only), Fail2ban, unattended security upgrades.
                      </p>
                    </Card>
                  </div>
                </div>

                {/* 3. Modular Feature Configuration */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5" /> 3. Modular System Features
                    </Label>
                    <Badge variant="outline" className="text-[10px]">
                      {preset.toUpperCase()} MODE
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {/* User & SSH Hardening Card */}
                    <Card className="p-4 rounded-2xl bg-card border-border space-y-3.5">
                      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                        <Shield className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold">User & SSH Hardening</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium">Create Non-Root Sudo User</Label>
                          <p className="text-[11px] text-muted-foreground">Creates passwordless sudo deploy account</p>
                        </div>
                        <Switch
                          checked={plan.create_deploy_user}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, create_deploy_user: checked });
                          }}
                        />
                      </div>

                      {plan.create_deploy_user && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Username</Label>
                            <Input
                              value={plan.deploy_username}
                              onChange={e => setPlan({ ...plan, deploy_username: e.target.value })}
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Public Key (Optional)</Label>
                            <Input
                              placeholder="Auto-copies root key if empty"
                              value={plan.deploy_public_key || ''}
                              onChange={e => setPlan({ ...plan, deploy_public_key: e.target.value })}
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between border-t border-border/30 pt-2.5">
                        <div>
                          <Label className="text-xs font-medium">Disable Root Password Auth</Label>
                          <p className="text-[11px] text-muted-foreground">Requires verified SSH key pair</p>
                        </div>
                        <Switch
                          checked={plan.disable_password_auth}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, disable_password_auth: checked });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-border/30 pt-2.5">
                        <div>
                          <Label className="text-xs font-medium">Auto Security Upgrades</Label>
                          <p className="text-[11px] text-muted-foreground">Enables unattended-upgrades daemon</p>
                        </div>
                        <Switch
                          checked={plan.enable_unattended_upgrades}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, enable_unattended_upgrades: checked });
                          }}
                        />
                      </div>
                    </Card>

                    {/* Swap Memory & Firewall Card */}
                    <Card className="p-4 rounded-2xl bg-card border-border space-y-3.5">
                      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                        <HardDrive className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold">Memory & Network Protection</span>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">Swap Memory Protection</Label>
                          <span className="text-[11px] font-mono text-primary font-bold">
                            {plan.swap_size_gb > 0 ? `${plan.swap_size_gb} GB` : 'Disabled'}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          {[0, 1, 2, 4, 8].map(gb => (
                            <button
                              key={gb}
                              type="button"
                              onClick={() => {
                                setPreset('custom');
                                setPlan({ ...plan, swap_size_gb: gb });
                              }}
                              className={`flex-1 py-1 text-xs rounded-lg border font-medium transition-all ${
                                plan.swap_size_gb === gb
                                  ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                                  : 'border-border bg-muted/40 hover:bg-muted text-muted-foreground'
                              }`}
                            >
                              {gb === 0 ? 'None' : `${gb}G`}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/30 pt-2.5">
                        <div>
                          <Label className="text-xs font-medium">UFW Firewall Suite</Label>
                          <p className="text-[11px] text-muted-foreground">Default deny incoming, allows {plan.ufw_allow_ports.join(', ')}</p>
                        </div>
                        <Switch
                          checked={plan.enable_ufw}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, enable_ufw: checked });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-border/30 pt-2.5">
                        <div>
                          <Label className="text-xs font-medium">Fail2ban Brute-Force Defense</Label>
                          <p className="text-[11px] text-muted-foreground">Jail bans IPs after repeated SSH failures</p>
                        </div>
                        <Switch
                          checked={plan.enable_fail2ban}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, enable_fail2ban: checked });
                          }}
                        />
                      </div>
                    </Card>

                    {/* App Runtimes Card */}
                    <Card className="p-4 rounded-2xl bg-card border-border space-y-3.5">
                      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                        <Cpu className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold">Runtimes & Process Managers</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium">Node.js LTS Runtime</Label>
                          <p className="text-[11px] text-muted-foreground">Official NodeSource repository</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={plan.node_version}
                            onChange={e => {
                              setPreset('custom');
                              setPlan({ ...plan, node_version: e.target.value });
                            }}
                            className="h-7 text-[11px] bg-background border border-input rounded px-1.5"
                          >
                            <option value="20">v20 LTS</option>
                            <option value="22">v22 LTS</option>
                          </select>
                          <Switch
                            checked={plan.install_node}
                            onCheckedChange={checked => {
                              setPreset('custom');
                              setPlan({ ...plan, install_node: checked });
                            }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/30 pt-2.5">
                        <div>
                          <Label className="text-xs font-medium">PM2 Global & Systemd Startup</Label>
                          <p className="text-[11px] text-muted-foreground">Process manager auto-starts on reboot</p>
                        </div>
                        <Switch
                          checked={plan.install_pm2}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, install_pm2: checked });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-border/30 pt-2.5">
                        <div>
                          <Label className="text-xs font-medium">Bun High-Performance Runtime</Label>
                          <p className="text-[11px] text-muted-foreground">Installs bun binary to /usr/local/bin</p>
                        </div>
                        <Switch
                          checked={plan.install_bun}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, install_bun: checked });
                          }}
                        />
                      </div>
                    </Card>

                    {/* Web Server & Native DB Card */}
                    <Card className="p-4 rounded-2xl bg-card border-border space-y-3.5">
                      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                        <Globe className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold">Web Server & Native DB (Zero Docker)</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium">Nginx Reverse Proxy & Certbot</Label>
                          <p className="text-[11px] text-muted-foreground">HTTP engine & Let's Encrypt automated ACME</p>
                        </div>
                        <Switch
                          checked={plan.install_nginx}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, install_nginx: checked, install_certbot: checked });
                          }}
                        />
                      </div>

                      <div className="space-y-1.5 border-t border-border/30 pt-2.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">Native Linux Database</Label>
                          <span className="text-[11px] font-mono text-muted-foreground">Systemd Daemon</span>
                        </div>
                        <select
                          value={plan.database_engine}
                          onChange={e => {
                            setPreset('custom');
                            setPlan({ ...plan, database_engine: e.target.value as any });
                          }}
                          className="w-full h-8 rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm"
                        >
                          <option value="none">None (Clean Host)</option>
                          <option value="postgresql">PostgreSQL (Native apt package)</option>
                          <option value="mariadb">MariaDB (Native apt package)</option>
                          <option value="mysql">MySQL Server (Native apt package)</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/30 pt-2.5">
                        <div>
                          <Label className="text-xs font-medium">Redis In-Memory Cache Server</Label>
                          <p className="text-[11px] text-muted-foreground">Installs and starts redis-server daemon</p>
                        </div>
                        <Switch
                          checked={plan.install_redis}
                          onCheckedChange={checked => {
                            setPreset('custom');
                            setPlan({ ...plan, install_redis: checked });
                          }}
                        />
                      </div>
                    </Card>
                  </div>
                </div>
              </>
            )}

            {/* Bash Script Preview Tab */}
            {activeTab === 'preview' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Generated Standalone Bash Script</h3>
                    <p className="text-xs text-muted-foreground">
                      This script can be executed directly on any Ubuntu/Debian host via SSH or cloud-init.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyScript}
                      className="h-8 text-xs gap-1.5"
                    >
                      {scriptCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {scriptCopied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadScript}
                      className="h-8 text-xs gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download .sh
                    </Button>
                  </div>
                </div>

                <div className="relative rounded-2xl bg-[#0d1117] border border-border/80 overflow-hidden font-mono text-xs">
                  <div className="p-4 max-h-[500px] overflow-y-auto text-emerald-400/90 whitespace-pre leading-relaxed select-text">
                    {generatedScript || '# Click "Preview Script" to generate POSIX bootstrap script...'}
                  </div>
                </div>
              </div>
            )}

            {/* Live Execution Tab */}
            {activeTab === 'running' && (
              <div className="space-y-4">
                {/* Status Bar */}
                <div className="p-4 rounded-2xl bg-muted/30 border border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isProvisioning ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    ) : completionStatus === 'success' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : completionStatus === 'aborted' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive" />
                    )}
                    <div>
                      <span className="font-bold text-sm text-foreground">
                        {isProvisioning
                          ? 'Executing Server Provisioning Pipeline...'
                          : completionStatus === 'success'
                          ? 'Provisioning Completed Successfully!'
                          : completionStatus === 'aborted'
                          ? 'Provisioning Aborted by Operator'
                          : 'Provisioning Failed'}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {isProvisioning
                          ? `Currently running Step ${currentStepIndex + 1} of ${executionSteps.length}`
                          : completionError
                          ? completionError
                          : `Total time elapsed: ${totalElapsedTime}s`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isProvisioning && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleCancelProvisioning}
                        className="h-8 text-xs gap-1.5"
                      >
                        <StopCircle className="w-3.5 h-3.5" />
                        Cancel
                      </Button>
                    )}
                    {completionStatus === 'success' && targetServerId && (
                      <Button
                        size="sm"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/servers/${targetServerId}`);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Server Cockpit
                      </Button>
                    )}
                  </div>
                </div>

                {/* Steps Pipeline Visual Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {executionSteps.map((step, idx) => {
                    const st = stepStates[idx];
                    const isRunning = st?.status === 'running';
                    const isSuccess = st?.status === 'success';
                    const isFailed = st?.status === 'failed';

                    return (
                      <div
                        key={step.id}
                        className={`p-2.5 rounded-xl border transition-all text-xs flex items-center justify-between ${
                          isRunning
                            ? 'border-primary bg-primary/10 shadow-xs'
                            : isSuccess
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : isFailed
                            ? 'border-destructive/40 bg-destructive/5'
                            : 'border-border/50 bg-card/60 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {isRunning ? (
                            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                          ) : isSuccess ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : isFailed ? (
                            <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-medium truncate">{step.label}</span>
                        </div>
                        {st?.duration_ms ? (
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0 ml-1">
                            {(st.duration_ms / 1000).toFixed(1)}s
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Live Terminal Log Stream */}
                <div className="rounded-2xl bg-[#0a0d12] border border-border/80 overflow-hidden shadow-inner flex flex-col h-[320px]">
                  <div className="px-3.5 py-2 border-b border-border/30 bg-[#11151c] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-primary" />
                      <span className="text-[11px] font-mono text-muted-foreground">
                        Live SSH Terminal Stream
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(logs.join(''));
                        toast.success('Logs copied to clipboard');
                      }}
                      className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy Output
                    </Button>
                  </div>

                  <div className="flex-1 p-3.5 overflow-y-auto font-mono text-xs text-emerald-400/90 whitespace-pre-wrap leading-relaxed select-text space-y-0.5">
                    {logs.length === 0 ? (
                      <span className="text-muted-foreground italic">
                        Connecting to remote host and waiting for initial stdout...
                      </span>
                    ) : (
                      logs.map((line, i) => <div key={i}>{line}</div>)
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="p-4 sm:p-5 border-t border-border/60 bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {activeTab === 'config' ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isGeneratingScript}
                  onClick={handlePreviewScript}
                  className="text-xs gap-1.5 border-border"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  Preview Script
                </Button>
              ) : activeTab === 'preview' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('config')}
                  className="text-xs"
                >
                  Back to Config
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Session ID: <code className="font-mono text-[10px]">{sessionId?.slice(0, 8)}</code>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs"
              >
                {isProvisioning ? 'Hide Modal (Runs in Background)' : 'Close'}
              </Button>

              {activeTab !== 'running' && (
                <Button
                  size="sm"
                  onClick={handleStartProvisioning}
                  className="bg-primary text-primary-foreground font-semibold text-xs gap-1.5 shadow-sm"
                >
                  <Rocket className="w-4 h-4" />
                  Launch Provisioning
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* History Modal */}
      <ProvisionHistoryModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        serverId={selectedServerId}
      />
    </>
  );
};
