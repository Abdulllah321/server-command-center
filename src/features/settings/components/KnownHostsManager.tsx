import { useEffect, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { showIpcError } from '@/lib/error-handler';
import { 
  Server, 
  Key, 
  Trash2, 
  Copy, 
  Check, 
  Search, 
  RefreshCw, 
  Shield, 
  Info,
  Globe,
  Calendar
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useConfirmAction } from '@/components/shared/ConfirmationModal';

interface KnownHostInfo {
  server_id: string;
  server_name: string;
  hostname: string;
  fingerprint: string;
  created_at: string;
}

export const KnownHostsManager = () => {
  const [hosts, setHosts] = useState<KnownHostInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { requestConfirmation } = useConfirmAction();

  const fetchHosts = async () => {
    setLoading(true);
    try {
      const data = await invoke<KnownHostInfo[]>('list_known_hosts');
      setHosts(data);
    } catch (e: any) {
      showIpcError(e, { action: 'Fetch Known Hosts' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHosts();
  }, []);

  const handleCopy = (serverId: string, fingerprint: string) => {
    navigator.clipboard.writeText(fingerprint);
    setCopiedId(serverId);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Fingerprint copied to clipboard');
  };

  const handleRevoke = async (host: KnownHostInfo) => {
    try {
      await requestConfirmation(
        `Revoke the pinned SSH host key for "${host.server_name}" (${host.hostname})? Next time you connect, you will be prompted with a Trust-On-First-Use (TOFU) confirmation dialog to verify and pin the server's fingerprint again.`,
        [host.hostname]
      );
      await invoke('delete_known_host', { serverId: host.server_id });
      await fetchHosts();
      toast.success(`Revoked pinned key for ${host.server_name}`);
    } catch (e: any) {
      if (e?.message !== 'User cancelled action') {
        showIpcError(e, { action: 'Revoke Host Key', serverName: host.server_name });
      }
    }
  };

  const filteredHosts = useMemo(() => {
    if (!searchQuery.trim()) return hosts;
    const query = searchQuery.toLowerCase();
    return hosts.filter(h => 
      h.server_name.toLowerCase().includes(query) ||
      h.hostname.toLowerCase().includes(query) ||
      h.fingerprint.toLowerCase().includes(query)
    );
  }, [hosts, searchQuery]);

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="w-5 h-5 text-primary" /> Pinned SSH Known Hosts
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Cryptographic trust anchors stored locally. Revoking a pinned key allows deliberate re-verification during key rotations.
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchHosts} 
            disabled={loading}
            className="h-8 gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Info Banner */}
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span>
            When you connect to an SSH server for the first time, its public key fingerprint is saved here. 
            If a remote server's key changes without revocation, a high-severity mismatch alert is triggered to protect against connection interception.
          </span>
        </div>

        {/* Filter bar */}
        {hosts.length > 0 && (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Search by server name, hostname, or fingerprint..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
        )}

        {/* List of Known Hosts */}
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
            Loading known hosts...
          </div>
        ) : hosts.length === 0 ? (
          <div className="p-8 text-center border rounded-lg border-dashed bg-muted/10 space-y-2">
            <Key className="w-8 h-8 text-muted-foreground/50 mx-auto" />
            <p className="text-sm font-medium text-muted-foreground">No pinned host keys yet</p>
            <p className="text-xs text-muted-foreground/70 max-w-sm mx-auto">
              When you connect to your servers via terminal, health check, or rebuild pipelines, host keys will appear here after initial verification.
            </p>
          </div>
        ) : filteredHosts.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No known hosts match your search query.
          </div>
        ) : (
          <div className="divide-y border rounded-lg overflow-hidden bg-card">
            {filteredHosts.map((host) => {
              const isCopied = copiedId === host.server_id;
              return (
                <div 
                  key={host.server_id} 
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Server className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-semibold text-sm text-foreground">{host.server_name}</span>
                      <Badge variant="outline" className="text-[11px] font-mono gap-1 text-muted-foreground">
                        <Globe className="w-3 h-3" />
                        {host.hostname}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <div className="font-mono text-xs text-muted-foreground bg-muted/60 px-2.5 py-1 rounded border break-all max-w-full">
                        {host.fingerprint}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => handleCopy(host.server_id, host.fingerprint)}
                        title="Copy Fingerprint"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      <span>Pinned on {new Date(host.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleRevoke(host)}
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20 gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Revoke Key
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
