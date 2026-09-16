import fs from 'fs';
import path from 'path';
import { gitRevParseShowToplevel } from '../../../agent-scripts/tools/git.js';
import { initializeState, readState } from '../../../agent-scripts/tools/state.js';
import { deny } from '../shared.js';

/**
 * Consumes and discards hook input from stdin non-blockingly to prevent broken pipes.
 */
export function discardStdin() {
  try {
    // Standard non-blocking Node.js stream consumption
    process.stdin.resume();
  } catch (err) {
    console.error(`🔒 Hook Warning: Failed to resume stdin stream: ${err.message || err}`);
  }
}

/**
 * Verifies if the session is running inside a secure, hermetic Nix shell.
 * Returns an object containing the markdown description and active status.
 */
export function verifyNixEnvironment() {
  const inNixShell = !!process.env.IN_NIX_SHELL;
  const text = inNixShell
    ? '✅ NIX ENVIRONMENT: Session is securely running inside a hermetic Nix shell.\n\n'
    : '⚠️ NIX ENVIRONMENT WARNING: Session is NOT running inside a Nix shell. Standard dependencies may be missing. Use the .github/workflows/scripts/nix-run.sh to run scripts.\n\n';

  if (inNixShell) {
    console.error('Nix shell environment verified.');
  } else {
    console.error('Warning: Not running in a Nix shell.');
  }

  return { text, active: inNixShell };
}

/**
 * Loads a highly-dense, token-optimized reference summary of the Agentic Framework.
 * Bypasses full file injection to prevent context bloat and keep token count low.
 */
export async function loadFrameworkContext() {
  console.error('Loaded token-optimized Agentic Framework context pointer.');
  return `# Gated Agentic Framework Reference
Programmatic Gated 4-Phase Lifecycle (Plan, Implement, Review, Commit) & 3 authoritative cryptographic approval gates in effect. Direct commits are blocked.
Subagents (including codebase_investigator, cli_help, generalist, quality_assurance, lead_architect, security_auditor) run headlessly to audit/remediate changes. See "docs/development/AgenticFramework.md".
`;
}

/**
 * Enforces Plan Mode entry on startup by setting up plan-mode flag files
 * and initializing the central phase state machine (FAIL-FAST).
 */
export async function initializeWorkspaceFlags(targetDir) {
  try {
    const existing = await readState(targetDir);
    if (!existing) {
      await initializeState(targetDir);
      console.error('phase-state.json initialized successfully to plan.');
    } else {
      console.error(`phase-state.json loaded. Current phase: ${existing.currentPhase}`);
    }
  } catch (err) {
    deny(
      'Startup Phase State Initialization',
      `Failed to initialize or write the session phase-state.json file. Error: ${err.message}`,
      'Ensure that the workspace temporary directory is fully writeable, that permissions are correct, and that no other process is holding a write lock on phase-state.json.',
    );
  }
}

/**
 * Locks the .aiexclude and .claudeignore files to read-only mode to prevent agent tampering (NON-CRITICAL).
 */
export async function protectExcludeFiles() {
  try {
    let repoRoot = process.cwd();
    try {
      repoRoot = await gitRevParseShowToplevel();
    } catch (err) {
      console.error(`🔒 Hook Warning: Failed to determine git repo root: ${err.message}`);
    }

    const excludeFiles = ['.claudeignore'];
    for (const file of excludeFiles) {
      const filePath = path.join(repoRoot, file);
      try {
        await fs.promises.access(filePath);
        await fs.promises.chmod(filePath, 0o400);
      } catch (err) {
        // Exclude file doesn't exist or is not readable, skip silently as per design
        console.debug(`🔒 Hook Info: Optional exclude file ${file} not found or inaccessible: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(
      `🔒 Hook Warning: Failed to set read-only permissions on exclude files. Error: ${err.message || err}`,
    );
  }
}

/**
 * Combines critical mandates, Nix status, and framework documentation into a single markdown context block.
 */
export function buildCombinedContext(nixText, frameworkContext) {
  const mandateHeader = `# Critical Agent Mandates
- Follow 'docs/development/how-to/DevelopmentProcess.toml'.
- NO COMMIT/PUSH COMMANDS (handled out-of-band by hooks).
- SOURCE EDITS BLOCKED until plan approval. Task checklists MUST be in the plan.
- Follow 4-Phase Gated Lifecycle: Plan -> Implement -> Review -> Commit.

Philosophy: Prefer explicit composition. Never swallow errors.\n\n`;

  const mandateFooter = `# Immediate Action Required
👉 Run \`enter_plan_mode\` to draft a checklist plan, and \`agent-scripts/quality-assurance.js\` to run reviews.\n`;

  const actionPrompt = '';

  return mandateHeader + nixText + frameworkContext + mandateFooter + actionPrompt;
}

/**
 * Outputs the clean JSON structure with the combined context to stdout and exits cleanly.
 */
export function buildStartupOutput(combinedContext, inNixShell) {
  const output = {
    hookSpecificOutput: {
      additionalContext: combinedContext,
    },
    systemMessage: `✨ Workspace context injected. ${
      inNixShell ? '[Nix Shell: Active]' : '[Nix Shell: Inactive]'
    } 👉 ACTION REQUIRED: Enter Plan Mode`,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}
