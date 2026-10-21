import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isAbortError, runAgentSession } from './agent-runner.js';
import { stripDiffMetadata } from './git-release.js';
import { runQAPipeline } from './qa-runner.js';
import { exists, getRepoRoot, loadWorkspaceSkillsContext, parseJSONFromText } from './utils.js';

const execFileAsync = promisify(execFile);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.bmp',
  '.tiff',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.bin',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
  '.jar',
  '.wasm',
  '.iso',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.pyc',
  '.pyo',
  '.pyd',
  '.o',
  '.obj',
  '.a',
  '.lib',
  '.out',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.woff',
  '.woff2',
  '.ttf',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.mp3',
  '.wav',
  '.pack',
  '.idx',
]);

/**
 * Git empty tree hash (SHA-1 hash of an empty tree object).
 */
export const GIT_EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Captures repository state from git and workspace artifacts.
 *
 * Architectural Note on Skills-First Mandate:
 * While mutating operations (such as staging via `stage-files.js`) strictly invoke skill scripts,
 * `captureGitState` executes read-only git status and diff commands directly via `runner` because:
 * 1. Rapid Loop Performance: Eliminates the overhead of repeatedly spawning Node.js runtime instances
 *    to execute CLI wrappers during tight inner-loop iterations.
 * 2. Dependency Injection & Testability: Accepts a pluggable `execFn` runner enabling hermetic unit testing
 *    without spawning physical processes or touching the real filesystem.
 * 3. Low-Level Control: Directly passes necessary low-level flags (`core.quotepath=false`, `--no-ext-diff`,
 *    `--no-color`, `maxBuffer`) and handles unborn HEAD fallback chains (`GIT_EMPTY_TREE_HASH`).
 *
 * @param {Object} [options]
 * @param {string} [options.repoRoot] - Root directory of the repository
 * @param {string} [options.planPath] - Path to the active plan file
 * @param {boolean} [options.stageBeforeIteration=true] - Whether to stage all changes before reading diff
 * @param {Function} [options.execFn] - Custom child_process exec function for testing
 * @param {number} [options.maxFileSizeBytes=51200] - Maximum file size in bytes for a single file to include in context
 * @param {number} [options.maxTotalContextBytes=512000] - Maximum total bytes across all modified files to include in context
 * @returns {Promise<{status: string, diff: string, diffHash: string, plan: string, changedFiles: string[], modifiedFilesContext: string}>}
 */
export async function captureGitState({
  repoRoot = null,
  planPath = null,
  stageBeforeIteration = true,
  execFn = null,
  maxFileSizeBytes = 50 * 1024,
  maxTotalContextBytes = 500 * 1024,
} = {}) {
  const root = repoRoot || (await getRepoRoot());
  const runner = execFn || execFileAsync;

  if (stageBeforeIteration) {
    try {
      const stageScript = path.join(root, '.gemini/skills/git/scripts/stage-files.js');
      await runner('node', [stageScript, '--all', '--include-untracked'], {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err) {
      console.debug(`[DEBUG] Staging changes before capture encountered error: ${err.message}`);
    }
  }

  // 1. Get git porcelain status
  let status;
  try {
    const { stdout } = await runner('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--no-color'], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    status = stdout;
  } catch (err) {
    console.debug(`[DEBUG] Failed to get git status: ${err.message}`);
    status = '';
  }

  // 2. Get git diff
  let diff;
  try {
    const { stdout } = await runner(
      'git',
      ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', 'HEAD'],
      {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    diff = stdout;
  } catch {
    // If HEAD is unborn or error occurs, fallback to diff against the index (--cached)
    try {
      const { stdout } = await runner(
        'git',
        ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--cached'],
        {
          cwd: root,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      diff = stdout;
    } catch {
      // Further fallback: compare staged index against empty tree hash
      try {
        console.debug(`[DEBUG] Comparing staged index against empty tree hash (${GIT_EMPTY_TREE_HASH}) as fallback.`);
        const { stdout } = await runner(
          'git',
          ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--cached', GIT_EMPTY_TREE_HASH],
          {
            cwd: root,
            maxBuffer: 10 * 1024 * 1024,
          },
        );
        diff = stdout;
      } catch (err) {
        console.debug(`[DEBUG] All git diff strategies failed (${err.message}). Falling back to empty diff string.`);
        diff = '';
      }
    }
  }

  const sanitizedDiff = stripDiffMetadata(diff);
  const diffHash = crypto
    .createHash('sha256')
    .update(sanitizedDiff || '')
    .digest('hex');

  // 3. Read active plan file if present
  let plan = '';
  const resolvedPlanPath = planPath || path.join(root, 'plans/current.md');
  if (await exists(resolvedPlanPath)) {
    try {
      plan = await fs.readFile(resolvedPlanPath, 'utf8');
    } catch (err) {
      console.debug(`[DEBUG] Could not read plan file ${resolvedPlanPath}: ${err.message}`);
      plan = '';
    }
  }

  // 4. Retrieve modified file paths
  let changedFiles;
  try {
    const { stdout } = await runner(
      'git',
      ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--name-only', 'HEAD'],
      {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    changedFiles = stdout
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    // If HEAD is unborn, fallback to --cached to list staged files
    try {
      const { stdout } = await runner(
        'git',
        ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--name-only', '--cached'],
        {
          cwd: root,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      changedFiles = stdout
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      // Further fallback: compare staged index against empty tree hash
      try {
        const { stdout } = await runner(
          'git',
          [
            '-c',
            'core.quotepath=false',
            'diff',
            '--no-ext-diff',
            '--no-color',
            '--name-only',
            '--cached',
            GIT_EMPTY_TREE_HASH,
          ],
          {
            cwd: root,
            maxBuffer: 10 * 1024 * 1024,
          },
        );
        changedFiles = stdout
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean);
      } catch {
        changedFiles = [];
      }
    }
  }

  // 5. Read contents of modified files for contextual visibility (capped to prevent token blowup)
  let totalContextBytes = 0;
  const fileBlocks = [];
  const maxOmittedPlaceholders = 50;
  let omittedPlaceholderCount = 0;
  let remainingOmittedCount = 0;

  const addOmittedPlaceholder = (relPath, reasonText) => {
    if (omittedPlaceholderCount < maxOmittedPlaceholders) {
      fileBlocks.push(`\n<file path="${relPath}">\n${reasonText}\n</file>\n`);
      omittedPlaceholderCount++;
      return true;
    }
    remainingOmittedCount++;
    return false;
  };

  const fileEntries = await Promise.all(
    changedFiles.map(async (relPath) => {
      if (relPath.startsWith('.git/') || relPath === '.git' || relPath.startsWith(`.git${path.sep}`)) {
        console.debug(`[DEBUG] Skipping internal git path: ${relPath}`);
        return null;
      }
      const fullPath = path.join(root, relPath);
      if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
        console.debug(`[DEBUG] Skipping path escaping repository root: ${relPath}`);
        return null;
      }
      const fileStats = await fs.lstat(fullPath).catch((err) => {
        if (err.code !== 'ENOENT') {
          console.debug(`[DEBUG] Could not lstat path ${relPath}: ${err.message}`);
        }
        return null;
      });
      if (!fileStats) {
        return null;
      }
      if (fileStats.isSymbolicLink()) {
        try {
          const resolvedPath = await fs.realpath(fullPath);
          if (!resolvedPath.startsWith(root + path.sep) && resolvedPath !== root) {
            console.debug(`[DEBUG] Skipping symlink resolving outside repository root: ${relPath} -> ${resolvedPath}`);
            return null;
          }
          const targetStats = await fs.stat(resolvedPath).catch(() => null);
          if (targetStats && targetStats.isFile()) {
            return { relPath, fullPath: resolvedPath, stats: targetStats };
          }
        } catch (err) {
          console.debug(`[DEBUG] Could not resolve symlink ${relPath}: ${err.message}`);
          return null;
        }
        return null;
      }
      if (fileStats.isFile()) {
        return { relPath, fullPath, stats: fileStats };
      }
      return null;
    }),
  );

  for (let i = 0; i < fileEntries.length; i++) {
    const entry = fileEntries[i];
    if (!entry) {
      continue;
    }
    const { relPath, fullPath, stats } = entry;
    try {
      if (totalContextBytes >= maxTotalContextBytes) {
        if (omittedPlaceholderCount < maxOmittedPlaceholders) {
          addOmittedPlaceholder(
            relPath,
            `[File content omitted: total modified context limit (${maxTotalContextBytes} bytes) reached]`,
          );
        } else {
          const remainingCount = fileEntries.length - i;
          fileBlocks.push(
            `\n[... and ${remainingCount} additional modified file(s) omitted due to total context limit]\n`,
          );
          break;
        }
        continue;
      }

      if (stats.size > maxFileSizeBytes) {
        addOmittedPlaceholder(
          relPath,
          `[File content omitted: size (${stats.size} bytes) exceeds limit of ${maxFileSizeBytes} bytes]`,
        );
        continue;
      }

      const ext = path.extname(relPath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        addOmittedPlaceholder(relPath, `[File content omitted: binary file (${ext})]`);
        continue;
      }

      // Check for null bytes (0x00) within the first 8000 bytes using open/read to detect binary content without buffering entire file
      let fileHandle = null;
      let isBinary = false;
      const checkBuffer = Buffer.alloc(Math.min(8000, stats.size));
      try {
        fileHandle = await fs.open(fullPath, 'r');
        const { bytesRead } = await fileHandle.read(checkBuffer, 0, checkBuffer.length, 0);
        if (checkBuffer.subarray(0, bytesRead).includes(0x00)) {
          isBinary = true;
        }
      } finally {
        if (fileHandle) {
          await fileHandle.close().catch(() => {});
        }
      }

      if (isBinary) {
        const extDesc = ext || 'no extension';
        addOmittedPlaceholder(
          relPath,
          `[File content omitted: binary file detected (${extDesc}, ${stats.size} bytes)]`,
        );
        continue;
      }

      const buffer = await fs.readFile(fullPath);

      if (totalContextBytes + buffer.length > maxTotalContextBytes) {
        if (omittedPlaceholderCount < maxOmittedPlaceholders) {
          addOmittedPlaceholder(
            relPath,
            `[File content omitted: total modified context limit (${maxTotalContextBytes} bytes) exceeded]`,
          );
        } else {
          const remainingCount = fileEntries.length - i;
          fileBlocks.push(
            `\n[... and ${remainingCount} additional modified file(s) omitted due to total context limit]\n`,
          );
          totalContextBytes = maxTotalContextBytes;
          break;
        }
        totalContextBytes = maxTotalContextBytes;
        continue;
      }

      totalContextBytes += buffer.length;
      const content = buffer.toString('utf8');
      fileBlocks.push(`\n<file path="${relPath}">\n${content}\n</file>\n`);
    } catch (err) {
      console.debug(`[DEBUG] Could not read modified file ${relPath}: ${err.message}`);
    }
  }

  if (remainingOmittedCount > 0) {
    fileBlocks.push(
      `\n[... and ${remainingOmittedCount} additional omitted file placeholder(s) omitted due to placeholder limit (${maxOmittedPlaceholders})]\n`,
    );
  }

  const modifiedFilesContext = fileBlocks.join('');

  return {
    status,
    diff,
    diffHash,
    plan,
    changedFiles,
    modifiedFilesContext: modifiedFilesContext.trim(),
  };
}

/**
 * Detects whether repository or plan state has changed between two snapshots.
 *
 * @param {Object} before - State snapshot before agent execution
 * @param {Object} after - State snapshot after agent execution
 * @returns {{hasChanged: boolean, diffChanged: boolean, statusChanged: boolean, planChanged: boolean}}
 */
export function detectGitStateChange(before, after) {
  if (!before || !after) {
    return { hasChanged: true, diffChanged: true, statusChanged: true, planChanged: true };
  }
  const diffChanged = before.diffHash !== after.diffHash;
  const statusChanged = (before.status || '').trimEnd() !== (after.status || '').trimEnd();
  const planChanged = (before.plan || '') !== (after.plan || '');
  const hasChanged = diffChanged || statusChanged || planChanged;
  return {
    hasChanged,
    diffChanged,
    statusChanged,
    planChanged,
  };
}

/**
 * Formats validation commands into a grammatically clean description string.
 *
 * @param {Array<string>|string} [validationCommands]
 * @returns {string} Formatted validation commands string
 */
export function formatValidationCommands(validationCommands) {
  if (Array.isArray(validationCommands) && validationCommands.length > 0) {
    const quoted = validationCommands.map((c) => `'${c}'`);
    if (quoted.length === 1) {
      return quoted[0];
    }
    if (quoted.length === 2) {
      return `${quoted[0]} and ${quoted[1]}`;
    }
    return `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
  }
  if (typeof validationCommands === 'string' && validationCommands.trim().length > 0) {
    return validationCommands.trim();
  }
  return '';
}

/**
 * Builds the default review prompt with negative feedback injection from previous validation failures.
 *
 * @param {Object} context
 * @param {number} context.iteration - Current iteration number (1-based)
 * @param {number} context.maxIterations - Total allowable iterations
 * @param {Object} context.stateBefore - State snapshot captured before agent run
 * @param {Object|null} [context.lastValidation] - Previous iteration validation result
 * @param {string} [context.activePlan] - Active plan text
 * @returns {string} Formatted review prompt
 */
export function buildReviewPrompt({
  iteration,
  maxIterations,
  stateBefore,
  lastValidation = null,
  activePlan = '',
  validationCommands = ['bash .github/workflows/scripts/lint.sh all', 'go test ./...'],
  skillsContext = '',
} = {}) {
  const diff = stateBefore?.diff || '';
  const modifiedFiles = stateBefore?.modifiedFilesContext || '';
  const plan = activePlan || stateBefore?.plan || '';
  const validationCmdsText = formatValidationCommands(validationCommands);
  const validationClause = validationCmdsText
    ? `- Ensure all tests and linters pass cleanly (e.g., ${validationCmdsText}).`
    : `- Ensure all tests and linters pass cleanly.`;

  let validationBlock = '';
  if (lastValidation && !lastValidation.success) {
    if (lastValidation.isSessionError || lastValidation.sessionError) {
      validationBlock = `
⚠️ AGENT SESSION ERROR FEEDBACK:
An unexpected execution or infrastructure error occurred during the previous session:

<session_error>
${lastValidation.sessionError || lastValidation.stderr || lastValidation.error}
</session_error>
`;
    } else {
      validationBlock = `
⚠️ CRITICAL VALIDATION FEEDBACK (Negative Backpressure):
The deterministic automated checks (tests / linters) failed in the previous iteration.
You MUST resolve and fix the following failures before making any other changes:

<validation_failure>
STDOUT:
${lastValidation.stdout || '(no stdout)'}

STDERR / ERRORS:
${lastValidation.stderr || lastValidation.error || '(no stderr)'}
</validation_failure>
`;
    }
  } else if (lastValidation && lastValidation.success) {
    validationBlock = `
<validation_status>
🟢 All workspace tests and linters passed cleanly in the previous iteration.
</validation_status>
`;
  }

  return `Review iteration ${iteration}/${maxIterations}.

Please review the staged code and the current plan (in plans/current.md), then implement any suggestions or fixes you have that are within the scope of the plan.

On your first turn, call update_topic with a descriptive "title" and "summary" (e.g. title: "Ralph Review Loop - Iteration ${iteration}", summary: "Review staged code and active plan, implement surgical improvements, and verify tests/linters").
${validationBlock}
Instructions & Constraints:
- Do NOT enter plan mode (do not call enter_plan_mode).
- Do NOT invoke subagents (do not call invoke_agent).
- Do NOT commit changes to git.
- Comply with the Skills-First Mandate: use installed skills in .gemini/skills/ (such as 'node .gemini/skills/git/scripts/read-ignored-file.js plans/current.md') for repository operations instead of raw mutating commands.
- The active plan is embedded below in <active_plan>.
- Please add any decisions you make to the plan (in plans/current.md) so that further review cycles are refining the vision rather than overwriting it.
${validationClause}
- If you don't have any suggestions and all tests pass cleanly, please state that the code looks good and make no file modifications.
${skillsContext ? `\n${skillsContext}\n` : ''}
<active_plan>
${plan}
</active_plan>

<git_diff>
${diff}
</git_diff>

<modified_files>
${modifiedFiles}
</modified_files>`;
}

/**
 * Builds the prompt for the thinking review agent (Pro model).
 * Instructs the agent to strictly review staged code, rate each suggestion (critical/medium/minor),
 * and always output at least 5 suggestions without modifying any files.
 *
 * @param {Object} context
 * @returns {string} Formatted reviewer prompt
 */
export function buildReviewerPrompt({
  iteration = 1,
  maxIterations = 15,
  stateBefore = {},
  lastValidation = null,
  activePlan = '',
  skillsContext = '',
} = {}) {
  const diff = stateBefore?.diff || '';
  const modifiedFiles = stateBefore?.modifiedFilesContext || '';
  const plan = activePlan || stateBefore?.plan || '';

  let validationBlock = '';
  if (lastValidation && !lastValidation.success) {
    if (lastValidation.isSessionError || lastValidation.sessionError) {
      validationBlock = `
⚠️ PREVIOUS SESSION ERROR:
An unexpected infrastructure or runtime error occurred during the previous iteration:

<session_error>
${lastValidation.sessionError || lastValidation.stderr || lastValidation.error}
</session_error>
`;
    } else {
      validationBlock = `
⚠️ PREVIOUS VALIDATION FAILURE (Deterministic Backpressure):
Workspace tests or linters failed in the previous iteration:

<validation_failure>
STDOUT:
${lastValidation.stdout || '(no stdout)'}

STDERR / ERRORS:
${lastValidation.stderr || lastValidation.error || '(no stderr)'}
</validation_failure>
Prioritize suggestions that directly address and resolve these failures.
`;
    }
  }

  return `Review iteration ${iteration}/${maxIterations}.

You are a senior technical reviewer. Review the staged code against the approved plan (in plans/current.md).
Your task is ONLY to review the code and output a list of actionable suggestions within the scope of the plan.
${validationBlock}
Instructions & Strict Constraints:
1. Your output must ONLY be a numbered list of suggestions.
2. Every suggestion MUST be explicitly categorized with a severity rating of either "critical", "medium", or "minor". Do NOT add markdown formatting (such as asterisks or bolding, e.g. **[critical]** or [**critical**]) around or inside the severity tags or brackets.
3. You must ALWAYS come up with at least 5 suggestions.
4. Do NOT make file modifications, call mutating tools, or commit code. You may use grep_search to inspect files and verify code patterns.
5. Consider the repository's installed skills (in .gemini/skills/) and the Skills-First Mandate when reviewing code and proposing suggestions.

Format each suggestion clearly as:
<number>. [<severity>] <Summary>: <Detailed suggestion and rationale>

Example format:
1. [critical] Fix resource leak: Ensure stream is closed in finally block...
2. [medium] Improve error handling: Add specific error typing...
3. [minor] Variable naming: Rename tmpVar to descriptive identifier...
${skillsContext ? `\n${skillsContext}\n` : ''}
<active_plan>
${plan}
</active_plan>

<git_diff>
${diff}
</git_diff>

<modified_files>
${modifiedFiles}
</modified_files>`;
}

/**
 * Builds the counting prompt for the flash-lite model to parse suggestion severity counts.
 *
 * @param {string} suggestionsText - Raw suggestions text from the reviewer agent
 * @returns {string} Formatted tally prompt
 */
export function buildTallyPrompt(suggestionsText = '') {
  return `You are a strict text analysis and counting model.
Read the following list of review suggestions and count the number of suggestions rated as "critical", "medium", and "minor".

Output ONLY a raw JSON object (no markdown code blocks, backticks, or other text):
{
  "critical": <integer>,
  "medium": <integer>,
  "minor": <integer>
}

Review Suggestions to evaluate:
${suggestionsText}`;
}

/**
 * Builds the implementation prompt for the Flash model to apply approved suggestions.
 *
 * @param {Object} context
 * @returns {string} Formatted implementation prompt
 */
export function buildImplementationPrompt({
  suggestionsText = '',
  tally = { critical: 0, medium: 0, minor: 0 },
  activePlan = '',
  stateBefore = {},
  lastValidation = null,
  iteration = 1,
  maxIterations = 15,
  validationCommands = ['bash .github/workflows/scripts/lint.sh all', 'go test ./...'],
  skillsContext = '',
} = {}) {
  const diff = stateBefore?.diff || '';
  const modifiedFiles = stateBefore?.modifiedFilesContext || '';
  const plan = activePlan || stateBefore?.plan || '';
  const validationCmdsText = formatValidationCommands(validationCommands);
  const validationClause = validationCmdsText
    ? `- Ensure all tests and linters pass cleanly (e.g., ${validationCmdsText}).`
    : `- Ensure all tests and linters pass cleanly.`;

  let validationBlock = '';
  if (lastValidation && !lastValidation.success) {
    if (lastValidation.isSessionError || lastValidation.sessionError) {
      validationBlock = `
⚠️ PREVIOUS SESSION ERROR:
An unexpected infrastructure or runtime error occurred during the previous iteration:

<session_error>
${lastValidation.sessionError || lastValidation.stderr || lastValidation.error}
</session_error>
`;
    } else {
      validationBlock = `
⚠️ PREVIOUS VALIDATION FAILURE (Deterministic Backpressure):
The automated workspace checks failed in the previous iteration:

<validation_failure>
STDOUT:
${lastValidation.stdout || '(no stdout)'}

STDERR / ERRORS:
${lastValidation.stderr || lastValidation.error || '(no stderr)'}
</validation_failure>
You must resolve these failures while implementing the suggestions.
`;
    }
  }

  return `Review iteration ${iteration}/${maxIterations}.

The thinking review agent identified the following suggestions (${tally.critical} critical, ${tally.medium} medium, ${tally.minor} minor):

<suggestions>
${suggestionsText}
</suggestions>
${validationBlock}
Instructions & Constraints:
- On your first turn, call update_topic with a descriptive "title" and "summary" (e.g. title: "Implement Review Suggestions - Iteration ${iteration}", summary: "Implement critical and medium suggestions from review, update plan, and verify tests/linters").
- Since there are critical and/or medium suggestions, you must implement ALL suggestions that are within scope of the plan.
- You have access to GrepSearch (and grep_search) to search across workspace file contents.
- Do NOT enter plan mode (do not call enter_plan_mode).
- Do NOT invoke subagents (do not call invoke_agent).
- Comply strictly with the Skills-First Mandate: use installed skills in .gemini/skills/ (such as 'node .gemini/skills/git/scripts/read-ignored-file.js plans/current.md') for repository operations instead of raw mutating commands.
- Update the plan in 'plans/current.md' with any decisions made so further review cycles build on them.
- Do NOT commit changes to git.
${validationClause}
${skillsContext ? `\n${skillsContext}\n` : ''}
<active_plan>
${plan}
</active_plan>

<git_diff>
${diff}
</git_diff>

<modified_files>
${modifiedFiles}
</modified_files>`;
}

/**
 * Parses counts of "critical", "medium", and "minor" suggestions from model output or raw text.
 *
 * @param {string} [primaryText=''] - Output from flash-lite model or JSON string
 * @param {string} [fallbackText=''] - Raw reviewer text used as fallback
 * @param {Function|null} [logger=null] - Optional logger function for debug messages (defaults to no-op)
 * @returns {{critical: number, medium: number, minor: number, total: number}}
 */
export function parseSuggestionCounts(primaryText = '', fallbackText = '', logger = null) {
  const logDebug = typeof logger === 'function' ? logger : () => {};
  const candidates = [primaryText, fallbackText].filter(Boolean);

  for (const text of candidates) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      continue;
    }

    // 1. Try parsing JSON block or object via parseJSONFromText
    try {
      const rawParsed = parseJSONFromText(text, null);
      if (rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed)) {
        // Normalize keys to lower-case to defend against model casing variations
        const parsed = Object.fromEntries(
          Object.entries(rawParsed).map(([key, val]) => [key.toLowerCase().trim(), val]),
        );
        if (parsed.critical !== undefined || parsed.medium !== undefined || parsed.minor !== undefined) {
          const critical = Math.max(0, parseInt(parsed.critical, 10) || 0);
          const medium = Math.max(0, parseInt(parsed.medium, 10) || 0);
          const minor = Math.max(0, parseInt(parsed.minor, 10) || 0);
          const total = critical + medium + minor;
          if (total >= 0) {
            return {
              critical,
              medium,
              minor,
              total,
            };
          }
        }
      } else if (rawParsed === null) {
        logDebug(
          `[DEBUG] parseJSONFromText returned null for suggestions count text: "${text.slice(0, 50)}", falling back to heuristics.`,
        );
      }
    } catch (err) {
      const errMsg = (err.message || '').length > 120 ? `${(err.message || '').slice(0, 120)}...` : err.message;
      logDebug(`[DEBUG] Exception in parseSuggestionCounts JSON parse, falling back to heuristics: ${errMsg}`);
    }

    // 2. Check for explicit text counts like "5 critical, 2 medium, 1 minor" or "critical: 5, medium: 2, minor: 1"
    // Also supports pluralized forms like "5 criticals, 2 mediums, 1 minor"
    // Use global matchAll to extract the final occurrence, defending against conversational drifting/preambles
    const extractCount = (cat) => {
      const matches = Array.from(
        text.matchAll(new RegExp(`(?:(\\d+)\\s+${cat}s?|${cat}s?\\s*[:=-]?\\s*(\\d+))`, 'gi')),
      );
      if (matches.length === 0) {
        return null;
      }
      const last = matches[matches.length - 1];
      const numStr = last[1] || last[2];
      return numStr !== undefined ? parseInt(numStr, 10) : null;
    };

    const critCount = extractCount('critical');
    const medCount = extractCount('medium');
    const minCount = extractCount('minor');

    if (critCount !== null || medCount !== null || minCount !== null) {
      const critical = Math.max(0, critCount ?? 0);
      const medium = Math.max(0, medCount ?? 0);
      const minor = Math.max(0, minCount ?? 0);
      return {
        critical,
        medium,
        minor,
        total: critical + medium + minor,
      };
    }
  }

  // 3. Fallback: scan text for bracketed tag occurrences anchored to list structures (e.g. "1. [critical]" or "- [critical]" or "* [critical]")
  // Strip code backticks, bold/italic formatting, and tag-wrapping markers while preserving markdown bullet characters like "* [critical]"
  const normalizedText = (fallbackText || primaryText || '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(\[[^\]\n]+\])[*`_]/g, '$1')
    .replace(/[*`_](\[[^\]\n]+\])/g, '$1');
  const severities = ['critical', 'medium', 'minor'];
  const counts = { critical: 0, medium: 0, minor: 0 };

  let foundList = false;
  for (const sev of severities) {
    const listMatches = normalizedText.match(new RegExp(`^\\s*(?:\\d+[.)]|[-*])\\s*\\[\\s*${sev}\\s*\\]`, 'gim')) || [];
    counts[sev] = listMatches.length;
    if (counts[sev] > 0) {
      foundList = true;
    }
  }
  if (foundList) {
    counts.total = counts.critical + counts.medium + counts.minor;
    return counts;
  }

  // Also check line-anchored bracket tags without numbers (e.g. "[critical]")
  let foundLine = false;
  for (const sev of severities) {
    const lineMatches = normalizedText.match(new RegExp(`^\\s*\\[\\s*${sev}\\s*\\]`, 'gim')) || [];
    counts[sev] = lineMatches.length;
    if (counts[sev] > 0) {
      foundLine = true;
    }
  }
  if (foundLine) {
    counts.total = counts.critical + counts.medium + counts.minor;
    return counts;
  }

  // 4. Bracketed or parenthesized severity tag fallback: check for [critical] or (critical) anywhere in the text
  let foundTag = false;
  for (const sev of severities) {
    const tagMatches = normalizedText.match(new RegExp(`[\\[(]\\s*${sev}\\s*[\\])]`, 'gim')) || [];
    counts[sev] = tagMatches.length;
    if (counts[sev] > 0) {
      foundTag = true;
    }
  }
  if (foundTag) {
    counts.total = counts.critical + counts.medium + counts.minor;
    return counts;
  }

  // If no structural tags or explicit counts were matched, return zero counts to prevent false positives
  return { critical: 0, medium: 0, minor: 0, total: 0 };
}

/**
 * Invokes the flash-lite model to read suggestions and return parsed category counts.
 *
 * @param {Object} options
 * @param {string} options.suggestionsText - Raw reviewer output
 * @param {Function} [options.sessionRunner=runAgentSession] - Session runner function
 * @param {string} [options.model='gemini-3.1-flash-lite'] - Model to use
 * @param {Object|null} [options.rl=null] - Readline interface
 * @param {Function} [options.logger=console.log] - Logger
 * @returns {Promise<{critical: number, medium: number, minor: number, total: number}>}
 */
export async function tallySuggestionsWithFlashLite({
  suggestionsText = '',
  sessionRunner = runAgentSession,
  model = 'gemini-3.1-flash-lite',
  rl = null,
  logger: inputLogger = console.log,
} = {}) {
  const logger = typeof inputLogger === 'function' ? inputLogger : console.log;
  const prompt = buildTallyPrompt(suggestionsText);

  let rawOutput = '';
  try {
    rawOutput = await sessionRunner({
      initialPrompt: prompt,
      systemInstructions:
        'You are a strict text analysis and counting agent. Output ONLY a raw, valid JSON object with numeric keys "critical", "medium", and "minor" without any markdown formatting, backticks, code fences, or explanatory text. Do NOT call any tools.',
      requestedModel: model,
      maxTurnsOverride: 3,
      requireTopic: false,
      isolate: true,
      rl,
    });
  } catch (err) {
    logger(
      `[DEBUG] Flash-lite tally session error: ${String(err.message || err)}. Falling back to deterministic parsing.`,
    );
  }

  return parseSuggestionCounts(rawOutput, suggestionsText, logger);
}

const DEFAULT_REVIEW_SYSTEM_INSTRUCTIONS = `You are in the REVIEW LOOP phase. Review the staged code and the approved plan documented in 'plans/current.md', make surgical improvements within scope if necessary, update the plan with any decisions made, and ensure all tests and linters pass. If no changes or improvements are needed, make no modifications.`;

/**
 * Runs a multi-purpose Ralph Loop (Wiggum Loop).
 * Enforces fresh context per iteration, externalized state in filesystem/git,
 * deterministic automated backpressure, negative feedback injection, and explicit exit criteria.
 *
 * @param {Object} [options]
 * @param {Function} [options.sessionRunner=runAgentSession] - Async function executing an agent session
 * @param {Function|null} [options.validator=runQAPipeline] - Async function checking code validity
 * @param {Function|null} [options.iterationRunner=null] - Custom multi-agent per-iteration coordinator
 * @param {Function|string} [options.buildPrompt=buildReviewPrompt] - Prompt builder or prompt string
 * @param {Function|string} [options.systemInstructions] - System instructions string or builder
 * @param {string|null} [options.model=null] - Model to use for the session
 * @param {number} [options.maxIterations=15] - Maximum allowable outer loop iterations
 * @param {number} [options.maxTurnsPerSession=20] - Turn capacity per agent session
 * @param {number} [options.noProgressLimit=3] - Maximum consecutive iterations without progress before aborting
 * @param {number} [options.maxFileSizeBytes=51200] - Maximum file size in bytes per file
 * @param {number} [options.maxTotalContextBytes=204800] - Maximum total bytes across all modified files
 * @param {string|null} [options.repoRoot=null] - Repository root
 * @param {string|null} [options.planPath=null] - Path to plan file
 * @param {boolean} [options.requireTopic=true] - Whether to require topic updates
 * @param {boolean} [options.validateIntent=false] - Whether to require intent declarations
 * @param {Array<string>} [options.blockTools] - Tools to unregister/block
 * @param {Array<any>} [options.customTools=[]] - Custom tools to pass to agent session
 * @param {Object|null} [options.rl=null] - Readline interface for interactive prompts
 * @param {boolean} [options.stageBeforeIteration=true] - Whether to run git add -A before diffing
 * @param {boolean} [options.requireInitialDiff=false] - If true, exits immediately when initial diff is empty
 * @param {Function|null} [options.checkCompletion=null] - Custom completion predicate
 * @param {Function|null} [options.captureState=null] - Custom state capturer
 * @param {Function|null} [options.detectChange=null] - Custom change detector
 * @param {Function} [options.logger=console.log] - Output logger
 * @param {Function|null} [options.onIterationStart=null] - Lifecycle hook before iteration starts
 * @param {Function|null} [options.onIterationEnd=null] - Lifecycle hook after iteration ends
 * @returns {Promise<{success: boolean, completed: boolean, iterations: number, reason: string, finalState: Object, validationResult: Object, history: Array<Object>}>}
 */
export async function runRalphLoop(options = {}) {
  const {
    sessionRunner = runAgentSession,
    validator = runQAPipeline,
    iterationRunner = null,
    buildPrompt = buildReviewPrompt,
    systemInstructions = DEFAULT_REVIEW_SYSTEM_INSTRUCTIONS,
    validationCommands = ['bash .github/workflows/scripts/lint.sh all', 'go test ./...'],
    model = null,
    maxIterations = 15,
    maxTurnsPerSession = 20,
    noProgressLimit = 3,
    maxFileSizeBytes = 50 * 1024,
    maxTotalContextBytes = 500 * 1024,
    repoRoot = null,
    planPath = null,
    requireTopic = true,
    validateIntent = false,
    blockTools = ['invoke_agent', 'enter_plan_mode'],
    customTools = [],
    rl = null,
    stageBeforeIteration = true,
    requireInitialDiff = false,
    checkCompletion = null,
    captureState = null,
    detectChange = null,
    logger: inputLogger = console.log,
    onIterationStart = null,
    onIterationEnd = null,
  } = options;

  const logger = typeof inputLogger === 'function' ? inputLogger : console.log;
  const root = repoRoot || (await getRepoRoot());
  const resolvedPlanPath = planPath || path.join(root, 'plans/current.md');
  const captureFn = captureState || captureGitState;
  const detectFn = detectChange || detectGitStateChange;

  let iteration = 0;
  let consecutiveNoProgress = 0;
  let lastValidation = null;
  let lastAgentOutput = '';
  let isCompleted = false;
  let completionReason = '';
  const history = [];
  const failingDiffHashCounts = new Map();

  // Capture baseline state
  const initialBaseline = await captureFn({
    repoRoot: root,
    planPath: resolvedPlanPath,
    stageBeforeIteration,
    maxFileSizeBytes,
    maxTotalContextBytes,
  });

  if (requireInitialDiff && (!initialBaseline.diff || initialBaseline.diff.trim() === '')) {
    logger('\n✅ No staged changes found to review. Ralph loop complete.');
    return {
      success: true,
      completed: true,
      iterations: 0,
      reason: 'No staged changes found to review.',
      finalState: initialBaseline,
      validationResult: { success: true },
      history: [],
    };
  }

  let currentStateBefore = initialBaseline;
  let sessionError = null;

  while (iteration < maxIterations && !isCompleted) {
    iteration++;
    sessionError = null;
    logger(`\n🔄 [Ralph Loop] Iteration ${iteration}/${maxIterations}...`);

    if (iteration > 1) {
      currentStateBefore = await captureFn({
        repoRoot: root,
        planPath: resolvedPlanPath,
        stageBeforeIteration,
        maxFileSizeBytes,
        maxTotalContextBytes,
      });
    }

    if (typeof onIterationStart === 'function') {
      try {
        await onIterationStart({
          iteration,
          maxIterations,
          stateBefore: currentStateBefore,
          lastValidation,
        });
      } catch (err) {
        logger(`[DEBUG] onIterationStart hook error: ${err.message}`);
      }
    }

    let agentOutput;
    let iterationMeta;

    if (typeof iterationRunner === 'function') {
      try {
        iterationMeta = await iterationRunner({
          iteration,
          maxIterations,
          stateBefore: currentStateBefore,
          lastValidation,
          repoRoot: root,
          planPath: resolvedPlanPath,
          sessionRunner,
          rl,
          logger,
        });
        agentOutput = iterationMeta?.agentOutput || '';
        lastAgentOutput = agentOutput;
      } catch (err) {
        if (isAbortError(err)) {
          throw err;
        }
        logger(`❌ [Ralph Loop] Iteration runner threw an error: ${err.message}`);
        sessionError = err;
        agentOutput = `Error: ${err.message}`;
        lastAgentOutput = agentOutput;
      }
    } else {
      let skillsContext;
      try {
        skillsContext = await loadWorkspaceSkillsContext(root);
      } catch {
        skillsContext = '';
      }

      // Build the prompt for this fresh-context session
      const promptText =
        typeof buildPrompt === 'function'
          ? await buildPrompt({
              iteration,
              maxIterations,
              stateBefore: currentStateBefore,
              lastValidation,
              lastAgentOutput,
              repoRoot: root,
              planPath: resolvedPlanPath,
              activePlan: currentStateBefore.plan,
              validationCommands,
              skillsContext,
            })
          : String(buildPrompt || '');

      // Resolve system instructions
      let currentInstructions =
        typeof systemInstructions === 'function'
          ? await systemInstructions({
              iteration,
              maxIterations,
              stateBefore: currentStateBefore,
              lastValidation,
              skillsContext,
            })
          : String(systemInstructions);

      if (
        skillsContext &&
        !currentInstructions.includes('<available_skills>') &&
        !currentInstructions.includes('Skills-First Mandate')
      ) {
        currentInstructions += `\n\n${skillsContext}`;
      }

      // Run thinking agent with a clean context window
      try {
        agentOutput = await sessionRunner({
          initialPrompt: promptText,
          systemInstructions: currentInstructions,
          requestedModel: model,
          maxTurnsOverride: maxTurnsPerSession,
          requireTopic,
          validateIntent,
          blockTools,
          customTools,
          rl,
        });
      } catch (err) {
        if (isAbortError(err)) {
          throw err;
        }
        logger(`❌ [Ralph Loop] Agent session threw an error: ${err.message}`);
        sessionError = err;
        agentOutput = `Error: ${err.message}`;
      }
      lastAgentOutput = agentOutput;
    }

    // Capture state after agent execution
    const stateAfter = await captureFn({
      repoRoot: root,
      planPath: resolvedPlanPath,
      stageBeforeIteration,
      maxFileSizeBytes,
      maxTotalContextBytes,
    });

    const changeResult = detectFn(currentStateBefore, stateAfter);
    const stateChanged = typeof changeResult === 'boolean' ? changeResult : Boolean(changeResult?.hasChanged);

    // Deterministic Backpressure: run machine validation if no session error
    let validationResult = sessionError
      ? {
          success: false,
          isSessionError: true,
          sessionError: sessionError.message || String(sessionError),
          stdout: '',
          stderr: sessionError.message || String(sessionError),
          error: sessionError.message || String(sessionError),
        }
      : { success: true };
    if (!sessionError && typeof validator === 'function') {
      logger(`⚙️  Running deterministic validation pipeline...`);
      try {
        validationResult = await validator({
          iteration,
          repoRoot: root,
          state: stateAfter,
          stateBefore: currentStateBefore,
          stateChanged,
        });
      } catch (err) {
        validationResult = {
          success: false,
          stdout: '',
          stderr: err.message || String(err),
          error: err.message || String(err),
        };
      }
    }
    lastValidation = validationResult;

    // Evaluate loop exit criteria
    if (iterationMeta?.forceComplete) {
      if (validationResult.success) {
        isCompleted = true;
        completionReason = iterationMeta.completionReason || 'Completed by iteration runner.';
      } else {
        logger(
          `⚠️ Iteration runner requested early completion, but deterministic validation failed. Retrying with error feedback...`,
        );
      }
    }

    if (!isCompleted) {
      if (sessionError) {
        consecutiveNoProgress++;
        logger(
          `⚠️ Agent session encountered an error (No-progress: ${consecutiveNoProgress}/${noProgressLimit}): ${sessionError.message}`,
        );
      } else if (typeof checkCompletion === 'function') {
        const customCheck = await checkCompletion({
          iteration,
          maxIterations,
          stateBefore: currentStateBefore,
          stateAfter,
          stateChanged,
          validationResult,
          agentOutput,
        });
        if (customCheck?.isComplete) {
          isCompleted = true;
          completionReason = customCheck.reason || 'Custom completion check satisfied.';
        }
      } else {
        // Default Ralph Loop exit criteria
        if (!validationResult.success) {
          if (!stateChanged) {
            consecutiveNoProgress++;
            logger(
              `⚠️ Agent made no changes, but deterministic validation failed (No-progress: ${consecutiveNoProgress}/${noProgressLimit}).`,
            );
          } else {
            // Check if this failing diff hash has been encountered previously
            const diffHash = stateAfter?.diffHash || '';
            const occurrences = (failingDiffHashCounts.get(diffHash) || 0) + 1;
            failingDiffHashCounts.set(diffHash, occurrences);

            if (occurrences > 1) {
              consecutiveNoProgress++;
              logger(
                `⚠️ Detected recurring failing diff state (Hash repeated ${occurrences} times; No-progress: ${consecutiveNoProgress}/${noProgressLimit}).`,
              );
            } else {
              consecutiveNoProgress = 0;
              logger(`📝 Agent made changes, but deterministic validation failed. Retrying with error feedback...`);
            }
          }
        } else {
          // Validation passed cleanly
          failingDiffHashCounts.clear();
          if (!stateChanged) {
            isCompleted = true;
            completionReason = 'No further changes suggested and deterministic validation passed cleanly.';
            logger(`\n✅ Convergence achieved: No further changes suggested and deterministic checks passed.`);
          } else {
            consecutiveNoProgress = 0;
            if (agentOutput && /<promise>\s*COMPLETE\s*<\/promise>/i.test(agentOutput)) {
              isCompleted = true;
              completionReason = 'Agent signaled completion promise and deterministic validation passed.';
              logger(`\n✅ Agent signaled completion promise and all deterministic checks passed.`);
            } else {
              logger(`\n📝 Agent made valid improvements. Looping again to verify stability...`);
            }
          }
        }
      }
    }

    // Circuit breaker: abort if no progress limit is reached
    if (!isCompleted && consecutiveNoProgress >= noProgressLimit) {
      if (sessionError) {
        completionReason = `Agent session failed with error for ${consecutiveNoProgress} consecutive iteration(s): ${sessionError.message}`;
      } else {
        completionReason = `No progress made for ${consecutiveNoProgress} consecutive iterations while validation failed.`;
      }
      logger(`\n🛑 Halting Ralph Loop: ${completionReason}`);
      break;
    }

    history.push({
      iteration,
      stateChanged,
      validationSuccess: validationResult.success,
      sessionError: sessionError ? sessionError.message : null,
      completionReason,
      isCompleted,
    });

    if (typeof onIterationEnd === 'function') {
      try {
        await onIterationEnd({
          iteration,
          maxIterations,
          stateChanged,
          validationResult,
          isCompleted,
          reason: completionReason,
        });
      } catch (err) {
        logger(`[DEBUG] onIterationEnd hook error: ${err.message}`);
      }
    }
  }

  if (!isCompleted && iteration >= maxIterations && !completionReason) {
    completionReason = `Reached maximum iterations (${maxIterations}) without resolving all issues.`;
    logger(`\n⚠️ ${completionReason}`);
  }

  const finalCapture = await captureFn({
    repoRoot: root,
    planPath: resolvedPlanPath,
    stageBeforeIteration: false,
  });

  const overallSuccess = isCompleted && (!lastValidation || lastValidation.success) && !sessionError;

  return {
    success: overallSuccess,
    completed: isCompleted,
    iterations: iteration,
    reason: completionReason,
    finalState: finalCapture,
    validationResult: lastValidation,
    history,
  };
}

/**
 * Calculates scaled turns for implementation sessions based on suggestion volume.
 *
 * @param {number} [baseTurns=20] - Base turn capacity
 * @param {number} [suggestionCount=5] - Number of suggestions to address
 * @param {number} [maxCeiling=60] - Maximum turn ceiling
 * @returns {number} Scaled turns
 */
export function calculateScaledTurns(baseTurns = 20, suggestionCount = 5, maxCeiling = 60) {
  const count = Math.max(0, suggestionCount ?? 5);
  return Math.max(baseTurns, Math.min(maxCeiling, Math.round(baseTurns * Math.max(1, count / 5))));
}

/**
 * Specialized high-level wrapper executing a Multi-Agent Review Ralph Loop.
 * 1. Thinking model (Pro) reviews staged code and generates at least 5 rated suggestions (critical/medium/minor).
 * 2. Flash-Lite model reads and tallies the counts of each category.
 * 3. Decision gate: if critical > 0 or medium > 0, Flash model implements all suggestions; if only minor, implementation is skipped and convergence is achieved.
 * 4. Deterministic validation pipeline runs after implementation to verify test/linter compliance.
 *
 * @param {Object} [options]
 * @param {string} [options.proModel='gemini-3.1-pro-preview'] - Thinking model for reviewing
 * @param {string} [options.flashModel='gemini-3.8-flash'] - Flash model for implementing suggestions
 * @param {string} [options.flashLiteModel='gemini-3.1-flash-lite'] - Flash-Lite model for tallying counts
 * @param {Object} [options.models] - Models dictionary containing { pro, flash, flash_lite }
 * @returns {Promise<{success: boolean, completed: boolean, iterations: number, reason: string, finalState: Object, validationResult: Object, history: Array<Object>}>}
 */
export async function runReviewRalphLoop(options = {}) {
  const {
    proModel = 'gemini-3.1-pro-preview',
    flashModel = 'gemini-3.8-flash',
    flashLiteModel = 'gemini-3.1-flash-lite',
    models: modelsConfig = null,
    sessionRunner = runAgentSession,
    validator = runQAPipeline,
    repoRoot = null,
    planPath = null,
    customTools = [],
    rl = null,
    logger: inputLogger = console.log,
    maxIterations = 15,
    maxTurnsPerSession = 20,
    ...restOptions
  } = options;

  const logger = typeof inputLogger === 'function' ? inputLogger : console.log;

  const resolvedProModel = modelsConfig?.pro || proModel;
  const resolvedFlashModel = modelsConfig?.flash || options.model || flashModel;
  const resolvedFlashLiteModel = modelsConfig?.flash_lite || modelsConfig?.flashLite || flashLiteModel;

  const root = repoRoot || (await getRepoRoot());
  let skillsContext = '';
  try {
    skillsContext = await loadWorkspaceSkillsContext(root);
  } catch {
    skillsContext = '';
  }

  const reviewIterationRunner = async ({
    iteration,
    maxIterations: totalIterations,
    stateBefore,
    lastValidation,
    logger: iterLogger,
  }) => {
    const activeLogger = typeof iterLogger === 'function' ? iterLogger : logger;
    activeLogger(`\n🤔 [Review Loop] Step 1: Thinking Reviewer (${resolvedProModel}) evaluating staged code...`);

    const reviewerPrompt = buildReviewerPrompt({
      iteration,
      maxIterations: totalIterations,
      stateBefore,
      lastValidation,
      activePlan: stateBefore.plan,
      skillsContext,
    });

    const reviewerInstructions =
      'You are a senior technical reviewer. Review the staged code against the active plan in plans/current.md. Output ONLY a numbered list of at least 5 suggestions with severity ratings [critical], [medium], or [minor]. Do NOT modify files or call mutating tools. You may use grep_search to inspect code.' +
      (skillsContext ? `\n\n${skillsContext}` : '');

    // 1. Thinking model reviews staged code
    const suggestionsText = await sessionRunner({
      initialPrompt: reviewerPrompt,
      systemInstructions: reviewerInstructions,
      requestedModel: resolvedProModel,
      maxTurnsOverride: 5,
      requireTopic: false,
      isolate: true,
      allowedTools: ['grep_search', 'GrepSearch'],
      rl,
    });

    activeLogger(`\n📝 [Review Loop] Step 2: Flash-Lite (${resolvedFlashLiteModel}) tallying suggestion categories...`);

    // 2. Flash-Lite model counts suggestions by category
    const tally = await tallySuggestionsWithFlashLite({
      suggestionsText,
      sessionRunner,
      model: resolvedFlashLiteModel,
      rl,
      logger: activeLogger,
    });

    activeLogger(
      `📊 Suggestion Tally: ${tally.critical} critical, ${tally.medium} medium, ${tally.minor} minor (Total: ${tally.total})`,
    );

    // 3. Decision Gate:
    // If there are any critical or medium suggestions we implement all suggestions.
    // If only minor suggestions exist (critical and medium are 0), we do not need to resolve them,
    // skipping implementation to achieve convergence.
    const shouldImplement = (tally.critical || 0) > 0 || (tally.medium || 0) > 0;

    if (!shouldImplement) {
      const completionReason = `Only minor suggestions found (${tally.minor} minor, 0 critical, 0 medium). No implementation needed.`;
      activeLogger(
        `\n✅ No critical or medium suggestions found (only ${tally.minor} minor suggestions). Skipping implementation per review policy.`,
      );
      return {
        agentOutput: suggestionsText,
        shouldImplement: false,
        tally,
        suggestionsText,
        forceComplete: true,
        completionReason,
      };
    }

    activeLogger(
      `\n🛠️ [Review Loop] Step 3: Critical or medium suggestions detected. Flash Model (${resolvedFlashModel}) implementing all suggestions...`,
    );

    // Scale turns dynamically based on suggestion volume to provide sufficient runway
    const scaledTurns = calculateScaledTurns(maxTurnsPerSession, tally.total);

    // 4. Flash Model implements all suggestions
    const implementationPrompt = buildImplementationPrompt({
      suggestionsText,
      tally,
      activePlan: stateBefore.plan,
      stateBefore,
      lastValidation,
      iteration,
      maxIterations: totalIterations,
      validationCommands: restOptions.validationCommands,
      skillsContext,
    });

    const implInstructions =
      'You are an expert engineer in the REVIEW LOOP phase. Implement all suggestions provided by the reviewer that are within plan scope, update plans/current.md with decisions, and ensure all tests and linters pass cleanly.' +
      (skillsContext ? `\n\n${skillsContext}` : '');

    const implOutput = await sessionRunner({
      initialPrompt: implementationPrompt,
      systemInstructions: implInstructions,
      requestedModel: resolvedFlashModel,
      maxTurnsOverride: scaledTurns,
      requireTopic: true,
      blockTools: restOptions.blockTools || ['invoke_agent', 'enter_plan_mode'],
      customTools: restOptions.customTools || customTools,
      rl,
    });

    return {
      agentOutput: implOutput,
      shouldImplement: true,
      tally,
      suggestionsText,
    };
  };

  return runRalphLoop({
    requireInitialDiff: true,
    iterationRunner: reviewIterationRunner,
    validator,
    repoRoot,
    planPath,
    customTools,
    rl,
    logger,
    maxIterations,
    maxTurnsPerSession,
    ...restOptions,
  });
}
