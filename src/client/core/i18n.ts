// Screen language for this device (English or Arabic) and the translation layer.
// Screens are written in English. When Arabic is chosen, the text they render is swapped for its Arabic
// version from /i18n/ar.json, which is keyed by the English text. Numbers and amounts inside a sentence
// are matched as {0}, {1}… so "KOT #12 sent to kitchen" uses the entry "KOT #{0} sent to kitchen".
// A sentence with no entry simply stays in English, and names typed by the restaurant are never in the file.

export type Lang = 'en' | 'ar';
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];
const KEY = 'app_lang';
const LANDING_KEY = 'home_lang'; // a visitor who read the landing page in Arabic gets the app in Arabic too
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'KBD']);
/** Amounts and plain numbers, with an optional currency in front: ₹1,019.00 · −₹5 · 12 · 2.5
 *  (never digits inside a code such as INV-00894 or T4) */
const NUM = /(?<![\w-])[−-]?(?:₹|\$|€|£|AED ?|SAR ?|QAR ?|KWD ?|BHD ?|OMR ?)?\d[\d,]*(?:\.\d+)?(?![\w-])/g;

let lang: Lang = 'en';
let dict: Record<string, string> | null = null;
/** Entries that are a fixed phrase around one name: "Edit {0}", "{0} signed in" */
let around: { pre: string; post: string; ar: string }[] = [];
const NAME_ACTIONS = new Set(['Edit', 'Select', 'Order', 'Delete', 'Remove', 'Received', 'by', 'since', 'Value']);

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const isLang = (v: string | null): v is Lang => v === 'en' || v === 'ar';

export const currentLang = (): Lang => lang;
export const isRtl = () => lang === 'ar';

/** Saves the choice for this device and reloads, so every screen is drawn in the new language */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: applies to this visit only */
  }
  location.reload();
}

/** Decides the language, sets the page direction and, for Arabic, loads the translations. Call once before the first screen. */
export async function initI18n() {
  const saved = read(KEY) || read(LANDING_KEY);
  lang = isLang(saved) ? saved : (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  if (lang === 'en') return;
  try {
    const res = await fetch(`/i18n/${lang}.json`, { cache: 'no-cache' });
    if (res.ok) dict = await res.json();
  } catch {
    /* no translations reachable: screens stay in English rather than failing */
  }
  if (!dict) return;
  around = Object.keys(dict)
    .filter((k) => (k.startsWith('{0} ') || k.endsWith(' {0}')) && !/\{[1-9]\}/.test(k) && k.split('{0}').length === 2)
    // One-word phrases ("{0} Veg") could clip a dish name like "Mix Veg", so only longer phrases or action words qualify
    .filter((k) => k.replace('{0}', '').trim().split(' ').length > 1 || NAME_ACTIONS.has(k.replace('{0}', '').trim()))
    .map((k) => ({ pre: k.split('{0}')[0]!, post: k.split('{0}')[1]!, ar: dict![k]! }));
  translateTree(document.documentElement);
  new MutationObserver(onMutations).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

/** Text in the current language, for strings built in code: t('KOT #{0} sent', 12) */
export function t(en: string, ...args: (string | number)[]): string {
  const out = (dict && dict[en]) || en;
  return args.length ? out.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m)) : out;
}

/** Translates one piece of rendered text, keeping the spaces around it */
export function translate(text: string): string {
  // Text that already contains Arabic has been translated: doing it again could repeat a word ("تحويل UPI")
  if (!dict || !/[A-Za-z]/.test(text) || /[؀-ۿ]/.test(text)) return text;
  const core = text.replace(/\s+/g, ' ').trim();
  const done = lookup(core) ?? (core.includes(' · ') ? joinParts(core) : null) ?? byWords(core);
  return done === null ? text : (text.match(/^\s*/)![0] + done + text.match(/\s*$/)![0]);
}

/** Short labels like "17 Oct", "Dine-in (15)" or "Sun: 10.0k": translated word by word, but only when
 *  every word is known — so a dish or customer name is never half-translated */
function byWords(s: string): string | null {
  const words = s.match(/[A-Za-z][A-Za-z'’-]+/g);
  if (!words || words.length > 3 || !words.every((w) => dict![w])) return null;
  return s.replace(/[A-Za-z][A-Za-z'’-]+/g, (w) => dict![w]!);
}

function lookup(s: string): string | null {
  if (dict![s]) return dict![s]!;
  const nums: string[] = [];
  const key = s.replace(NUM, (m) => `{${nums.push(m) - 1}}`);
  if (nums.length && dict![key]) return dict![key]!.replace(/\{(\d+)\}/g, (m, i) => nums[Number(i)] ?? m);
  // A fixed phrase around a name or code, e.g. "Edit Paneer Tikka" → "تعديل Paneer Tikka"
  const a = around.find((x) => s.length > x.pre.length + x.post.length && s.startsWith(x.pre) && s.endsWith(x.post));
  return a ? a.ar.replace('{0}', s.slice(a.pre.length, s.length - a.post.length)) : null;
}
/** "Dine-in · Table T4" → each part on its own; null when no part changed */
function joinParts(s: string): string | null {
  const parts = s.split(' · ').map((p) => lookup(p) ?? byWords(p) ?? p);
  return parts.join(' · ') === s ? null : parts.join(' · ');
}

const skipped = (el: Element | null) => !el || SKIP.has(el.tagName) || !!el.closest('[data-no-i18n]');

/** Translates every text and label under a node (also used on the printed bill before it prints) */
export function translateTree(root: Node) {
  if (!dict) return;
  if (root.nodeType === Node.TEXT_NODE) return translateNode(root as Text);
  if (!(root instanceof Element) && !(root instanceof Document) && !(root instanceof DocumentFragment)) return;
  const doc = root.ownerDocument || (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) translateNode(n as Text);
  const els = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [...(root as ParentNode).querySelectorAll('*')];
  for (const el of els) for (const a of ATTRS) translateAttr(el, a);
}
function translateNode(n: Text) {
  if (skipped(n.parentElement)) return;
  const v = translate(n.nodeValue || '');
  if (v !== n.nodeValue) n.nodeValue = v;
}
function translateAttr(el: Element, a: string) {
  const v = el.getAttribute(a);
  if (!v || skipped(el)) return;
  const tr = translate(v);
  if (tr !== v) el.setAttribute(a, tr);
}
function onMutations(list: MutationRecord[]) {
  for (const m of list) {
    if (m.type === 'childList') m.addedNodes.forEach(translateTree);
    else if (m.type === 'characterData') translateNode(m.target as Text);
    else if (m.attributeName) translateAttr(m.target as Element, m.attributeName);
  }
}
