/**
 * Windows command-line argument quoting compatible with CommandLineToArgvW.
 *
 * Rules (from the MSDN CommandLineToArgvW documentation):
 *   - Arguments containing spaces, tabs, double-quotes, or that are empty
 *     must be wrapped in double quotes.
 *   - Inside a quoted argument:
 *       - A run of N backslashes followed by a double-quote produces
 *         N backslashes and ends the quoted region (or is an escaped quote
 *         if preceded by an odd number of backslashes).
 *       - A run of N backslashes NOT followed by a double-quote is literal.
 *   - To embed a literal double-quote: precede it with a backslash.
 *   - If the argument ends with backslashes and will be quoted, those
 *     trailing backslashes must be doubled (so they don't escape the
 *     closing quote).
 *
 * Special characters like & | ^ % ! ( ) ; are safe once quoted because the
 * Windows command processor (cmd.exe) treats the quoted region as a single
 * token.
 */

/**
 * Quote a single argument for use with CreateProcess / CommandLineToArgvW.
 */
export function quoteArg(arg: string): string {
  // If empty, must quote
  if (arg.length === 0) {
    return '""';
  }

  // Check if quoting is needed
  const needsQuoting = /[ \t"]/.test(arg) || /[&|^%!();]/.test(arg);
  if (!needsQuoting) {
    return arg;
  }

  // Build quoted string
  let result = '"';
  let i = 0;
  while (i < arg.length) {
    // Count consecutive backslashes
    let numBackslashes = 0;
    while (i < arg.length && arg[i] === '\\') {
      numBackslashes++;
      i++;
    }

    if (i === arg.length) {
      // Trailing backslashes: double them (they'd otherwise escape the closing quote)
      result += '\\'.repeat(numBackslashes * 2);
    } else if (arg[i] === '"') {
      // Backslashes before a quote: double them, then escape the quote
      result += '\\'.repeat(numBackslashes * 2 + 1);
      result += '"';
      i++;
    } else {
      // Backslashes not followed by a quote: literal
      result += '\\'.repeat(numBackslashes);
      result += arg[i];
      i++;
    }
  }

  result += '"';
  return result;
}

/**
 * Build a complete command line string from an executable path and argument list.
 *
 * The exe is quoted using the same rules; arguments follow separated by spaces.
 */
export function buildCommandLine(exe: string, args: string[]): string {
  const parts = [quoteArg(exe), ...args.map(quoteArg)];
  return parts.join(' ');
}
