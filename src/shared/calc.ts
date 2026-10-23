// Shared by the browser (live cart preview) and the server (authoritative totals).
export interface CalcLine {
  price: number;
  qty: number;
  tax_rate?: number | null;
  cancelled?: number | boolean | null;
}

export interface CalcOrder {
  type: string;
  discount_type?: string | null;
  discount_value?: number | null;
  discount?: number | null;
}

export interface CalcSettings {
  service_charge?: string;
  packaging_charge?: string;
  round_off?: string;
}

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  service_charge: number;
  packaging: number;
  round_off: number;
  total: number;
}

export const r2 = (n: number | string): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function computeTotals(items: CalcLine[], order: CalcOrder, settings: CalcSettings): Totals {
  const live = items.filter((i) => !i.cancelled);
  const subtotal = r2(live.reduce((s, i) => s + i.price * i.qty, 0));

  const dv = Number(order.discount_value) || 0;
  let discount = order.discount_type === 'percent' ? (subtotal * dv) / 100 : dv;
  discount = r2(Math.min(Math.max(discount, 0), subtotal));

  // Discount is spread proportionally before tax, as on a GST invoice
  const factor = subtotal ? (subtotal - discount) / subtotal : 0;
  const tax = r2(live.reduce((s, i) => s + (i.price * i.qty * factor * (Number(i.tax_rate) || 0)) / 100, 0));

  const service_charge =
    order.type === 'dine_in' ? r2(((subtotal - discount) * (Number(settings.service_charge) || 0)) / 100) : 0;
  const packaging = order.type !== 'dine_in' && live.length ? r2(Number(settings.packaging_charge) || 0) : 0;

  const raw = subtotal - discount + tax + service_charge + packaging;
  const total = settings.round_off === '0' ? r2(raw) : Math.round(raw);
  return { subtotal, discount, tax, service_charge, packaging, round_off: r2(total - raw), total: r2(total) };
}

export interface TaxLine {
  rate: number;
  taxable: number;
  half: number;
}

// Tax lines grouped by GST rate, split into CGST + SGST halves
export function taxBreakup(items: CalcLine[], order: CalcOrder): TaxLine[] {
  const live = items.filter((i) => !i.cancelled);
  const subtotal = live.reduce((s, i) => s + i.price * i.qty, 0);
  const factor = subtotal ? (subtotal - (Number(order.discount) || 0)) / subtotal : 0;
  const byRate: Record<number, number> = {};
  for (const i of live) {
    const rate = Number(i.tax_rate) || 0;
    if (!rate) continue;
    byRate[rate] = (byRate[rate] || 0) + i.price * i.qty * factor;
  }
  return Object.entries(byRate).map(([rate, taxable]) => ({
    rate: Number(rate),
    taxable: r2(taxable),
    half: r2((taxable * Number(rate)) / 200),
  }));
}
