import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Every server file must at least parse. Unit tests import only some modules, so a syntax error in the entry
// point (src/index.js) or a script would otherwise only show up when the server fails to start in production.
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
});

for (const file of files(new URL('../src', import.meta.url).pathname)) {
  test(`parses: ${file.split('/src/')[1]}`, () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }));
  });
}
