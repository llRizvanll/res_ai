// Guards the layering described in ARCHITECTURE.md. If this fails, an import crossed a boundary it shouldn't.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', '..', 'src');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
}
/** Every relative import of a file, resolved to a path under src/ (e.g. "server/core/http") */
function importsOf(file: string): string[] {
  const code = fs.readFileSync(file, 'utf8');
  return [...code.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)].map((m) =>
    path.relative(SRC, path.resolve(path.dirname(file), m[1]!)).replace(/\.js$/, '').split(path.sep).join('/'),
  );
}
/** Size budgets that keep modules focused */
const MAX_LINES = 250;
const MAX_CSS_LINES = 150;
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

/** [layer prefix, prefixes it must never import] */
const RULES: [string, string[]][] = [
  ['shared/', ['server/', 'client/']],
  ['server/core/', ['server/routes/', 'server/services/']],
  ['server/db/', ['server/routes/', 'server/services/', 'server/core/http', 'server/core/dispatch']],
  ['server/services/', ['server/routes/']],
  ['client/core/', ['client/ui/', 'client/features/', 'client/views/', 'client/shell/']],
  ['client/ui/atoms/', ['client/ui/molecules/', 'client/ui/organisms/', 'client/features/', 'client/views/', 'client/shell/']],
  ['client/ui/molecules/', ['client/ui/organisms/', 'client/features/', 'client/views/', 'client/shell/']],
  ['client/ui/organisms/', ['client/features/', 'client/views/', 'client/shell/']],
  ['client/features/', ['client/views/', 'client/shell/']],
];

describe('Architecture boundaries', () => {
  const all = files(SRC).filter((f) => !rel(f).startsWith('tests/'));
  for (const [layer, banned] of RULES) {
    test(`${layer} stays independent of ${banned.join(', ')}`, () => {
      const bad = all
        .filter((f) => rel(f).startsWith(layer))
        .flatMap((f) => importsOf(f).filter((i) => banned.some((b) => i.startsWith(b))).map((i) => `${rel(f)} → ${i}`));
      assert.deepEqual(bad, []);
    });
  }
  test('server and client never import each other', () => {
    const bad = all.flatMap((f) => importsOf(f).filter((i) => (rel(f).startsWith('server/') && i.startsWith('client/')) || (rel(f).startsWith('client/') && i.startsWith('server/'))).map((i) => `${rel(f)} → ${i}`));
    assert.deepEqual(bad, []);
  });
  test('pages do not import other pages (shared code goes in core/ui/features)', () => {
    const bad = all
      .filter((f) => rel(f).startsWith('client/views/'))
      .flatMap((f) => {
        // A page split into a folder (views/<page>/…) may import its own files
        const m = /^client\/views\/([^/]+)\//.exec(rel(f));
        const own = m ? `client/views/${m[1]}/` : null;
        return importsOf(f).filter((i) => i.startsWith('client/views/') && !(own && i.startsWith(own))).map((i) => `${rel(f)} → ${i}`);
      });
    assert.deepEqual(bad, []);
  });
  test('routes do not import other route modules', () => {
    const bad = all.filter((f) => rel(f).startsWith('server/routes/') && !rel(f).endsWith('index.ts')).flatMap((f) => importsOf(f).filter((i) => i.startsWith('server/routes/')).map((i) => `${rel(f)} → ${i}`));
    assert.deepEqual(bad, []);
  });
  test(`no source file grows past ${MAX_LINES} lines (split by responsibility instead)`, () => {
    const big = all.map((f) => [rel(f), fs.readFileSync(f, 'utf8').split('\n').length] as const).filter(([, n]) => n > MAX_LINES);
    assert.deepEqual(big, []);
  });
  test(`no stylesheet grows past ${MAX_CSS_LINES} lines`, () => {
    const css = path.join(SRC, '..', 'public', 'css');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : []));
    const big = walk(css).map((f) => [path.relative(css, f), fs.readFileSync(f, 'utf8').split('\n').length] as const).filter(([, n]) => n > MAX_CSS_LINES);
    assert.deepEqual(big, []);
  });
  test('only config.ts reads environment variables', () => {
    const bad = all.filter((f) => rel(f) !== 'server/config.ts' && /process\.env\.[A-Z_]+/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    assert.deepEqual(bad, []);
  });
});
