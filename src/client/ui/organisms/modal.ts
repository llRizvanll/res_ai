// Organisms: dialogs — generic modal, confirm, prompt and declarative form modal.
import { $, $$, esc } from '../../core/dom.js';
import { type Field, fieldHTML, type FormValues, readForm, toast } from '../index.js';

export interface Modal {
  el: HTMLElement;
  close(): void;
  $<T extends Element = HTMLElement>(sel: string): T;
}

interface ModalOpts {
  title: string;
  body: string;
  footer?: string;
  size?: '' | 'sm' | 'lg' | 'xl';
  onClose?: () => void;
}

export function modal({ title, body, footer = '', size = '', onClose }: ModalOpts): Modal {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  const onKey = (e: KeyboardEvent) => {
    const top = $$('.modal-backdrop').pop();
    if (e.key === 'Escape' && top === wrap) close();
  };
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) close();
  });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  setTimeout(() => wrap.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea')?.focus(), 30);
  return { el: wrap, close, $: <T extends Element = HTMLElement>(s: string) => $<T>(s, wrap) };
}

export function confirmDialog(message: string, { okLabel = 'Confirm', danger = false } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      title: 'Please confirm',
      size: 'sm',
      body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`,
      onClose: () => resolve(ok),
    });
    m.$('[data-ok]').addEventListener('click', () => {
      ok = true;
      m.close();
    });
  });
}

export function promptDialog(title: string, labelText: string, { value = '', required = true, chips = [] as string[] } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = modal({
      title,
      size: 'sm',
      body: `<form id="pf"><div class="field"><label>${esc(labelText)}</label><input name="v" value="${esc(value)}" ${required ? 'required' : ''} autocomplete="off"></div>
        ${chips.length ? `<div class="chips">${chips.map((c) => `<button type="button" class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>OK</button>`,
      onClose: () => resolve(result),
    });
    const form = m.$<HTMLFormElement>('#pf');
    const input = m.$<HTMLInputElement>('input');
    $$('[data-chip]', m.el).forEach((c) =>
      c.addEventListener('click', () => {
        input.value = input.value ? `${input.value}, ${c.dataset.chip}` : c.dataset.chip!;
        input.focus();
      }),
    );
    const submit = (e?: Event) => {
      e?.preventDefault();
      if (!form.reportValidity()) return;
      result = input.value.trim();
      m.close();
    };
    form.addEventListener('submit', submit);
    m.$('[data-ok]').addEventListener('click', () => submit());
  });
}

interface FormModalOpts {
  title: string;
  fields: Field[];
  values?: object;
  submitLabel?: string;
  size?: ModalOpts['size'];
  intro?: string;
  onSubmit(values: FormValues, m: Modal): Promise<void> | void;
}

export function formModal({ title, fields, values = {}, submitLabel = 'Save', size = '', intro = '', onSubmit }: FormModalOpts): Modal {
  const m = modal({
    title,
    size,
    body: `${intro}<form class="form-grid" id="fm">${fields.map((f) => fieldHTML(f, (values as Record<string, unknown>)[f.name])).join('')}<button type="submit" hidden></button></form>`,
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-submit>${esc(submitLabel)}</button>`,
  });
  const form = m.$<HTMLFormElement>('#fm');
  const btn = m.$<HTMLButtonElement>('[data-submit]');
  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!form.reportValidity()) return;
    btn.disabled = true;
    try {
      await onSubmit(readForm(form, fields), m);
      m.close();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
  form.addEventListener('submit', submit);
  btn.addEventListener('click', () => submit());
  return m;
}
