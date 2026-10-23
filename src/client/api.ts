const TOKEN_KEY = 'dineflow_token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token = readToken();

export const auth = {
  get token(): string | null {
    return token;
  },
  set(t: string) {
    token = t;
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* private mode: session-only login */
    }
  },
  clear() {
    token = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

const RESTAURANT_KEY = 'restaurant';
/** Which restaurant this device signs in to (only matters when there are several) */
export const restaurant = {
  get(): string {
    try {
      return localStorage.getItem(RESTAURANT_KEY) || 'main';
    } catch {
      return 'main';
    }
  },
  set(slug: string) {
    try {
      localStorage.setItem(RESTAURANT_KEY, slug);
    } catch {
      /* ignore */
    }
  },
};

let online = true;
/** Fires `net:down` / `net:up` on window when the server stops or starts answering */
function setOnline(ok: boolean) {
  if (ok === online) return;
  online = ok;
  window.dispatchEvent(new CustomEvent(ok ? 'net:up' : 'net:down'));
}

/** Unique id so a retried request (after a dropped connection) is recognised instead of duplicated */
export function requestRef(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    setOnline(false);
    throw new Error("Can't reach the server. Check the Wi-Fi / server PC and try again — your unsent items are kept on this screen.");
  }
  setOnline(true);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    auth.clear();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export const api = {
  get: <T = unknown>(p: string) => request<T>('GET', p),
  post: <T = unknown>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T = unknown>(p: string, b: unknown = {}) => request<T>('PUT', p, b),
  patch: <T = unknown>(p: string, b: unknown = {}) => request<T>('PATCH', p, b),
  del: <T = unknown>(p: string) => request<T>('DELETE', p),
};

/** Downloads a binary endpoint (e.g. DB backup) using the auth header */
export async function download(path: string, filename: string): Promise<void> {
  const res = await fetch('/api' + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const LIVE_EVENTS = ['kot', 'tables', 'orders', 'menu', 'settings'] as const;

/** Server-sent events so every screen (POS, floor, kitchen) updates live */
export function connectEvents(onEvent: (type: string) => void): EventSource | null {
  if (!token) return null;
  const es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  for (const ev of LIVE_EVENTS) es.addEventListener(ev, () => onEvent(ev));
  return es;
}
