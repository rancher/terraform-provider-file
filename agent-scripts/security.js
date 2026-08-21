import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Validates a shell command against Rancher git remote operations, manual git commits/pushes, and branch draft PR checks.
 * @returns {object} - { decision: 'allow'|'deny', reason?: string, systemMessage?: string }
 */
export function verifyGitCommand(command, cwd) {
  const trimmedCmd = command.trim();

  // Strip leading env var assignments (e.g. KEY=value or KEY="value" or KEY='value') and optional sudo
  let commandClean = trimmedCmd;
  while (true) {
    const next = commandClean.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+/, '');
    if (next === commandClean) {
      break;
    }
    commandClean = next;
  }

  // Anti-Bypass Guardrail: Unconditionally deny any manual execution of enforcer hook scripts inside .gemini/hooks/ or .claude/hooks/
  const isExecutingHooksManually =
    trimmedCmd.includes('.gemini/hooks/') ||
    trimmedCmd.includes('.gemini/hooks') ||
    trimmedCmd.includes('.claude/hooks/') ||
    trimmedCmd.includes('.claude/hooks') ||
    (trimmedCmd.includes('agent-scripts/') && !trimmedCmd.includes('agent-scripts/tests/'));
  if (isExecutingHooksManually) {
    return {
      decision: 'deny',
      reason:
        '🔒 Security Policy Violation: Manual execution of enforcer hook or agent scripts is strictly prohibited.\n\n' +
        'These scripts are part of the secure system pipeline and must only be executed automatically by the Gemini CLI lifecycle.\n\n' +
        'To proceed:\n' +
        '1. Do NOT execute enforcer hook or helper files directly.\n' +
        '2. Proceed strictly through our gated development lifecycle (Plan -> Test -> Review -> Commit).\n' +
        '3. All test execution and gating signatures are managed automatically by the Gemini CLI. Run tests using pre-existing tracked commands.',
      systemMessage: '🔒 Security Block: Manual execution of secure scripts is prohibited.',
    };
  }

  // Anti-Bypass Guardrail: Unconditionally deny execution of untracked script files (Zero-Trust Sandbox)
  const scriptRegex =
    /\b(node|sh|bash|python|python3|perl|ruby)\b\s+(?:-[^\s]+\s+)*([A-Za-z0-9_.\-\/]+\.(?:js|mjs|sh|py|pl|rb|ts|bash))\b|^\s*(\.\/[A-Za-z0-9_.\-\/]+\.(?:js|mjs|sh|py|pl|rb|ts|bash))\b/i;
  const matchScript = commandClean.match(scriptRegex);
  if (matchScript) {
    const rawScriptPath = matchScript[2] || matchScript[3];
    if (rawScriptPath) {
      const scriptPath = path.resolve(cwd || process.cwd(), rawScriptPath);
      if (fs.existsSync(scriptPath)) {
        try {
          execFileSync('git', ['ls-files', '--error-unmatch', scriptPath], {
            cwd: cwd || process.cwd(),
            stdio: 'ignore',
          });
        } catch {
          return {
            decision: 'deny',
            reason:
              `🔒 Security Policy Violation: Execution of untracked script file '${scriptPath}' is strictly blocked under our zero-trust sandbox!\n\n` +
              'AI agents are prohibited from creating and running arbitrary temporary execution scripts to bypass repository guards.\n\n' +
              'To proceed:\n' +
              '1. Stage and track this script in version control first using git: `git add <script>`.\n' +
              '2. Once the script is tracked by Git, the sandbox enforcers will authorize its execution.\n' +
              '3. Never attempt to run untracked scripts or write temporary files in configuration directories.',
            systemMessage: `🔒 Security Block: Execution of untracked script '${scriptPath}' is prohibited.`,
          };
        }
      }
    }
  }

  // Anti-Bypass Guardrail: Unconditionally deny any manual writing, editing, or spoofing of any gate approval/challenge JSON/age files
  const isManipulatingApproval =
    /\b(echo|cat|touch|rm|mv|cp|write|tee|vim|vi|nano|printf|sed|awk)\b.*\b(plan-approval|test-approval|review-approval|user-approval)\.(json|challenge|age)\b|>>?[^>]*\b(plan-approval|test-approval|review-approval|user-approval)\.(json|challenge|age)\b/.test(
      commandClean,
    );
  if (isManipulatingApproval) {
    return {
      decision: 'deny',
      reason:
        'Security Policy Violation: Manually writing, editing, or spoofing any planning, testing, review, or commit gate approval files is strictly prohibited.\n\n' +
        'Gating approval files must ONLY be generated automatically and securely by our pipeline hooks and sub-agents.\n\n' +
        'To proceed:\n' +
        '1. Comply strictly with our gated sequence (Plan -> Test -> Review -> Commit).\n' +
        '2. Use the proper tools (biometric Touches or sub-agent runs) to obtain valid signatures.\n' +
        '3. Never attempt to manually create, edit, or spoof any gate approval or challenge files.',
      systemMessage: '🔒 Security Block: Direct manipulation of approval files is prohibited.',
    };
  }

  // Check if we are attempting to switch branches while current PR is in Draft mode (Phase 6, Step 18 / Phase 7, Step 20)
  let isBranchSwitch = false;
  if (/\bgit\s+switch\b/.test(commandClean)) {
    isBranchSwitch = true;
  } else if (/\bgit\s+checkout\b/.test(commandClean)) {
    const hasDoubleDash = commandClean.includes(' -- ');
    if (hasDoubleDash) {
      isBranchSwitch = false;
    } else {
      const parts = commandClean.split(/\s+/).filter((p) => p !== 'git' && p !== 'checkout');
      const nonFlagParts = parts.filter((p) => !p.startsWith('-') || p === '-');

      if (nonFlagParts.length > 0) {
        const target = nonFlagParts[0];
        if (target === '-') {
          isBranchSwitch = true;
        } else {
          const resolvedTarget = path.resolve(cwd || process.cwd(), target);
          if (!fs.existsSync(resolvedTarget)) {
            isBranchSwitch = true;
          }
        }
      } else {
        isBranchSwitch = false;
      }
    }
  }

  if (isBranchSwitch) {
    try {
      const currentBranch = execSync('git branch --show-current', {
        cwd: cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();

      if (currentBranch && currentBranch !== 'main') {
        let prStatusOutput;
        try {
          prStatusOutput = execFileSync('gh', ['pr', 'view', currentBranch, '--json', 'isDraft,number'], {
            cwd: cwd || process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
          })
            .toString()
            .trim();
        } catch (execErr) {
          const stderr = execErr.stderr ? execErr.stderr.toString() : '';
          if (stderr.includes('no pull requests found')) {
            prStatusOutput = '';
          } else {
            throw execErr;
          }
        }

        if (prStatusOutput) {
          const prInfo = JSON.parse(prStatusOutput);
          if (prInfo.isDraft === true) {
            return {
              decision: 'deny',
              reason:
                `Security Policy Violation: Moving to a new PR or branch is prohibited while the current branch PR (#${prInfo.number}) is still in Draft mode.\n\n` +
                `In accordance with Phase 6, Step 18 (Convert to Ready) and Phase 7, Step 20 (Proceed to Next Layer) of 'development-process.md', you MUST first graduate the current PR from Draft to Ready-for-Review before checking out 'main' or switching tasks.\n\n` +
                `To proceed:\n` +
                `1. Complete all iteration reviews and obtain local sign-off.\n` +
                `2. Convert the draft PR to Ready-for-Review (Phase 6, Step 18) using the GitHub CLI directly: \`gh pr ready ${prInfo.number}\`.\n` +
                `3. Once the PR is marked as ready for review on GitHub, you will be authorized to switch branches (Phase 7, Step 20).`,
              systemMessage: `🔒 Security Block: Current PR #${prInfo.number} is in Draft mode. Please comply with Phase 6, Step 18 of development-process.md.`,
            };
          }
        }
      }
    } catch (err) {
      console.error('Failed to verify branch PR status:', err);
      return {
        decision: 'deny',
        reason:
          'Security Policy Violation: Failed to verify draft PR status on GitHub. To prevent branch state divergence, operations are blocked until status can be verified.',
        systemMessage: '🔒 Security Block: Branch PR verification failed.',
      };
    }
  }

  // Check for unauthorized git commit or push operations
  const isCommitOrPush =
    /\bgit\s+(commit|push)\b/.test(commandClean) || /commit-push-helper\.sh|commit-push-helper/i.test(commandClean);
  if (isCommitOrPush) {
    return {
      decision: 'deny',
      reason:
        `Security Policy Violation: Direct manual git commit/push commands and direct execution of the commit-push helper scripts are strictly prohibited in this repository.\n\n` +
        `In accordance with Phase 6, Step 15 (Authorized Commit & Push) of 'development-process.md', commits and pushes are solely and securely managed out-of-band by the system hooks.\n\n` +
        `To proceed:\n` +
        `1. Complete all Plan, Test, and Review phases successfully.\n` +
        `2. Transition to the COMMIT phase via the phase manager.\n` +
        `3. Call ask_user to present your changes and request commit approval from the developer.\n` +
        `4. The system hooks will automatically commit and push your changes upon biometric Touch ID validation.`,
      systemMessage:
        '🔒 Security Block: Direct git commit/push and commit-push helper execution are blocked. Please request commit approval via ask_user.',
    };
  }

  // Check if it is a git command and performs a remote-interacting operation
  const isGitCmd = /^(?:sudo\s+)?git\b/.test(commandClean);
  const isRemoteOp = /\b(push|pull|fetch|clone|remote)\b/.test(commandClean);

  if (isGitCmd && isRemoteOp) {
    const hasRancherRef = /rancher/i.test(trimmedCmd.replace(/block-rancher-git\.js/g, ''));
    if (hasRancherRef) {
      return {
        decision: 'deny',
        reason:
          'Security Policy Violation: Git command contains references to Rancher remote/URLs, which is strictly blocked.',
        systemMessage: '🔒 Security Block: Prohibited remote/URL reference detected.',
      };
    }

    try {
      const remotesOutput = execSync('git remote -v', {
        cwd: cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();

      if (/rancher/i.test(remotesOutput)) {
        return {
          decision: 'deny',
          reason:
            'Security Policy Violation: Operations (push, pull, fetch, remote) targeting Rancher-owned remotes are strictly blocked.',
          systemMessage: '🔒 Security Block: Git remote operation against a Rancher remote is prohibited.',
        };
      }
    } catch (err) {
      console.error('Failed to check git remote safety:', err);
      return {
        decision: 'deny',
        reason: 'Security Policy Violation: Failed to check git remote safety configuration.',
        systemMessage: '🔒 Security Block: Remote safety verification failed.',
      };
    }
  }

  return { decision: 'allow' };
}
