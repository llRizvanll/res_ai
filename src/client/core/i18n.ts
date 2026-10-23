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
/** Entries that are fixed wording around names or other values: "Edit {0}", "{0} is your slowest day (≈{1})…" */
let templates: { re: RegExp; ar: string }[] = [];
const NAME_ACTIONS = new Set(['Edit', 'Select', 'Order', 'Delete', 'Remove', 'Received', 'by', 'since', 'Value']);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  templates = Object.keys(dict)
    .filter((k) => /\{\d\}/.test(k))
    // A one-word phrase ("{0} Veg") could clip a dish name like "Mix Veg": only longer wording or action words qualify
    .filter((k) => {
      const fixed = k.replace(/\{\d\}/g, ' ').trim().split(/\s+/);
      return fixed.length > 1 || NAME_ACTIONS.has(fixed[0]!);
    })
    .map((k) => ({ re: new RegExp(`^${k.split(/\{\d\}/).map(escapeRe).join('(.+?)')}$`), ar: dict![k]!, order: [...k.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1])) }))
    .map(({ re, ar, order }) => ({ re, ar: ar.replace(/\{(\d)\}/g, (_, i) => `{${order.indexOf(Number(i))}}`) }));
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
  // (amounts wrapped in direction marks, U+2066…U+2069, also mean it was done already)
  if (!dict || !/[A-Za-z]/.test(text) || /[\u0600-\u06FF\u2066-\u2069]/.test(text)) return text;
  const core = text.replace(/\s+/g, ' ').trim();
  const done = lookup(core) ?? (core.includes(' · ') ? joinParts(core) : null) ?? byWords(core);
  // An entry that reads the same in Arabic ("CGST {0} · SGST {1}") changes nothing — and must not, or it would repeat
  if (done === null || done.replace(/[\u2066-\u2069]/g, '') === core) return text;
  return text.match(/^\s*/)![0] + done + text.match(/\s*$/)![0];
}

/** Short labels like "17 Oct", "Dine-in (15)" or "Sun: 10.0k": translated word by word, but only when
 *  every word is known — so a dish or customer name is never half-translated */
function byWords(s: string): string | null {
  const words = s.match(/[A-Za-z][A-Za-z'’-]+/g);
  // Several words without a number are more likely a name ("Restaurant Owner") than a label
  if (!words || words.length > 3 || (words.length > 1 && !/\d/.test(s)) || !words.every((w) => dict![w])) return null;
  return s.replace(/[A-Za-z][A-Za-z'’-]+/g, (w) => dict![w]!);
}

function lookup(s: string): string | null {
  if (dict![s]) return dict![s]!;
  const nums: string[] = [];
  const key = s.replace(NUM, (m) => `{${nums.push(m) - 1}}`);
  if (nums.length && dict![key]) return dict![key]!.replace(/\{(\d+)\}/g, (m, i) => (nums[Number(i)] !== undefined ? ltr(nums[Number(i)]!) : m));
  // Fixed wording around names or values, e.g. "Edit Paneer Tikka" → "تعديل Paneer Tikka";
  // a value that is itself a known word (a weekday, "Oct 2026") is translated too
  for (const tpl of templates) {
    const m = tpl.re.exec(s);
    if (m) return tpl.ar.replace(/\{(\d)\}/g, (x, i) => (m[Number(i) + 1] !== undefined ? ltr(byWords(m[Number(i) + 1]!) ?? m[Number(i) + 1]!) : x));
  }
  return null;
}
/** Keeps an amount like ₹431.00 in reading order inside Arabic text (otherwise the ₹ drifts to the far side) */
const ltr = (v: string) => (/\d/.test(v) && !/[\u0600-\u06FF]/.test(v) ? `\u2066${v}\u2069` : v);

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
