#!/usr/bin/env node
// Minimal, readable CLI flag parser (ESM)

export function parseFlags(argv = process.argv.slice(2)) {
  const result = { positional: [] }; // positional args stored in _

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    // Long form: --name or --name=value
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        const key = token.slice(2, eq);
        const val = token.slice(eq + 1);
        assign(result, key, coerce(val));
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !isFlag(next)) {
          assign(result, key, coerce(next));
          i++; // consumed next
        } else {
          assign(result, key, true);
        }
      }
      i++;
      continue;
    }

    // Short form: -a or -abc or -k value
    if (token.startsWith('-') && token.length > 1) {
      const shorts = token.slice(1).split('');
      if (shorts.length === 1) {
        const key = shorts[0];
        const next = argv[i + 1];
        if (next !== undefined && !isFlag(next)) {
          assign(result, key, coerce(next));
          i += 2;
          continue;
        } else {
          assign(result, key, true);
          i++;
          continue;
        }
      }

      // Combined shorts like -abc => -a -b -c (all booleans)
      for (const k of shorts) assign(result, k, true);
      i++;
      continue;
    }

    // Positional argument
    result.positional.push(coerce(token));
    i++;
  }

  return result;
}

function isFlag(s) {
  return typeof s === 'string' && s.startsWith('-');
}

function assign(obj, key, value) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
    obj[key].push(value);
  } else {
    obj[key] = value;
  }
}

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

// When run directly with node (node --input-type=module or as a file), show example
if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const flags = parseflags();
  if (flags.h || flags.help) {
    console.log(`Usage: node ${require('path').basename(process.argv[1])} [options] [args]

Options:
  -h, --help        show this help
  -v, --version     show version (example)
  -k VALUE, --key VALUE   example flag with value

Examples:
  node ${require('path').basename(process.argv[1])} -abc --name=alice file.txt
`);
    process.exit(0);
  }
  console.log(flags);
}
