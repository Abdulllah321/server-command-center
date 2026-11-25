import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { 
  Bell, 
  AlertTriangle, 
  CheckCircle2, 
  Trash2, 
  ExternalLink, 
  Volume2, 
  VolumeX, 
  Cpu, 
  MemoryStick, 
  HardDrive, 
  Activity,
  Monitor,
  MonitorOff,
  SendHorizontal
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getAllRecentAlerts, clearAlertHistory } from '@/lib/tauri-client';
import type { AlertHistoryEntry } from '@/types';
import { 
  sendDesktopAlert, 
  sendTestDesktopNotification, 
  isDesktopNotificationsUserEnabled, 
  setDesktopNotificationsUserEnabled,
  requestNotificationPermission 
} from '@/lib/os-notifications';

// Native Web Audio Synthesizer Chime (Zero External Files)
export const playAlertSound = (isCritical = false) => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const freq = isCritical ? 987.77 : 783.99; // B5 or G5
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(isCritical ? 1318.51 : 1046.50, ctx.currentTime + 0.15); // E6 or C6

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  } catch {
    // Audio context may be muted or blocked by autoplay policies
  }
};

export const NotificationCenterDropdown: React.FC = () => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertHistoryEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('scc_alert_sound_enabled') !== 'false';
  });
  const [desktopEnabled, setDesktopEnabled] = useState(() => isDesktopNotificationsUserEnabled());
  const [isSendingTest, setIsSendingTest] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadAlerts = async () => {
    try {
      const list = await getAllRecentAlerts(35);
      setAlerts(list);
    } catch {
      // Ignore initial silent fetch errors
    }
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 15000);
    return () => clearInterval(interval);
  }, []);

  // Global listener for alert://triggered across the entire app
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<AlertHistoryEntry>('alert://triggered', (event) => {
        const newAlert = event.payload;
        setAlerts(prev => [newAlert, ...prev.slice(0, 49)]);
        setUnreadCount(prev => prev + 1);

        const isCritical = newAlert.value >= 90 || newAlert.metric === 'pm2_crash';
        
        // 1. Play native Web Audio chime
        if (soundEnabled) {
          playAlertSound(isCritical);
        }

        // 2. Dispatch native OS Desktop Notification (Windows Action Center, macOS, Linux)
        if (desktopEnabled) {
          sendDesktopAlert({
            title: newAlert.server_name ? `Server Alert • ${newAlert.server_name}` : 'Server Health Alert',
            body: newAlert.message,
          });
        }

        // 3. In-App Toast
        toast.warning(newAlert.server_name ? `Alert: ${newAlert.server_name}` : 'Server Health Alert', {
          description: newAlert.message,
          icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
          action: {
            label: 'Inspect',
            onClick: () => navigate(`/servers/${newAlert.server_id}?tab=alerts`),
          },
          duration: 7000,
        });
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [soundEnabled, desktopEnabled, navigate]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('scc_alert_sound_enabled', String(next));
    if (next) playAlertSound(false);
    toast.info(next ? 'Alert sound chime enabled' : 'Alert sound chime muted');
  };

  const toggleDesktopNotifications = async () => {
    const next = !desktopEnabled;
    if (next) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        toast.error('OS notification permission was not granted by your system');
        return;
      }
    }
    setDesktopEnabled(next);
    setDesktopNotificationsUserEnabled(next);
    toast.info(next ? 'OS Desktop Notifications enabled' : 'OS Desktop Notifications disabled');
  };

  const handleSendTestNotification = async () => {
    try {
      setIsSendingTest(true);
      const sent = await sendTestDesktopNotification();
      if (sent) {
        toast.success('Test desktop notification sent to your OS Action Center');
      } else {
        toast.warning('Desktop notification dispatched. Check OS focus assist / Do Not Disturb settings if not visible.');
      }
    } catch {
      toast.error('Failed to trigger OS desktop notification');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAlertHistory();
      setAlerts([]);
      setUnreadCount(0);
      toast.success('Alert notifications cleared');
    } catch {
      toast.error('Failed to clear notifications');
    }
  };

  const handleOpenDropdown = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setUnreadCount(0);
      loadAlerts();
    }
  };

  const getMetricIcon = (metric: string) => {
    switch (metric) {
      case 'cpu':
        return <Cpu className="w-3.5 h-3.5 text-rose-500" />;
      case 'memory':
        return <MemoryStick className="w-3.5 h-3.5 text-amber-500" />;
      case 'disk':
        return <HardDrive className="w-3.5 h-3.5 text-blue-500" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-emerald-500" />;
    }
  };

  return (
    <div className="relative shrink-0 z-50" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        onClick={handleOpenDropdown}
        title="Fleet Watchdog Notifications & Alerts"
        className={`relative flex items-center justify-center w-8 h-8 rounded-xl border border-border bg-card/60 hover:bg-muted active:scale-95 text-muted-foreground hover:text-foreground transition-all cursor-pointer ${
          unreadCount > 0 ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' : ''
        }`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-xs animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-84 sm:w-[410px] rounded-2xl bg-card border border-border shadow-2xl backdrop-blur-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="p-3.5 border-b border-border/60 bg-muted/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">Fleet Alert Watchdog</span>
              {alerts.length > 0 && (
                <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 bg-background/80">
                  {alerts.length} recorded
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* Test OS Notification */}
              <button
                onClick={handleSendTestNotification}
                disabled={isSendingTest}
                title="Send test notification to OS Desktop Action Center"
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <SendHorizontal className={`w-3.5 h-3.5 ${isSendingTest ? 'animate-pulse text-primary' : ''}`} />
              </button>

              {/* Toggle OS Desktop Notifications */}
              <button
                onClick={toggleDesktopNotifications}
                title={desktopEnabled ? 'OS Desktop Notifications Enabled (Click to disable)' : 'OS Desktop Notifications Disabled (Click to enable)'}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                {desktopEnabled ? (
                  <Monitor className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <MonitorOff className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>

              {/* Sound Chime Toggle */}
              <button
                onClick={toggleSound}
                title={soundEnabled ? 'Mute Alert Sound Chime' : 'Enable Alert Sound Chime'}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>

              {/* Clear History */}
              {alerts.length > 0 && (
                <button
                  onClick={handleClearAll}
                  title="Clear all alerts"
                  className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Subheader: System Status Banner */}
          <div className="px-3.5 py-1.5 bg-muted/20 border-b border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${desktopEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
              <span>OS Desktop Toasts: {desktopEnabled ? 'Active' : 'Off'}</span>
            </span>
            <span className="text-[10px] font-mono opacity-80">
              Audio Chime: {soundEnabled ? 'ON' : 'MUTED'}
            </span>
          </div>

          {/* List of Alerts */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-border/30">
            {alerts.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-70" />
                <p className="text-xs font-semibold text-foreground">All Systems Healthy</p>
                <p className="text-[11px] text-muted-foreground">
                  No active resource threshold breaches or crashed PM2 workloads detected across your fleet.
                </p>
                <div className="pt-2">
                  <button
                    onClick={handleSendTestNotification}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    <SendHorizontal className="w-3 h-3" />
                    <span>Send Test OS Notification</span>
                  </button>
                </div>
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  onClick={() => {
                    setIsOpen(false);
                    navigate(`/servers/${alert.server_id}?tab=alerts`);
                  }}
                  className="p-3 hover:bg-muted/50 cursor-pointer transition-colors space-y-1 group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {getMetricIcon(alert.metric)}
                      <span className="text-xs font-bold text-foreground truncate">
                        {alert.server_name || 'Server Host'}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {alert.triggered_at ? new Date(alert.triggered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-snug group-hover:text-foreground transition-colors">
                    {alert.message}
                  </p>

                  <div className="flex items-center justify-between pt-0.5 text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="flex items-center gap-1">
                      Inspect Alerts Deck <ExternalLink className="w-2.5 h-2.5" />
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
