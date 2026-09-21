import React, { useEffect, useState } from 'react';
import { useHealth, HealthSnapshot } from '../api';
import { Cpu, HardDrive, MemoryStick, Clock, Activity, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from './Sparkline';

interface HealthWidgetProps {
  serverId: string;
  variant?: 'compact' | 'full';
  pollInterval?: number;
}

const ProgressBar = ({ pct, colorClass }: { pct: number, colorClass: string }) => (
  <div className="w-full bg-secondary/50 rounded-full h-1.5 overflow-hidden">
    <div className={cn("h-full transition-all duration-500", colorClass)} style={{ width: `${Math.min(pct, 100)}%` }} />
  </div>
);

export const HealthWidget: React.FC<HealthWidgetProps> = ({ serverId, variant = 'compact', pollInterval = 15000 }) => {
  const { data, isLoading, isError } = useHealth(serverId, pollInterval);

  // Keep a ring buffer of up to 180 samples (30 minutes at 10s intervals)
  const [history, setHistory] = useState<{ cpu: number[], ram: number[], disk: number[] }>({
    cpu: [],
    ram: [],
    disk: []
  });

  // Append new data to history, discarding oldest if > 180
  useEffect(() => {
    if (data && variant === 'full') {
      setHistory(prev => {
        const nextCpu = [...prev.cpu, data.cpu_pct].slice(-180);
        const nextRam = [...prev.ram, data.ram_pct].slice(-180);
        const nextDisk = [...prev.disk, data.disk_pct].slice(-180);
        return { cpu: nextCpu, ram: nextRam, disk: nextDisk };
      });
    }
  }, [data, variant]);

  if (isLoading && !data) {
    if (variant === 'compact') {
      return (
        <div className="flex flex-col gap-2 mt-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border rounded-xl bg-card">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const getStatusColor = (pct: number) => {
    if (pct > 90) return 'bg-red-500';
    if (pct > 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    return `${d}d ${h}h ${m}m`;
  };

  if (variant === 'compact') {
    return (
      <div className={cn("mt-4 space-y-3 relative", isError && "opacity-60")}>
        {isError && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/50 rounded backdrop-blur-[1px]">
            <span className="text-xs text-destructive flex items-center font-medium bg-background px-2 py-1 rounded shadow"><AlertTriangle className="h-3 w-3 mr-1"/> Stale</span>
          </div>
        )}
        
        {/* CPU */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Cpu className="h-3 w-3"/> CPU</span>
            <span className="font-medium">{data?.cpu_pct.toFixed(1)}%</span>
          </div>
          <ProgressBar pct={data?.cpu_pct || 0} colorClass={getStatusColor(data?.cpu_pct || 0)} />
        </div>

        {/* RAM */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><MemoryStick className="h-3 w-3"/> RAM</span>
            <span className="font-medium">{data?.ram_pct.toFixed(1)}%</span>
          </div>
          <ProgressBar pct={data?.ram_pct || 0} colorClass={getStatusColor(data?.ram_pct || 0)} />
        </div>

        {/* Disk */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3"/> Disk</span>
            <span className="font-medium">{data?.disk_pct.toFixed(1)}%</span>
          </div>
          <ProgressBar pct={data?.disk_pct || 0} colorClass={getStatusColor(data?.disk_pct || 0)} />
        </div>
      </div>
    );
  }

  // Full Variant
  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border rounded-xl bg-card relative", isError && "opacity-80")}>
      {isError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/50 rounded-xl backdrop-blur-[1px]">
          <span className="text-sm text-destructive flex items-center font-medium bg-background px-3 py-1.5 rounded-md shadow-lg border border-destructive/20"><AlertTriangle className="h-4 w-4 mr-2"/> Connection Lost / Stale Metrics</span>
        </div>
      )}

      {/* CPU */}
      <div className="flex flex-col gap-2 bg-secondary/20 p-3 rounded-lg border border-white/5 relative">
        <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
          <Cpu className="h-4 w-4" /> CPU
        </div>
        <div className="text-2xl font-semibold tracking-tight">{data?.cpu_pct.toFixed(1)}%</div>
        <div className="h-8 w-full mt-2">
          <Sparkline data={history.cpu} strokeColor="#3b82f6" fillColor="rgba(59, 130, 246, 0.15)" />
        </div>
        <ProgressBar pct={data?.cpu_pct || 0} colorClass={getStatusColor(data?.cpu_pct || 0)} />
      </div>

      {/* RAM */}
      <div className="flex flex-col gap-2 bg-secondary/20 p-3 rounded-lg border border-white/5 relative">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
            <MemoryStick className="h-4 w-4" /> RAM
          </div>
          <span className="text-xs text-muted-foreground">{data?.ram_used_mb}MB / {data?.ram_total_mb}MB</span>
        </div>
        <div className="text-2xl font-semibold tracking-tight">{data?.ram_pct.toFixed(1)}%</div>
        <div className="h-8 w-full mt-2">
          <Sparkline data={history.ram} strokeColor="#10b981" fillColor="rgba(16, 185, 129, 0.15)" />
        </div>
        <ProgressBar pct={data?.ram_pct || 0} colorClass={getStatusColor(data?.ram_pct || 0)} />
      </div>

      {/* Disk */}
      <div className="flex flex-col gap-2 bg-secondary/20 p-3 rounded-lg border border-white/5 relative">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
            <HardDrive className="h-4 w-4" /> Disk (/)
          </div>
          <span className="text-xs text-muted-foreground">{data?.disk_used_gb.toFixed(1)}GB / {data?.disk_total_gb.toFixed(1)}GB</span>
        </div>
        <div className="text-2xl font-semibold tracking-tight">{data?.disk_pct.toFixed(1)}%</div>
        <div className="h-8 w-full mt-2">
          <Sparkline data={history.disk} strokeColor="#8b5cf6" fillColor="rgba(139, 92, 246, 0.15)" />
        </div>
        <ProgressBar pct={data?.disk_pct || 0} colorClass={getStatusColor(data?.disk_pct || 0)} />
      </div>

      {/* Load & Uptime */}
      <div className="flex flex-col gap-3 bg-secondary/20 p-3 rounded-lg border border-white/5 justify-center">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
            <Activity className="h-3 w-3" /> Load Avg
          </div>
          <span className="text-xs font-medium">{data?.load_avg.map(v => v.toFixed(2)).join(', ')}</span>
        </div>
        <div className="w-full h-px bg-white/10" />
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
            <Clock className="h-3 w-3" /> Uptime
          </div>
          <span className="text-xs font-medium">{data ? formatUptime(data.uptime_seconds) : '--'}</span>
        </div>
      </div>

    </div>
  );
};
