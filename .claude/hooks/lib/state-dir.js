//
// Shared helper for Claude-side hook controllers: resolves the per-repo state
// directory used for Claude's own gate signatures/approvals, mirroring the
// pattern Gemini's controllers use for `~/.gemini/tmp/<repo>` but rooted under
// `~/.claude/` so the two integrations never contend for the same files.
//

import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export function getStateDir() {
  const homeDir = os.homedir();
  let repoName = '';
  try {
    const topLevel = execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    repoName = path.basename(topLevel);
  } catch {
    repoName = path.basename(process.cwd()) || 'generic-repo';
  }
  return path.resolve(homeDir, '.claude/tmp', repoName);
}
