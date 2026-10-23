// Restaurant branding: name, logo, brand colour and light/dark mode.
import { esc } from './dom.js';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Branding {
  name?: string;
  tagline?: string;
  logo?: string;
  theme_color?: string;
  theme_mode?: string;
}

export const DEFAULT_COLOR = '#e8590c';
const CACHE_KEY = 'branding_cache';
const PREF_KEY = 'theme_pref';

let current: Branding = {};

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — branding still applies for this visit */
  }
}
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** This device's own appearance choice; null means "follow the restaurant default" */
export function getDevicePref(): ThemeMode | null {
  const v = load(PREF_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : null;
}
export function setDevicePref(mode: ThemeMode | null) {
  store(PREF_KEY, mode);
  applyMode();
}

const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** Dark text on light brand colours (yellow, lime…), white text otherwise */
function onBrand(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.45 ? '#1d2433' : '#ffffff';
}

export function initials(name = ''): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] || 'R').slice(0, 1)).toUpperCase();
}

export function logoHTML(b: Branding, cls = 'logo'): string {
  return b.logo
    ? `<div class="${cls} has-img"><img src="${esc(b.logo)}" alt="${esc(b.name || 'Logo')}"></div>`
    : `<div class="${cls}">${esc(initials(b.name))}</div>`;
}

function applyMode() {
  const pref = getDevicePref() || (current.theme_mode as ThemeMode) || 'light';
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyMode);

function setFavicon(b: Branding, color: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (b.logo) {
    link.href = b.logo;
    return;
  }
  const fg = onBrand(color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="43" font-family="Arial,Helvetica,sans-serif" font-size="${initials(b.name).length > 1 ? 28 : 36}" font-weight="700" text-anchor="middle" fill="${fg}">${esc(initials(b.name))}</text></svg>`;
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Applies colours, mode and favicon. `persist` caches it so the next page load paints without a flash. */
export function applyBranding(b: Branding, persist = true) {
  current = { ...b };
  const color = isHex(b.theme_color) ? b.theme_color : DEFAULT_COLOR;
  const root = document.documentElement;
  root.style.setProperty('--brand', color);
  root.style.setProperty('--on-brand', onBrand(color));
  applyMode();
  setFavicon(b, color);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  if (persist) {
    const { name, tagline, logo, theme_color, theme_mode } = b;
    store(CACHE_KEY, JSON.stringify({ name, tagline, logo, theme_color, theme_mode }));
  }
}

export function cachedBranding(): Branding {
  try {
    return JSON.parse(load(CACHE_KEY) || '{}') as Branding;
  } catch {
    return {};
  }
}

/** Reads an uploaded image and returns a data URL, shrinking raster images to fit 256px */
export function readLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      reject(new Error('Please choose a PNG, JPG, WebP or SVG image'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      if (file.type === 'image/svg+xml') {
        if (dataUrl.length > 650_000) reject(new Error('SVG is too large (max ~500 KB)'));
        else resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be opened'));
      img.onload = () => {
        const scale = Math.min(1, 256 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
