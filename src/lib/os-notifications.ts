import { 
  isPermissionGranted, 
  requestPermission, 
  sendNotification 
} from '@tauri-apps/plugin-notification';

const DESKTOP_NOTIFICATION_STORAGE_KEY = 'scc_os_desktop_notifications_enabled';

/**
 * Check if OS desktop notifications are toggled on by user preference.
 * Defaults to true.
 */
export function isDesktopNotificationsUserEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(DESKTOP_NOTIFICATION_STORAGE_KEY);
  return stored !== 'false';
}

/**
 * Set user preference for desktop notifications.
 */
export function setDesktopNotificationsUserEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DESKTOP_NOTIFICATION_STORAGE_KEY, String(enabled));
}

/**
 * Check if notification permission has been granted at the OS/WebView level.
 */
export async function checkNotificationPermission(): Promise<boolean> {
  try {
    const granted = await isPermissionGranted();
    if (granted) return true;
  } catch {
    // Fall back to Web Notification API check
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission === 'granted';
    }
  }
  return false;
}

/**
 * Request notification permission from the OS / user.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    let permission = await isPermissionGranted();
    if (!permission) {
      const res = await requestPermission();
      permission = res === 'granted';
    }
    return permission;
  } catch {
    // Fallback to standard Web Notification API request
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const res = await Notification.requestPermission();
      return res === 'granted';
    }
    return false;
  }
}

export interface DesktopNotificationPayload {
  title: string;
  body: string;
  extra?: Record<string, unknown>;
}

/**
 * Send an OS Desktop Notification (Windows Action Center, macOS Notification Center, Linux libnotify).
 * Respects user enable/disable preference and checks permissions automatically.
 */
export async function sendDesktopAlert(payload: DesktopNotificationPayload): Promise<boolean> {
  if (!isDesktopNotificationsUserEnabled()) {
    return false;
  }

  try {
    let permission = await checkNotificationPermission();
    if (!permission) {
      permission = await requestNotificationPermission();
    }

    if (!permission) {
      console.warn('[DesktopNotifications] Notification permission was not granted by OS/User');
      return false;
    }

    // Try Tauri official plugin first
    try {
      sendNotification({
        title: payload.title,
        body: payload.body,
      });
      return true;
    } catch (pluginErr) {
      console.warn('[DesktopNotifications] Tauri plugin send failed, attempting Web Notification fallback:', pluginErr);
      
      // Fallback to Web Notification API
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(payload.title, {
          body: payload.body,
        });
        return true;
      }
    }
  } catch (err) {
    console.error('[DesktopNotifications] Failed to send OS desktop notification:', err);
  }

  return false;
}

/**
 * Send a quick test notification to confirm OS notification center integration.
 */
export async function sendTestDesktopNotification(): Promise<boolean> {
  // Ensure permission is requested
  const granted = await requestNotificationPermission();
  if (!granted) {
    return false;
  }

  return await sendDesktopAlert({
    title: 'Server Command Center • Test Alert',
    body: 'OS Desktop Notification subsystem is active and operating normally across your workstation.',
  });
}
