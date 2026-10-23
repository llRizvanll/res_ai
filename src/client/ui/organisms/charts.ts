// Organisms: dependency-free charts (bars, horizontal bars, lines with ranges) as HTML/SVG strings.
import { compact, money0 } from '../../core/format.js';
import { esc } from '../../core/dom.js';

export interface BarDatum {
  label: string;
  value: number;
  tip?: string;
}

export function barChart(data: BarDatum[], { height = 200, fmt = (v: number) => compact(v) } = {}): string {
  if (!data.length || data.every((d) => !d.value)) return '<div class="empty">No data for this period</div>';
  const max = Math.max(...data.map((d) => d.value), 1);
  return `<div class="chart" style="height:${height}px">${data
    .map(
      (d) => `<div class="bar-col" title="${esc(d.tip || `${d.label}: ${fmt(d.value)}`)}">
        <div class="bar-val">${d.value ? esc(fmt(d.value)) : ''}</div>
        <div class="bar-track"><div class="bar" style="height:${((d.value / max) * 100).toFixed(1)}%"></div></div>
        <div class="bar-label">${esc(d.label)}</div></div>`,
    )
    .join('')}</div>`;
}

export function hbars(rows: { label: string; value: number }[], fmt: (n: number) => string = money0): string {
  if (!rows.length) return '<div class="empty">No data yet</div>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="hbars">${rows
    .map(
      (r) => `<div class="hbar"><div class="hbar-top"><span>${esc(r.label)}</span><b>${esc(fmt(r.value))}</b></div>
      <div class="hbar-track"><div style="width:${((r.value / max) * 100).toFixed(1)}%"></div></div></div>`,
    )
    .join('')}</div>`;
}

export interface LineSeries {
  name: string;
  color: string; // CSS colour or var(--token)
  values: (number | null)[];
  dashed?: boolean;
  /** Optional shaded range drawn behind the line (e.g. forecast low/high) */
  band?: { low: (number | null)[]; high: (number | null)[] };
}

export function lineChart(labels: string[], series: LineSeries[], { height = 240, fmt = (v: number) => compact(v), every = 0 } = {}): string {
  const all = series.flatMap((s) => [...s.values, ...(s.band?.high || [])]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!labels.length || !all.length) return '<div class="empty">No data for this period</div>';
  const W = 800;
  const H = height;
  const pad = { l: 52, r: 12, t: 12, b: 26 };
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (labels.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (labels.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);
  const step = every || Math.max(1, Math.ceil(labels.length / 10));
  const bands = series
    .filter((s) => s.band)
    .map((s) => {
      const idx = s.band!.high.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
      if (!idx.length) return '';
      const top = idx.map((i) => `${x(i).toFixed(1)},${y(s.band!.high[i]!).toFixed(1)}`).join(' ');
      const bottom = [...idx].reverse().map((i) => `${x(i).toFixed(1)},${y(s.band!.low[i] ?? 0).toFixed(1)}`).join(' ');
      return `<polygon points="${top} ${bottom}" style="fill:${s.color};opacity:.13"/>`;
    })
    .join('');
  const hits = labels
    .map((l, i) => {
      const tip = series.filter((s) => s.values[i] !== null && s.values[i] !== undefined).map((s) => `${s.name}: ${fmt(s.values[i]!)}`).join('\n');
      if (!tip) return '';
      const w = (W - pad.l - pad.r) / Math.max(1, labels.length - 1);
      return `<rect x="${(x(i) - w / 2).toFixed(1)}" y="${pad.t}" width="${w.toFixed(1)}" height="${H - pad.t - pad.b}" class="lc-hit"><title>${esc(l)}\n${esc(tip)}</title></rect>`;
    })
    .join('');
  return `<div class="line-chart">
    <div class="lc-legend">${series.map((s) => `<span><i style="background:${s.color}${s.dashed ? ';opacity:.6' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))} chart">
      ${grid.map((g) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="lc-grid"/><text x="${pad.l - 6}" y="${(y(g) + 4).toFixed(1)}" class="lc-y">${esc(fmt(g))}</text>`).join('')}
      ${min < 0 ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="lc-zero"/>` : ''}
      ${bands}
      ${series.map((s) => `<path d="${path(s.values)}" style="stroke:${s.color}" class="lc-line${s.dashed ? ' dashed' : ''}"/>`).join('')}
      ${labels.map((l, i) => (i % step === 0 || i === labels.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="lc-x">${esc(l)}</text>` : '')).join('')}
      ${hits}
    </svg></div>`;
}
