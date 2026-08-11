// =============================================================================
// Tiny CLI flag parser — no new dependency. Supports `--flag value` and
// bare `--flag` (boolean). Good enough for this script's small, fixed flag
// set; not a general-purpose argv library.
// =============================================================================

export type ParsedArgs = Record<string, string | true>;

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function requireFlag(args: ParsedArgs, name: string, usage: string): never | void {
  if (!(name in args)) {
    // eslint-disable-next-line no-console
    console.error(`Missing required flag: --${name}\n\n${usage}`);
    process.exit(1);
  }
}
