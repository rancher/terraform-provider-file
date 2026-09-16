#!/usr/bin/env node
/**
 * Skill: manage-pr-comments.js
 * Description: Programmatically list and resolve review comment threads on a GitHub Pull Request.
 */

import { parseArgs } from 'node:util';
import { detectPrId, getReviewThreads, resolveReviewThread, comment } from './lib/pr.js';

// Pre-compiled robust ANSI escape sequence regex (handles both CSI and OSC) to avoid ReDoS and loop recompilation
const esc = String.fromCharCode(27);
const c1 = String.fromCharCode(155);
const bel = String.fromCharCode(7);
const ANSI_REGEX = new RegExp(
  '[' + esc + c1 + '](?:\\[[0-?]*[ -/]*[@-~]|\\][^' + bel + esc + ']*[' + bel + esc + '])',
  'g',
);

/**
 * Validates parameter values against dangerous shell injection characters.
 */
function validateInput(val, name) {
  if (typeof val === 'string') {
    const dangerous = [';', '&', '|', '$', '`'];
    for (const char of dangerous) {
      if (val.includes(char)) {
        throw new Error(
          `Security Violation: Input parameter '${name}' contains dangerous shell metacharacter: '${char}'`,
        );
      }
    }
  }
}

function showHelp() {
  console.log(`Usage: manage-pr-comments.js [PR_ID] [options/file_pattern]

Programmatically list and resolve review comment threads on a GitHub Pull Request.

Arguments:
  PR_ID                 The numeric ID of the Pull Request (optional if on a branch with an open PR).
  OPTIONS/PATTERN       Filter or resolution command options.

Options:
  -h, --help            Show this message and exit.
  --all                 Resolve ALL unresolved comment threads.
  -v, --verbose         Print the full, un-truncated comment text.
  -j, --json            Output the unresolved threads as raw JSON and suppress standard logs.
  -m, --message string  Optional reply message to post directly to each resolved thread.
  -g, --general string  Optional general PR comment to post after resolving threads.
  <pattern>             Resolve threads where the file path contains the given literal pattern.

Examples:
  agent-scripts/manage-pr-comments.js 390
  agent-scripts/manage-pr-comments.js 390 --all
  agent-scripts/manage-pr-comments.js 390 --message "Fix applied" --all
  agent-scripts/manage-pr-comments.js 390 --general "PR review complete" --all
  agent-scripts/manage-pr-comments.js 390 --verbose
  agent-scripts/manage-pr-comments.js 390 --json
  agent-scripts/manage-pr-comments.js 390 publish-release.test.js`);
}

function parseArguments() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      all: { type: 'boolean' },
      verbose: { type: 'boolean', short: 'v' },
      json: { type: 'boolean', short: 'j' },
      message: { type: 'string', short: 'm', multiple: true },
      general: { type: 'string', short: 'g', multiple: true },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  let prId = null;
  let filter = null;

  for (const pos of positionals) {
    if (/^\d+$/.test(pos)) {
      prId = pos;
    } else {
      filter = pos;
    }
  }

  const mode = values.all ? 'all' : filter ? 'filter' : 'list';
  const resolvedMessage = Array.isArray(values.message) ? values.message[values.message.length - 1] : values.message;
  const resolvedGeneral = Array.isArray(values.general) ? values.general[values.general.length - 1] : values.general;

  return {
    prId,
    filter,
    mode,
    verbose: values.verbose,
    json: values.json,
    message: resolvedMessage,
    general: resolvedGeneral,
  };
}

async function processThreads(threads, options) {
  const { mode, filter, prId, verbose, json, message } = options;
  const results = [];
  if (threads.length === 0) {
    if (!json) {
      console.log(`🎉 No unresolved comment threads found on PR #${prId}!`);
    }
    return results;
  }

  if (!json) {
    console.log(`Found ${threads.length} unresolved comment thread(s) on PR #${prId}:`);
  }

  const processed = await Promise.all(
    threads.map(async (thread) => {
      if (!thread.comments || !thread.comments.nodes || thread.comments.nodes.length === 0) {
        return null;
      }

      const threadId = thread.id;
      const commentNode = thread.comments.nodes[0];
      const filePath = commentNode.path;
      const author = commentNode.author ? commentNode.author.login : 'unknown';

      // Fix Terminal Output Injection and deceptive naming.
      const rawBody = commentNode.body;
      const safeBody = rawBody.replace(ANSI_REGEX, '');
      const body = verbose
        ? safeBody
        : safeBody.substring(0, 80).replace(/\r|\n/g, ' ') + (safeBody.length > 80 ? '...' : '');

      if (!json) {
        console.log('------------------------------------------------------------');
        console.log(`Thread ID : ${threadId}`);
        console.log(`File Path : ${filePath}`);
        console.log(`Author    : @${author}`);
        console.log(`Comment   : ${body}`);
      }

      let shouldResolve = false;
      let status = 'skipped';
      let errorMessage = null;

      if (mode === 'all') {
        shouldResolve = true;
      } else if (mode === 'filter') {
        if (filePath.includes(filter)) {
          shouldResolve = true;
        } else {
          if (!json) {
            console.log('  -> Skipping (does not match filter)');
          }
        }
      } else {
        if (!json) {
          console.log(
            `  -> Running in list mode. Run with 'agent-scripts/manage-pr-comments.js ${prId} --all' or 'agent-scripts/manage-pr-comments.js ${prId} ${filePath}' to resolve.`,
          );
        }
      }

      if (shouldResolve) {
        try {
          await resolveReviewThread(threadId, message);
          status = 'resolved';
        } catch (err) {
          errorMessage = err.message || String(err);
          status = 'failed_resolve';
          if (!json) {
            console.error(`  -> Failed to resolve thread ${threadId}: ${errorMessage}`);
          }
        }
      }

      return {
        id: threadId,
        path: filePath,
        author,
        body: safeBody,
        status,
        ...(errorMessage ? { error: errorMessage } : {}),
      };
    }),
  );

  const cleanResults = processed.filter((r) => r !== null);
  results.push(...cleanResults);

  if (!json) {
    console.log('------------------------------------------------------------');
  }

  return results;
}

async function main() {
  const args = parseArguments();
  let prId = args.prId;
  const { filter, mode, verbose, json, message, general } = args;

  // Fix silent discard of user intent on CLI input. Replace the ternaries with strict fail-fast validation.
  if (message !== undefined && message !== null && (typeof message !== 'string' || message.trim() === '')) {
    throw new Error('--message cannot be empty');
  }
  const safeMessage = message ? message.trim() : null;

  if (general !== undefined && general !== null && (typeof general !== 'string' || general.trim() === '')) {
    throw new Error('--general cannot be empty');
  }
  const safeGeneral = general ? general.trim() : null;

  if ((safeMessage || safeGeneral) && mode === 'list') {
    const errMsg =
      'Error: --message or --general was provided but no resolution trigger (--all or a file pattern) was specified.';
    if (json) {
      console.error(JSON.stringify({ error: errMsg }));
    } else {
      console.error(errMsg);
    }
    process.exit(1);
  }

  try {
    if (safeMessage) {
      validateInput(safeMessage, 'message');
    }
    if (safeGeneral) {
      validateInput(safeGeneral, 'general');
    }
  } catch (err) {
    if (json) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }

  if (!prId) {
    prId = await detectPrId();
  }

  if (!prId) {
    const errMsg = 'Error: No Pull Request number provided and could not autodetect an open PR for the current branch.';
    if (json) {
      console.error(JSON.stringify({ error: errMsg }));
    } else {
      console.error(errMsg);
    }
    process.exit(1);
  }

  if (mode === 'filter' && !json) {
    console.log(`Filtering threads containing file path pattern: '${filter}'`);
  }

  if (!json) {
    console.log(`Fetching unresolved review comment threads for PR #${prId}...`);
  }
  let allThreads = [];
  try {
    allThreads = await getReviewThreads(prId);
  } catch (err) {
    if (!json) {
      console.error(`Error fetching threads: ${err.message}`);
    } else {
      console.error(JSON.stringify({ error: err.message }));
    }
    process.exit(1);
  }

  const unresolvedThreads = allThreads.filter((t) => !t.isResolved);

  const results = await processThreads(unresolvedThreads, {
    mode,
    filter,
    prId,
    verbose,
    json,
    message: safeMessage,
  });

  const finalGeneralComment = safeGeneral;

  let hasGeneralCommentFailure = false;
  if (finalGeneralComment && results.some((r) => r.status === 'resolved')) {
    if (!json) {
      console.log(`Posting a single general comment to PR #${prId}: "${finalGeneralComment}"`);
    }
    try {
      await comment(prId, finalGeneralComment);
    } catch (err) {
      hasGeneralCommentFailure = true;
      const errMsg = `Failed to post general comment: ${err.message}`;
      if (json) {
        console.error(JSON.stringify({ error: errMsg }));
      } else {
        console.error(`  -> ${errMsg}`);
      }
    }
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  }

  const hasThreadFailure = results.some((r) => r.status === 'failed_resolve');
  if (hasThreadFailure || hasGeneralCommentFailure) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('::error::Fatal Resolve PR Reviews Error:', err.stack || err.message);
  process.exit(1);
});
