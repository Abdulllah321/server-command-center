import { toast } from 'sonner';

/**
 * Sanitizes and extracts a clean, human-readable error message from an IPC error or exception.
 * Strips technical wrappers, internal prefixes, and ensures no raw secrets are shown.
 */
export function formatErrorMessage(error: unknown, fallbackMessage = 'An unexpected error occurred'): string {
  if (!error) return fallbackMessage;

  let rawMessage = '';

  if (typeof error === 'string') {
    rawMessage = error;
  } else if (error instanceof Error) {
    rawMessage = error.message;
  } else if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof (error as any).message === 'string') {
      rawMessage = (error as any).message;
    } else {
      rawMessage = JSON.stringify(error);
    }
  } else {
    rawMessage = String(error);
  }

  // Clean up common Rust / IPC prefixes
  let cleaned = rawMessage
    .replace(/^(CommandError::\w+\("?|Internal error:\s*|Database error:\s*|Validation error:\s*|Invalid input:\s*)/i, '')
    .replace(/"?\)$/, '')
    .trim();

  // Strip JSON formatting if it was wrapped in quotes
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }

  return cleaned || fallbackMessage;
}

export interface ErrorContext {
  action: string;
  serverName?: string;
  description?: string;
}

/**
 * Displays a standardized, human-friendly error toast with clear action title and sanitized description.
 */
export function showIpcError(error: unknown, context: string | ErrorContext): void {
  // If user cancelled a confirmation modal, don't show an error toast
  const message = formatErrorMessage(error);
  if (message.includes('User cancelled') || message.includes('cancelled action')) {
    return;
  }

  if (typeof context === 'string') {
    toast.error(context, {
      description: message !== context ? message : undefined,
    });
    return;
  }

  const { action, serverName, description } = context;
  const title = serverName ? `Failed to ${action.toLowerCase()} on ${serverName}` : `Failed to ${action.toLowerCase()}`;
  const detail = description ? `${description}: ${message}` : message;

  toast.error(title, {
    description: detail !== title ? detail : undefined,
  });
}
