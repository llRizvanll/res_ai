// Connection banner: staff must know when the server isn't receiving their work.
import { api } from '../core/api.js';
import { UI_CONFIG } from '../config.js';
import { toast } from '../ui/index.js';

/** Shows a banner while the server is unreachable; calls onReconnect when it answers again */
export function installConnectionBanner(onReconnect: () => void) {
  const banner = document.createElement('div');
  banner.className = 'net-banner';
  banner.hidden = true;
  banner.innerHTML = '<b>Connection to the server lost.</b> Don’t close this screen — unsent items are kept. Checking again…';
  document.body.appendChild(banner);
  let timer = 0;
  window.addEventListener('net:down', () => {
    banner.hidden = false;
    clearInterval(timer);
    timer = window.setInterval(() => api.get('/branding').catch(() => {}), UI_CONFIG.timing.reconnectCheckMs); // a success fires net:up
  });
  window.addEventListener('net:up', () => {
    if (banner.hidden) return;
    banner.hidden = true;
    clearInterval(timer);
    toast('Reconnected to the server');
    onReconnect();
  });
}
