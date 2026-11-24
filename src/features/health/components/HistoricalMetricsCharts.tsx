import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMetricsHistory, type MetricsHistoryRange, type MetricPoint } from '@/lib/tauri-client';
import { Cpu, MemoryStick, HardDrive, Activity, RefreshCw, Clock, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface HistoricalMetricsChartsProps {
  serverId: string;
  className?: string;
}

type MetricType = 'cpu' | 'ram' | 'disk' | 'load';

interface MetricConfig {
  id: MetricType;
  label: string;
  unit: string;
  color: string;
  gradientId: string;
  stroke: string;
  icon: React.ComponentType<{ className?: string }>;
  getValue: (p: MetricPoint) => number;
  format: (v: number) => string;
}

const METRICS_CONFIG: MetricConfig[] = [
  {
    id: 'cpu',
    label: 'CPU Utilization',
    unit: '%',
    color: 'text-blue-500',
    gradientId: 'cpuGradient',
    stroke: '#3b82f6',
    icon: Cpu,
    getValue: (p) => p.cpu_pct,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    id: 'ram',
    label: 'RAM Memory',
    unit: '%',
    color: 'text-emerald-500',
    gradientId: 'ramGradient',
    stroke: '#10b981',
    icon: MemoryStick,
    getValue: (p) => p.ram_pct,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    id: 'disk',
    label: 'Disk Space (/)',
    unit: '%',
    color: 'text-purple-500',
    gradientId: 'diskGradient',
    stroke: '#8b5cf6',
    icon: HardDrive,
    getValue: (p) => p.disk_pct,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    id: 'load',
    label: 'Load Average (1m)',
    unit: '',
    color: 'text-amber-500',
    gradientId: 'loadGradient',
    stroke: '#f59e0b',
    icon: Activity,
    getValue: (p) => p.load_1m,
    format: (v) => v.toFixed(2),
  },
];

export const HistoricalMetricsCharts: React.FC<HistoricalMetricsChartsProps> = ({
  serverId,
  className,
}) => {
  const [timeRange, setTimeRange] = useState<MetricsHistoryRange>('1h');
  const [activeMetric, setActiveMetric] = useState<MetricType>('cpu');
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; point: MetricPoint } | null>(null);

  const { data: rawPoints, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['metrics-history', serverId, timeRange],
    queryFn: () => getMetricsHistory(serverId, timeRange),
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const config = useMemo(
    () => METRICS_CONFIG.find((m) => m.id === activeMetric) || METRICS_CONFIG[0],
    [activeMetric]
  );

  const points = rawPoints || [];

  const stats = useMemo(() => {
    if (points.length === 0) {
      return { current: 0, min: 0, max: 0, avg: 0 };
    }
    const values = points.map((p) => config.getValue(p));
    const current = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    return { current, min, max, avg };
  }, [points, config]);

  // SVG Chart parameters
  const chartWidth = 800;
  const chartHeight = 220;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 35;

  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  // Compute Y-domain based on metric
  const yMax = useMemo(() => {
    if (activeMetric === 'load') {
      const maxVal = Math.max(stats.max * 1.25, 2.0);
      return Math.ceil(maxVal * 2) / 2;
    }
    return 100;
  }, [activeMetric, stats.max]);

  const yMin = 0;

  // Map data points to SVG coordinates
  const svgCoordinates = useMemo(() => {
    if (points.length === 0) return [];

    return points.map((p, idx) => {
      const x =
        points.length === 1
          ? paddingLeft + innerWidth / 2
          : paddingLeft + (idx / (points.length - 1)) * innerWidth;
      const val = config.getValue(p);
      const normalizedY = (val - yMin) / (yMax - yMin || 1);
      const clampedNorm = Math.max(0, Math.min(1, normalizedY));
      const y = paddingTop + innerHeight - clampedNorm * innerHeight;
      return { x, y, point: p };
    });
  }, [points, config, innerWidth, innerHeight, yMin, yMax]);

  const { pathD, fillD } = useMemo(() => {
    if (svgCoordinates.length === 0) return { pathD: '', fillD: '' };

    const pts = svgCoordinates;
    const path = `M ${pts.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L ')}`;
    const bottomY = paddingTop + innerHeight;
    const fill = `M ${pts[0].x.toFixed(1)},${bottomY} L ${pts
      .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join(' L ')} L ${pts[pts.length - 1].x.toFixed(1)},${bottomY} Z`;

    return { pathD: path, fillD: fill };
  }, [svgCoordinates, innerHeight]);

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return ts;
      if (timeRange === '7d') {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
      }
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (svgCoordinates.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    // Find nearest point
    let closest = svgCoordinates[0];
    let minDistance = Math.abs(mouseX - closest.x);

    for (let i = 1; i < svgCoordinates.length; i++) {
      const dist = Math.abs(mouseX - svgCoordinates[i].x);
      if (dist < minDistance) {
        minDistance = dist;
        closest = svgCoordinates[i];
      }
    }

    setHoveredPoint(closest);
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  return (
    <div className={cn("p-5 rounded-2xl bg-card border border-border flex flex-col gap-5 shadow-xs", className)}>
      {/* Top Header: Metric Type & Time Range Selectors */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              Historical Telemetry Trends
            </h3>
            <p className="text-xs text-muted-foreground">
              Local persistent resource timeline (CPU, RAM, Disk & Load Averages)
            </p>
          </div>
        </div>

        {/* Range Selector & Manual Refresh */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border">
            {(['1h', '24h', '7d'] as MetricsHistoryRange[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setTimeRange(r)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-lg transition-all",
                  timeRange === r
                    ? "bg-card text-foreground font-semibold shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {r === '1h' ? '1 Hour' : r === '24h' ? '24 Hours' : '7 Days'}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs border-border hover:bg-muted text-muted-foreground hover:text-foreground"
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            title="Refresh historical data"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Metric Selector Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {METRICS_CONFIG.map((m) => {
          const Icon = m.icon;
          const isSelected = activeMetric === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setActiveMetric(m.id)}
              className={cn(
                "flex items-center justify-between p-3 rounded-xl border transition-all text-left",
                isSelected
                  ? "bg-muted/80 border-primary/40 shadow-xs"
                  : "bg-muted/30 border-border hover:border-border/80 hover:bg-muted/50"
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4 shrink-0", m.color)} />
                <div>
                  <div className="text-xs font-medium text-foreground">{m.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {points.length > 0 ? m.format(m.getValue(points[points.length - 1])) : '--'}
                  </div>
                </div>
              </div>
              {isSelected && (
                <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 shadow-[0_0_8px_currentColor]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Stats Summary Pills for Active Metric */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
        <div className="p-2.5 rounded-xl bg-muted/40 border border-border flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Current</span>
          <span className="text-base font-semibold font-mono text-foreground mt-0.5">
            {points.length > 0 ? config.format(stats.current) : '--'}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-muted/40 border border-border flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
            <ArrowDownRight className="h-3 w-3 text-emerald-500" /> Minimum
          </span>
          <span className="text-base font-semibold font-mono text-foreground mt-0.5">
            {points.length > 0 ? config.format(stats.min) : '--'}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-muted/40 border border-border flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
            <Minus className="h-3 w-3 text-blue-500" /> Average
          </span>
          <span className="text-base font-semibold font-mono text-foreground mt-0.5">
            {points.length > 0 ? config.format(stats.avg) : '--'}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-muted/40 border border-border flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
            <ArrowUpRight className="h-3 w-3 text-rose-500" /> Maximum
          </span>
          <span className="text-base font-semibold font-mono text-foreground mt-0.5">
            {points.length > 0 ? config.format(stats.max) : '--'}
          </span>
        </div>
      </div>

      {/* SVG Interactive Area Chart */}
      <div className="relative w-full h-64 bg-muted/20 border border-border rounded-xl p-2 select-none overflow-hidden">
        {isLoading && points.length === 0 ? (
          <div className="h-full flex flex-col justify-center gap-2 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : points.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-xs font-medium text-foreground">Awaiting Historical Telemetry</p>
            <p className="text-[11px] max-w-sm mt-1">
              Resource telemetry is recorded automatically whenever the server is monitored or health is polled.
            </p>
          </div>
        ) : (
          <div className="relative w-full h-full">
            <svg
              className="w-full h-full cursor-crosshair overflow-visible"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={config.stroke} stopOpacity="0.30" />
                  <stop offset="100%" stopColor={config.stroke} stopOpacity="0.00" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines & Y-Axis Labels */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((ratio) => {
                const y = paddingTop + innerHeight - ratio * innerHeight;
                const labelVal = yMin + ratio * (yMax - yMin);
                return (
                  <g key={ratio}>
                    <line
                      x1={paddingLeft}
                      y1={y}
                      x2={paddingLeft + innerWidth}
                      y2={y}
                      stroke="currentColor"
                      className="text-border/70"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={paddingLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[10px] fill-muted-foreground font-mono"
                    >
                      {activeMetric === 'load' ? labelVal.toFixed(1) : `${Math.round(labelVal)}%`}
                    </text>
                  </g>
                );
              })}

              {/* Area Gradient Fill */}
              {fillD && (
                <path
                  d={fillD}
                  fill={`url(#${config.gradientId})`}
                  className="transition-all duration-300"
                />
              )}

              {/* Crisp Trend Line */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke={config.stroke}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* Data points (when points <= 40) */}
              {svgCoordinates.length <= 40 &&
                svgCoordinates.map((pt, idx) => (
                  <circle
                    key={idx}
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredPoint?.point === pt.point ? 5 : 2.5}
                    fill={config.stroke}
                    className="transition-all duration-150"
                  />
                ))}

              {/* Hover Indicator Crosshair */}
              {hoveredPoint && (
                <g>
                  <line
                    x1={hoveredPoint.x}
                    y1={paddingTop}
                    x2={hoveredPoint.x}
                    y2={paddingTop + innerHeight}
                    stroke="currentColor"
                    className="text-foreground/40"
                    strokeDasharray="2 2"
                    strokeWidth="1.2"
                  />
                  <circle
                    cx={hoveredPoint.x}
                    cy={hoveredPoint.y}
                    r="5.5"
                    fill={config.stroke}
                    stroke="#ffffff"
                    strokeWidth="2"
                    className="shadow-md"
                  />
                </g>
              )}

              {/* X-Axis Time Labels */}
              {svgCoordinates.length > 0 &&
                [0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => {
                  const ptIndex = Math.min(
                    Math.floor(ratio * (svgCoordinates.length - 1)),
                    svgCoordinates.length - 1
                  );
                  const pt = svgCoordinates[ptIndex];
                  if (!pt) return null;
                  return (
                    <text
                      key={idx}
                      x={pt.x}
                      y={chartHeight - 8}
                      textAnchor={ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'}
                      className="text-[10px] fill-muted-foreground font-mono"
                    >
                      {formatTimestamp(pt.point.timestamp)}
                    </text>
                  );
                })}
            </svg>

            {/* Hover Tooltip Box */}
            {hoveredPoint && (
              <div
                className="absolute pointer-events-none z-20 bg-popover/95 backdrop-blur-md border border-border p-2.5 rounded-xl shadow-lg text-xs flex flex-col gap-1 font-mono transition-transform"
                style={{
                  left: `${Math.min(
                    Math.max(10, (hoveredPoint.x / chartWidth) * 100),
                    82
                  )}%`,
                  top: '12px',
                }}
              >
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTimestamp(hoveredPoint.point.timestamp)}
                </div>
                <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
                  <span className={config.color}>
                    {config.label}: {config.format(config.getValue(hoveredPoint.point))}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground grid grid-cols-2 gap-x-2 pt-0.5 border-t border-border/50">
                  <span>CPU: {hoveredPoint.point.cpu_pct.toFixed(1)}%</span>
                  <span>RAM: {hoveredPoint.point.ram_pct.toFixed(1)}%</span>
                  <span>Disk: {hoveredPoint.point.disk_pct.toFixed(1)}%</span>
                  <span>Load: {hoveredPoint.point.load_1m.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

