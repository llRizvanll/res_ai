// Landing page behaviour: theme toggle, mobile menu, scroll reveal, the feature-tour slideshow and lightbox.
// Plain script (no build step) because the page is static; kept external for the app's Content-Security-Policy.
(() => {
  // Old bookmarks like /#/pos belonged to the app, which now lives at /app/
  const toApp = () => {
    if (!location.hash.startsWith('#/')) return false;
    location.replace('/app/' + location.hash);
    return true;
  };
  if (toApp()) return;
  addEventListener('hashchange', toApp);
  const root = document.documentElement;
  root.classList.add('js');

  // ---- language: ?lang=ar|en, else the visitor's last choice, else the browser's language
  const LANG_KEY = 'home_lang';
  const LANGS = ['en', 'ar'];
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const savedLang = () => { try { return localStorage.getItem(LANG_KEY); } catch { return null; } };
  let lang = LANGS.includes(fromUrl) ? fromUrl : savedLang() || ((navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en');
  if (!LANGS.includes(lang)) lang = 'en';
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const dict = () => (lang === 'en' ? null : (window.I18N || {})[lang] || null);
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  /** Text in the current language; English text is the key */
  function t(en) {
    const d = dict();
    if (!d) return en;
    if (d[en]) return d[en];
    let m = /^(\d+) of (\d+): (.+)$/.exec(en);
    if (m) return `${m[1]} ${d.of || 'of'} ${m[2]}: ${t(m[3])}`;
    m = /^(.+) screen$/.exec(en);
    if (m && d.screen) return `${d.screen} ${t(m[1])}`;
    return en;
  }
  const KEY = 'home_theme';

  // ---- theme: remembered per browser, otherwise follows the system
  const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  function applyTheme(mode) {
    root.dataset.theme = mode;
    document.querySelectorAll('.theme-shot').forEach((img) => { img.src = img.dataset[mode]; });
  }
  applyTheme(saved() || (systemDark() ? 'dark' : 'light'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!saved()) applyTheme(systemDark() ? 'dark' : 'light'); });

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('theme-btn').addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* private mode: not remembered */ }
      applyTheme(next);
    });

    // ---- already signed in on this device: the buttons go straight back to work
    let signedIn = false;
    try { signedIn = !!localStorage.getItem('dineflow_token'); } catch { /* storage blocked */ }
    if (signedIn) document.querySelectorAll('[data-signin]').forEach((a) => { a.textContent = 'Open the app'; });

    // ---- translate the page: every text node and label, remembering the English to switch back
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'KBD', 'TIME']);
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const el = n.parentElement;
        if (!el || SKIP_TAGS.has(el.tagName) || el.closest('body [dir="ltr"], [data-i18n-skip]') || !/[A-Za-z]/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push({ n, en: n.nodeValue });
    const attrs = [];
    document.querySelectorAll('[alt], [aria-label], [title]').forEach((el) => {
      if (el.closest('[data-i18n-skip]')) return;
      for (const a of ['alt', 'aria-label', 'title']) if (el.getAttribute(a)) attrs.push({ el, a, en: el.getAttribute(a) });
    });
    const meta = document.querySelector('meta[name="description"]');
    const metaEn = meta.content;
    const titleEn = document.title;
    const langBtn = document.getElementById('lang-btn');
    function applyLang() {
      root.lang = lang;
      root.dir = lang === 'ar' ? 'rtl' : 'ltr';
      for (const x of texts) {
        const key = norm(x.en);
        const tr = t(key);
        // Keep the spaces around the text so it still sits right next to bold words and links
        x.n.nodeValue = tr === key ? x.en : x.en.match(/^\s*/)[0] + tr + x.en.match(/\s*$/)[0];
      }
      for (const x of attrs) x.el.setAttribute(x.a, t(norm(x.en)));
      meta.content = t(norm(metaEn));
      document.title = t(norm(titleEn));
      // The switch always offers the other language, written in that language
      langBtn.textContent = lang === 'ar' ? 'English' : 'عربي';
      langBtn.lang = lang === 'ar' ? 'en' : 'ar';
      langBtn.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
      document.dispatchEvent(new Event('home:lang'));
    }
    langBtn.addEventListener('click', () => {
      lang = lang === 'ar' ? 'en' : 'ar';
      try { localStorage.setItem(LANG_KEY, lang); } catch { /* not remembered */ }
      // Keep a shared ?lang= link in step with the choice, so reloading shows the same language
      const url = new URL(location.href);
      if (url.searchParams.has('lang')) {
        url.searchParams.set('lang', lang);
        history.replaceState(null, '', url);
      }
      applyLang();
    });
    applyLang();

    // ---- nav: border once scrolled, mobile menu
    const nav = document.querySelector('.nav');
    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const menuBtn = document.getElementById('menu-btn');
    const links = document.getElementById('nav-links');
    menuBtn.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    links.addEventListener('click', (e) => { if (e.target.closest('a')) { links.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); } });

    // ---- reveal on scroll
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
      : null;
    document.querySelectorAll('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

    // ---- feature tour: one screen per slide, auto-advancing until the visitor takes over
    const tourEl = document.getElementById('tour');
    const slides = [...tourEl.querySelectorAll('.slide')];
    const thumbs = [...tourEl.querySelectorAll('[data-go]')];
    const counter = document.getElementById('tour-n');
    const bar = document.getElementById('tour-progress');
    const playBtn = document.getElementById('tour-play');
    const SLIDE_MS = 6000;
    let cur = 0;
    let elapsed = 0;
    let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let hovered = false;
    let inView = false;
    function go(i, fromLeft = false) {
      const next = (i + slides.length) % slides.length;
      slides[cur].hidden = true;
      slides[cur].classList.remove('is-active', 'from-left');
      cur = next;
      slides[cur].hidden = false;
      slides[cur].classList.toggle('from-left', fromLeft);
      void slides[cur].offsetWidth; // restart the entrance animation
      slides[cur].classList.add('is-active');
      thumbs.forEach((t, k) => t.setAttribute('aria-selected', String(k === cur)));
      // Centre the chosen thumbnail (works in both reading directions)
      const strip = thumbs[cur].parentElement;
      const a = thumbs[cur].getBoundingClientRect();
      const b = strip.getBoundingClientRect();
      strip.scrollBy({ left: a.left + a.width / 2 - (b.left + b.width / 2), behavior: 'smooth' });
      counter.textContent = String(cur + 1);
      elapsed = 0;
      bar.style.width = '0';
    }
    function paintPlay() {
      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', t(playing ? 'Pause slideshow' : 'Play slideshow'));
    }
    paintPlay();
    document.addEventListener('home:lang', paintPlay);
    const rtl = () => root.dir === 'rtl';
    tourEl.querySelector('.tour-prev').addEventListener('click', () => go(cur - 1, true));
    tourEl.querySelector('.tour-next').addEventListener('click', () => go(cur + 1));
    thumbs.forEach((t) => t.addEventListener('click', () => go(Number(t.dataset.go), Number(t.dataset.go) < cur)));
    playBtn.addEventListener('click', () => { playing = !playing; paintPlay(); });
    tourEl.addEventListener('mouseenter', () => { hovered = true; });
    tourEl.addEventListener('mouseleave', () => { hovered = false; });
    tourEl.addEventListener('keydown', (e) => {
      // In Arabic the next slide is to the left
      const back = rtl() ? 'ArrowRight' : 'ArrowLeft';
      const fwd = rtl() ? 'ArrowLeft' : 'ArrowRight';
      if (e.key === back) { e.preventDefault(); go(cur - 1, true); }
      else if (e.key === fwd) { e.preventDefault(); go(cur + 1); }
    });
    // Swipe on phones and tablets
    let touchX = null;
    tourEl.querySelector('.tour-stage').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    tourEl.querySelector('.tour-stage').addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      const forward = rtl() ? dx > 0 : dx < 0;
      if (Math.abs(dx) > 40) go(forward ? cur + 1 : cur - 1, !forward);
    });
    if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { inView = en.isIntersecting; }, { threshold: 0.4 }).observe(tourEl);
    else inView = true;
    setInterval(() => {
      if (!playing || hovered || !inView || document.hidden || !document.getElementById('lightbox').hidden) return;
      elapsed += 100;
      bar.style.width = `${Math.min(100, (elapsed / SLIDE_MS) * 100)}%`;
      if (elapsed >= SLIDE_MS) go(cur + 1);
    }, 100);

    // ---- lightbox for every screenshot on the page
    const lb = document.getElementById('lightbox');
    const lbImg = lb.querySelector('img');
    const lbCap = lb.querySelector('figcaption');
    let list = [];
    let idx = 0;
    const captionOf = (el) => el.closest('.slide')?.querySelector('h3')?.textContent || el.querySelector('figcaption')?.textContent || el.querySelector('img')?.alt || '';
    function show(i) {
      idx = (i + list.length) % list.length;
      const el = list[idx];
      lbImg.src = el.dataset.full;
      lbImg.alt = captionOf(el);
      lbCap.textContent = captionOf(el);
    }
    function open(el) {
      // Browse within the tour's slides, or across the page's other screenshots and prints
      list = el.closest('#tour') ? [...tourEl.querySelectorAll('.slide-img')] : [...document.querySelectorAll('.shot[data-full], .paper[data-full]')];
      show(list.indexOf(el));
      lb.hidden = false;
      document.body.classList.add('lb-open');
      lb.querySelector('.lb-close').focus();
    }
    function close() {
      // Coming back from the viewer, the tour shows the screen last viewed
      if (list[0]?.closest('#tour') && idx !== cur) go(idx);
      lb.hidden = true;
      document.body.classList.remove('lb-open');
    }
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-full]');
      if (el) open(el);
    });
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.querySelector('.lb-prev').addEventListener('click', () => show(idx - 1));
    lb.querySelector('.lb-next').addEventListener('click', () => show(idx + 1));
    lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
    document.addEventListener('keydown', (e) => {
      if (lb.hidden) return;
      const back = root.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === 'Escape') close();
      else if (e.key === back) show(idx - 1);
      else if (e.key === (back === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft')) show(idx + 1);
    });
  });
})();
