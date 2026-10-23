import type { Kot, Order } from './types/orders.js';
import type { Settings } from './types/app.js';
import { esc } from './dom.js';
import { fmtDateTime, label, ORDER_TYPE_LABELS, PAYMENT_MODE_LABELS } from './format.js';
import { taxBreakup } from '../../shared/calc.js';
import { isRtl, t } from './i18n.js';

const n2 = (n: number) => Number(n || 0).toFixed(2);

const RECEIPT_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; width: 74mm; margin: 0 auto; color: #000; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .c { text-align: center; } .r { text-align: end; } .b { font-weight: bold; } .s { font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } td, th { padding: 1px 0; vertical-align: top; } th { text-align: start; }
  /* Number columns: keep a gap so "1 | 260.00 | 260.00" never prints as "1260.00260.00" */
  td.r, th.r { padding-inline-start: 2.5mm; white-space: nowrap; }
  [dir='rtl'] body { font-family: 'Courier New', 'Geeza Pro', 'Noto Naskh Arabic', Tahoma, monospace; }
  .num { direction: ltr; unicode-bidi: isolate; }
  .big { font-size: 16px; } .kot td { font-size: 14px; padding: 3px 0; } .void { text-decoration: line-through; }
`;

function printHTML(title: string, body: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="${isRtl() ? 'ar' : 'en'}" dir="${isRtl() ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${RECEIPT_CSS}</style></head><body>${body}</body></html>`);
  doc.close();
  setTimeout(() => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 1500);
  }, 150);
}

export function printInvoice(o: Order, s: Settings) {
  const live = o.items.filter((i) => !i.cancelled);
  // Merge repeated lines (same item sent in several KOTs) for a cleaner bill
  const lines = new Map<string, { name: string; qty: number; price: number }>();
  for (const i of live) {
    const key = `${i.name}|${i.variant || ''}|${i.price}`;
    const name = i.variant ? `${i.name} (${i.variant})` : i.name;
    const cur = lines.get(key) || { name, qty: 0, price: i.price };
    cur.qty += i.qty;
    lines.set(key, cur);
  }
  const taxes = taxBreakup(live, o);
  const row = (l: string, v: string, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${v}</td></tr>`;
  const qtyTotal = [...lines.values()].reduce((a, l) => a + l.qty, 0);

  printHTML(
    o.order_no,
    `<div class="c">
      ${s.logo ? `<img src="${esc(s.logo)}" alt="" style="max-height:52px;max-width:52mm;filter:grayscale(1);margin-bottom:4px">` : ''}
      <h1>${esc(s.name)}</h1>
      ${s.tagline ? `<div class="s">${esc(s.tagline)}</div>` : ''}
      <div class="s">${esc(s.address)}</div>
      ${s.phone ? `<div class="s">${t('Ph:')} <span class="num">${esc(s.phone)}</span></div>` : ''}
      ${s.gstin ? `<div class="s">${t('GSTIN:')} ${esc(s.gstin)}</div>` : ''}
      ${s.fssai ? `<div class="s">${t('FSSAI:')} ${esc(s.fssai)}</div>` : ''}
    </div>
    <hr><div class="c b">${t(o.status === 'completed' ? 'TAX INVOICE' : 'BILL (UNPAID)')}</div><hr>
    <table class="s">
      ${row(`${t('Bill:')} <b>${esc(o.order_no)}</b>`, esc(fmtDateTime(o.closed_at || o.created_at)))}
      ${row(esc(t(label(ORDER_TYPE_LABELS, o.type))) + (o.table_name ? ` · ${t('Table')} <b>${esc(o.table_name)}</b>` : ''), o.guests ? t('Guests: {0}', o.guests) : '')}
      ${o.customer_name ? row(`${t('Customer:')} ${esc(o.customer_name)}`, `<span class="num">${esc(o.customer_phone)}</span>`) : ''}
      ${o.delivery_address ? `<tr><td colspan="2">${t('Deliver to:')} ${esc(o.delivery_address)}</td></tr>` : ''}
      ${o.created_by_name ? row(`${t('Served by:')} ${esc(o.created_by_name)}`, '') : ''}
    </table>
    <hr>
    <table>
      <tr><th>${t('Item')}</th><th class="r">${t('Qty')}</th><th class="r">${t('Rate')}</th><th class="r">${t('Amt')}</th></tr>
      ${[...lines.values()]
        .map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${l.qty}</td><td class="r">${n2(l.price)}</td><td class="r">${n2(l.price * l.qty)}</td></tr>`)
        .join('')}
    </table>
    <hr>
    <table>
      ${row(t('Sub Total ({0} items)', qtyTotal), n2(o.subtotal))}
      ${o.discount ? row(o.discount_type === 'percent' ? t('Discount ({0}%)', o.discount_value) : t('Discount'), '-' + n2(o.discount)) : ''}
      ${taxes.map((x) => row(t('CGST @{0}%', x.rate / 2), n2(x.half)) + row(t('SGST @{0}%', x.rate / 2), n2(x.half))).join('')}
      ${o.service_charge ? row(t('Service Charge ({0}%)', s.service_charge), n2(o.service_charge)) : ''}
      ${o.packaging ? row(t('Packaging Charge'), n2(o.packaging)) : ''}
      ${o.round_off ? row(t('Round Off'), n2(o.round_off)) : ''}
    </table>
    <hr>
    <table>${row(`<span class="big b">${t('Grand Total')}</span>`, `<span class="big b">${esc(s.currency || '₹')}${n2(o.total)}</span>`)}</table>
    <hr>
    ${o.payments?.length ? `<div class="s">${t('Paid:')} ${o.payments.map((p) => `${esc(t(label(PAYMENT_MODE_LABELS, p.mode)))} ${n2(p.amount)}`).join(isRtl() ? '، ' : ', ')}</div><hr>` : ''}
    <div class="c s">${esc(s.invoice_footer || t('Thank you!'))}</div>`,
  );
}

export function printKot(k: Kot, s: Settings) {
  printHTML(
    `KOT ${k.kot_no}`,
    `<div class="c"><div class="b">${esc(s.name)}</div><div class="big b">${t('KOT #{0}', k.kot_no)}</div></div><hr>
    <table class="s">
      <tr><td>${esc(t(label(ORDER_TYPE_LABELS, k.type)))}${k.table_name ? ` · <b class="big">${esc(k.table_name)}</b>` : ''}</td><td class="r">${esc(fmtDateTime(k.created_at))}</td></tr>
      <tr><td>${t('Order: {0}', esc(k.order_no))}</td><td class="r">${esc(k.created_by_name || '')}</td></tr>
    </table><hr>
    <table class="kot">
      ${k.items
        .map(
          (i) => `<tr class="${i.cancelled ? 'void' : ''}"><td class="b" style="width:14mm">${i.qty} x</td>
          <td><b>${esc(i.name)}</b>${i.variant ? ` (${esc(i.variant)})` : ''}${i.notes ? `<div class="s">» ${esc(i.notes)}</div>` : ''}</td></tr>`,
        )
        .join('')}
    </table>
    ${k.order_notes ? `<hr><div class="s">${t('Note:')} ${esc(k.order_notes)}</div>` : ''}<hr>`,
  );
}
