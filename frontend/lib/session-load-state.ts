export type SessionLoadState =
  | 'idle'
  | 'loading_backend'
  | 'ready_backend'
  | 'fallback_local'
  | 'failed';

export function isSessionReady(state: SessionLoadState): boolean {
  return state === 'ready_backend' || state === 'fallback_local';
}
