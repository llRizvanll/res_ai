// Display helpers for backup files.
import { badge } from '../../ui/index.js';

export const sizeFmt = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
export function backupKind(name: string): string {
  if (name.startsWith('before-reset')) return badge('Auto · before reset', 'warn');
  if (name.startsWith('before-restore')) return badge('Auto · before restore', 'info');
  if (name.startsWith('closing')) return badge('Closing', 'ok');
  if (name.startsWith('daily')) return badge('Daily', 'info');
  if (name.startsWith('before-delete')) return badge('Auto · before delete', 'warn');
  return badge('Manual', 'ok');
}
