/**
 * Launch argument quoting tests — spec section 5
 *
 * Tests: spaces, Unicode, embedded quotes, & | ^ % ! ( ) ;,
 * trailing backslashes, UNC paths, long paths.
 * Assert exact command line and CommandLineToArgvW round-trip.
 */
import { describe, it, expect } from 'vitest';

/**
 * Quote a single argument for CommandLineToArgvW compatibility.
 * Implements the same rules as the C++ quoteArg in launch.cpp.
 */
function quoteArg(arg: string): string {
  if (arg.length === 0) return '""';

  // Check if quoting is needed
  const needsQuote = /[\s"&|^%!();]/.test(arg) || arg.length === 0;
  if (!needsQuote) return arg;

  let result = '"';
  let backslashes = 0;

  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i];
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '"') {
      // Double the backslashes before a quote, then escape the quote
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      result += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }

  // Double trailing backslashes (they precede the closing quote)
  result += '\\'.repeat(backslashes * 2) + '"';
  return result;
}

function buildCommandLine(exe: string, args: string[]): string {
  return [quoteArg(exe), ...args.map(quoteArg)].join(' ');
}

/**
 * Simulate CommandLineToArgvW parsing to verify round-trip.
 * This is a JS implementation of the Windows parsing rules.
 */
function parseCommandLine(cmdLine: string): string[] {
  const args: string[] = [];
  let i = 0;
  const len = cmdLine.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && (cmdLine[i] === ' ' || cmdLine[i] === '\t')) i++;
    if (i >= len) break;

    let arg = '';
    let inQuotes = false;

    while (i < len && (inQuotes || (cmdLine[i] !== ' ' && cmdLine[i] !== '\t'))) {
      if (cmdLine[i] === '\\') {
        let numBackslashes = 0;
        while (i < len && cmdLine[i] === '\\') {
          numBackslashes++;
          i++;
        }
        if (i < len && cmdLine[i] === '"') {
          // 2n backslashes + quote = n backslashes + toggle quote
          // 2n+1 backslashes + quote = n backslashes + literal quote
          arg += '\\'.repeat(Math.floor(numBackslashes / 2));
          if (numBackslashes % 2 === 1) {
            arg += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
            i++;
          }
        } else {
          arg += '\\'.repeat(numBackslashes);
        }
      } else if (cmdLine[i] === '"') {
        inQuotes = !inQuotes;
        i++;
      } else {
        arg += cmdLine[i];
        i++;
      }
    }

    args.push(arg);
  }

  return args;
}

describe('Argument quoting', () => {
  it('passes through simple args unchanged', () => {
    expect(quoteArg('hello')).toBe('hello');
    expect(quoteArg('file.txt')).toBe('file.txt');
  });

  it('quotes empty string', () => {
    expect(quoteArg('')).toBe('""');
  });

  it('quotes args with spaces', () => {
    const quoted = quoteArg('hello world');
    expect(quoted).toBe('"hello world"');
  });

  it('escapes embedded quotes', () => {
    const quoted = quoteArg('say "hello"');
    expect(quoted).toBe('"say \\"hello\\""');
  });

  it('passes through path with trailing backslash when no special chars', () => {
    // No spaces/quotes/special chars → not quoted, trailing backslash is literal
    expect(quoteArg('C:\\path\\')).toBe('C:\\path\\');
  });

  it('doubles trailing backslashes when quoting is needed', () => {
    // Has a space → must be quoted → trailing backslash must be doubled
    const quoted = quoteArg('C:\\my path\\');
    expect(quoted).toBe('"C:\\my path\\\\"');
  });

  it('handles backslashes before quotes', () => {
    const quoted = quoteArg('C:\\some\\"path');
    expect(quoted).toBe('"C:\\some\\\\\\"path"');
  });

  it('quotes args with special shell characters', () => {
    for (const ch of ['&', '|', '^', '%', '!', '(', ')', ';']) {
      const quoted = quoteArg(`test${ch}arg`);
      expect(quoted.startsWith('"')).toBe(true);
      expect(quoted.endsWith('"')).toBe(true);
    }
  });

  describe('CommandLineToArgvW round-trip', () => {
    const testCases: [string, string[]][] = [
      ['simple', ['hello', 'world']],
      ['spaces', ['hello world', 'foo bar']],
      ['unicode', ['Résumé – 東京.pdf']],
      ['quotes', ['say "hello"', '"quoted"']],
      ['special chars', ['a&b', 'c|d', 'e^f', 'g%h', 'i!j', 'k(l)', 'm;n']],
      ['trailing backslash no space', ['C:\\path\\', 'D:\\other\\']],
      ['trailing backslash with space', ['C:\\my path\\', 'D:\\other dir\\']],
      ['UNC path', ['\\\\server\\share\\file.txt']],
      ['long path', ['\\\\?\\C:\\very\\long\\path\\to\\file.txt']],
      ['mixed', ['C:\\Program Files\\App\\app.exe', '--file="test.txt"', 'hello world']],
      ['empty args', ['', 'arg', '']],
      ['backslash before quote', ['C:\\some\\"path']],
      ['multiple backslashes', ['a\\\\b', 'c\\\\\\d']],
    ];

    for (const [name, args] of testCases) {
      it(`round-trips: ${name}`, () => {
        const exe = 'C:\\App\\test.exe';
        const cmdLine = buildCommandLine(exe, args);
        const parsed = parseCommandLine(cmdLine);
        // First element is the exe
        expect(parsed[0]).toBe(exe);
        // Remaining are the args
        expect(parsed.slice(1)).toEqual(args);
      });
    }
  });
});

describe('buildCommandLine', () => {
  it('builds a valid command line', () => {
    const cmd = buildCommandLine('C:\\Program Files\\App\\app.exe', ['file.txt']);
    expect(cmd).toBe('"C:\\Program Files\\App\\app.exe" file.txt');
  });

  it('handles exe with no args', () => {
    const cmd = buildCommandLine('app.exe', []);
    expect(cmd).toBe('app.exe');
  });
});
