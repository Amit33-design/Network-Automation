/**
 * Comment handling shared by every consumer that reads generated config text
 * (validator, facts, tests). One definition, so "what counts as a comment"
 * cannot drift between the checks that must agree on it (Z6).
 */

/** A documentation line in any generated dialect: IOS/NX-OS/EOS `!`,
 *  Junos/NVUE/Linux `#`, and `//`. */
export function isCommentLine(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('!') || t.startsWith('#') || t.startsWith('//')
}

/** The config with every comment line removed — the text checks may read. */
export function stripComments(cfg: string): string {
  return cfg.split('\n').filter(l => !isCommentLine(l)).join('\n')
}
