import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type AppEvent =
  | { type: 'terminal://data', payload: { sessionId: string; data: string } }
  | { type: 'pipeline://step-update', payload: { deploymentId: string; stepId: string; status: string; output: string } }
  | { type: 'health://update', payload: { serverId: string; stats: any } }
  | { type: 'log://data', payload: { applicationId: string; level: string; message: string } };

export const subscribeToEvent = async <T extends AppEvent['type']>(
  event: T,
  handler: (payload: Extract<AppEvent, { type: T }>['payload']) => void
): Promise<UnlistenFn> => {
  return await listen<Extract<AppEvent, { type: T }>['payload']>(event, (e) => {
    handler(e.payload);
  });
};
