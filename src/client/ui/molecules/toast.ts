// Molecule: short-lived notification at the bottom of the screen, and `guard`, which reports a failed action through it.
import { UI_CONFIG } from '../../config.js';

export function toast(msg: string, type: 'ok' | 'error' | 'info' = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  const ms = type === 'error' ? UI_CONFIG.timing.errorToastMs : UI_CONFIG.timing.toastMs;
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 500);
}

/** Wraps an async click handler so errors surface as toasts and double-clicks are ignored */
export function guard<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  let busy = false;
  return async (...a: A) => {
    if (busy) return;
    busy = true;
    try {
      await fn(...a);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  };
}
