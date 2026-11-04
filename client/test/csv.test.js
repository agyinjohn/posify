import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/csv.js';

test('plain rows, header row, Windows and Unix line ends, blank lines dropped', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\r\n4,5,6\r\n\r\n'), [['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
  assert.deepEqual(parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']]); // old Mac
});

test('quoted cells keep commas, quotes and line breaks', () => {
  assert.deepEqual(parseCsv('name,note\n"Rice, 5kg","He said ""hi"""\n"two\nlines",x'), [['name', 'note'], ['Rice, 5kg', 'He said "hi"'], ['two\nlines', 'x']]);
});

test('BOM, semicolons and tabs (Excel in other locales)', () => {
  assert.deepEqual(parseCsv('﻿name;price\nRice;5,50'), [['name', 'price'], ['Rice', '5,50']]);
  assert.deepEqual(parseCsv('name\tprice\nRice\t5'), [['name', 'price'], ['Rice', '5']]);
});

test('cells are trimmed, empty cells kept in place, rows with only blanks dropped', () => {
  assert.deepEqual(parseCsv(' a , b ,, d \n,,,\n1,,3,'), [['a', 'b', '', 'd'], ['1', '', '3', '']]);
  assert.deepEqual(parseCsv(''), []);
});

test('toCsv escapes and round-trips', () => {
  const rows = [['name', 'note'], ['Rice, 5kg', 'say "hi"'], ['multi\nline', '']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
