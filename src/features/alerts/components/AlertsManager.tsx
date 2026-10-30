import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { getAlertRules, saveAlertRule, getAlertHistory, type AlertRule, type AlertHistoryEntry } from '@/lib/tauri-client';
import { listen } from '@tauri-apps/api/event';
import { BellRing, Cpu, HardDrive, MemoryStick, AlertTriangle, History, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';

interface AlertsManagerProps {
  serverId: string;
}

export const AlertsManager: React.FC<AlertsManagerProps> = ({ serverId }) => {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Default metric form states
  const [cpuThreshold, setCpuThreshold] = useState(85);
  const [cpuEnabled, setCpuEnabled] = useState(true);

  const [memThreshold, setMemThreshold] = useState(90);
  const [memEnabled, setMemEnabled] = useState(true);

  const [diskThreshold, setDiskThreshold] = useState(90);
  const [diskEnabled, setDiskEnabled] = useState(true);

  const [pm2Threshold, setPm2Threshold] = useState(1);
  const [pm2Enabled, setPm2Enabled] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rulesData, historyData] = await Promise.all([
        getAlertRules(serverId),
        getAlertHistory(serverId, 30),
      ]);
      setRules(rulesData);
      setHistory(historyData);

      // Populate local states
      rulesData.forEach(r => {
        if (r.metric === 'cpu') {
          setCpuThreshold(r.threshold);
          setCpuEnabled(r.enabled);
        } else if (r.metric === 'memory') {
          setMemThreshold(r.threshold);
          setMemEnabled(r.enabled);
        } else if (r.metric === 'disk') {
          setDiskThreshold(r.threshold);
          setDiskEnabled(r.enabled);
        } else if (r.metric === 'pm2_crash') {
          setPm2Threshold(r.threshold);
          setPm2Enabled(r.enabled);
        }
      });
    } catch (err: any) {
      toast.error('Failed to load alert settings', { description: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen to real-time alert events
    const unlisten = listen<AlertHistoryEntry>('alert://triggered', (event) => {
      if (event.payload.server_id === serverId) {
        toast.warning(`Alert Triggered: ${event.payload.metric.toUpperCase()}`, {
          description: event.payload.message,
          icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
        });
        setHistory(prev => [event.payload, ...prev]);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [serverId]);

  const handleSaveRule = async (metric: string, threshold: number, operator: string, enabled: boolean) => {
    try {
      const existing = rules.find(r => r.metric === metric);
      await saveAlertRule({
        id: existing?.id,
        server_id: serverId,
        metric,
        threshold,
        operator,
        enabled,
      });
      toast.success(`${metric.toUpperCase()} alert rule updated`);
      loadData();
    } catch (err: any) {
      toast.error('Failed to save alert rule', { description: err.message || String(err) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Threshold Alerts & Notifications</h2>
          <p className="text-sm text-muted-foreground">
            Configure automated triggers for CPU, Memory, Disk, and PM2 process failures.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CPU Alert Rule */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-500/10 text-blue-500 rounded-md">
                  <Cpu className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">CPU Usage Alert</CardTitle>
                  <CardDescription className="text-xs">Triggers when CPU exceeds threshold</CardDescription>
                </div>
              </div>
              <Switch
                checked={cpuEnabled}
                onCheckedChange={checked => {
                  setCpuEnabled(checked);
                  handleSaveRule('cpu', cpuThreshold, 'gt', checked);
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-medium w-24">Threshold:</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={cpuThreshold}
                onChange={e => setCpuThreshold(Number(e.target.value))}
                className="w-24 text-center font-mono text-sm"
              />
              <span className="text-xs font-semibold">%</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => handleSaveRule('cpu', cpuThreshold, 'gt', cpuEnabled)}
              >
                <Save className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Memory Alert Rule */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-purple-500/10 text-purple-500 rounded-md">
                  <MemoryStick className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Memory Usage Alert</CardTitle>
                  <CardDescription className="text-xs">Triggers when RAM exceeds threshold</CardDescription>
                </div>
              </div>
              <Switch
                checked={memEnabled}
                onCheckedChange={checked => {
                  setMemEnabled(checked);
                  handleSaveRule('memory', memThreshold, 'gt', checked);
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-medium w-24">Threshold:</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={memThreshold}
                onChange={e => setMemThreshold(Number(e.target.value))}
                className="w-24 text-center font-mono text-sm"
              />
              <span className="text-xs font-semibold">%</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => handleSaveRule('memory', memThreshold, 'gt', memEnabled)}
              >
                <Save className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Disk Alert Rule */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-md">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Disk Space Alert</CardTitle>
                  <CardDescription className="text-xs">Triggers when root filesystem fills up</CardDescription>
                </div>
              </div>
              <Switch
                checked={diskEnabled}
                onCheckedChange={checked => {
                  setDiskEnabled(checked);
                  handleSaveRule('disk', diskThreshold, 'gt', checked);
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-medium w-24">Threshold:</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={diskThreshold}
                onChange={e => setDiskThreshold(Number(e.target.value))}
                className="w-24 text-center font-mono text-sm"
              />
              <span className="text-xs font-semibold">%</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => handleSaveRule('disk', diskThreshold, 'gt', diskEnabled)}
              >
                <Save className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* PM2 Crash Alert Rule */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-500/10 text-rose-500 rounded-md">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">PM2 Crash Detection</CardTitle>
                  <CardDescription className="text-xs">Triggers when apps enter error state</CardDescription>
                </div>
              </div>
              <Switch
                checked={pm2Enabled}
                onCheckedChange={checked => {
                  setPm2Enabled(checked);
                  handleSaveRule('pm2_crash', pm2Threshold, 'gt', checked);
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-medium w-24">Min Errored:</span>
              <Input
                type="number"
                min={1}
                max={10}
                value={pm2Threshold}
                onChange={e => setPm2Threshold(Number(e.target.value))}
                className="w-24 text-center font-mono text-sm"
              />
              <span className="text-xs font-semibold">Apps</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => handleSaveRule('pm2_crash', pm2Threshold, 'gt', pm2Enabled)}
              >
                <Save className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Triggered Alert History */}
      <Card>
        <CardHeader className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-semibold">Recent Triggered Alerts</CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">{history.length} Event(s)</span>
          </div>
        </CardHeader>
        <CardContent className="py-2 divide-y divide-border/40">
          {history.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No alert triggers recorded. All systems operating within normal parameters.
            </div>
          ) : (
            history.map(item => (
              <div key={item.id} className="py-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded bg-amber-500/10 text-amber-500">
                    <BellRing className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">{item.message}</span>
                    <div className="text-muted-foreground text-[11px] font-mono mt-0.5">
                      Metric: {item.metric.toUpperCase()} • Value: {item.value}
                    </div>
                  </div>
                </div>
                <span className="text-muted-foreground font-mono">
                  {new Date(item.triggered_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};
