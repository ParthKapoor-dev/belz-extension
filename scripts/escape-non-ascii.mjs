// Rewrites one bundled file in place, replacing every non-ASCII character with
// a \uXXXX escape, so extension loaders that reject non-ASCII scripts accept it.
//
// usage: node scripts/escape-non-ascii.mjs <file>   (relative to the current
// directory; scripts/build.mjs runs it from the repo root, once per output)
import fs from 'node:fs';
import path from 'node:path';

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('usage: node scripts/escape-non-ascii.mjs <file>');
  process.exit(1);
}
const filePath = path.resolve(process.cwd(), fileArg);

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const input = fs.readFileSync(filePath, 'utf8');

function escapeCodePoint(codePoint) {
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  }

  const adjusted = codePoint - 0x10000;
  const high = 0xd800 + (adjusted >> 10);
  const low = 0xdc00 + (adjusted & 0x3ff);
  return `\\u${high.toString(16).toUpperCase().padStart(4, '0')}\\u${low.toString(16).toUpperCase().padStart(4, '0')}`;
}

let output = '';
for (const char of input) {
  const codePoint = char.codePointAt(0);
  if (codePoint <= 0x7f) {
    output += char;
  } else {
    output += escapeCodePoint(codePoint);
  }
}

fs.writeFileSync(filePath, output, 'utf8');
