#!/usr/bin/env node
import { getOctokit, getRepoDetails } from './auth.js';
import { findPR } from './find_pr.js';
import { replyComment } from './reply-comment.js';

/**
 * Adds a general comment or replies to an inline comment on a pull request.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {string|number} [params.commentId] - numeric ID or 'general' / '0'
 * @param {string} params.body
 * @returns {Promise<object>}
 */
export async function respondComment({ octokit, owner, repo, prNumber, commentId, body }) {
  if (!body || !body.trim()) {
    throw new Error('Comment body cannot be empty.');
  }

  const isGeneral = !commentId || commentId === 'general' || commentId === '0' || commentId === 0;

  if (isGeneral) {
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    return { type: 'general_comment', data };
  }

  return replyComment({
    octokit,
    owner,
    repo,
    prNumber,
    commentId: typeof commentId === 'string' && commentId.startsWith('PRRT_') ? commentId : parseInt(commentId, 10),
    body,
  });
}

/**
 * Parses command-line arguments for respond_comment.js flexibly.
 * Supports:
 * - [pr_target, comment_id, ...body]
 * - [pr_target, 'general', ...body]
 * - ['general', ...body]
 * - [pr_target, ...body]
 * - [...body]
 * @param {Array<string>} args
 * @returns {{prTarget?: string, commentId?: string|number, body?: string}}
 */
export function parseRespondArgs(args) {
  if (!args || args.length === 0) {
    return {};
  }

  const isNum = (v) => /^#?\d+$/.test(String(v || '').trim());
  const toNum = (v) => parseInt(String(v).trim().replace(/^#/, ''), 10);
  const isRef = (v) => isNum(v) || String(v || '').startsWith('PRRT_');
  const toRef = (v) => (String(v || '').startsWith('PRRT_') ? String(v).trim() : toNum(v));

  let prTarget = 'current';
  let commentId = 'general';
  let bodyTokens = [];

  const first = args[0];

  if (first === 'general' || first === '0') {
    commentId = 'general';
    bodyTokens = args.slice(1);
  } else if (String(first || '').startsWith('PRRT_')) {
    commentId = String(first).trim();
    bodyTokens = args.slice(1);
  } else if (first === 'current') {
    prTarget = 'current';
    if (args.length >= 2 && (args[1] === 'general' || isRef(args[1]))) {
      commentId = isRef(args[1]) ? toRef(args[1]) : 'general';
      bodyTokens = args.slice(2);
    } else {
      commentId = 'general';
      bodyTokens = args.slice(1);
    }
  } else if (isNum(first)) {
    if (args.length >= 2 && (args[1] === 'general' || isRef(args[1]))) {
      prTarget = first;
      commentId = isRef(args[1]) ? toRef(args[1]) : 'general';
      bodyTokens = args.slice(2);
    } else {
      prTarget = first;
      commentId = 'general';
      bodyTokens = args.slice(1);
    }
  } else {
    if (args.length >= 2 && (args[1] === 'general' || isRef(args[1]))) {
      prTarget = first;
      commentId = isRef(args[1]) ? toRef(args[1]) : 'general';
      bodyTokens = args.slice(2);
    } else {
      prTarget = 'current';
      commentId = 'general';
      bodyTokens = args;
    }
  }

  const body = bodyTokens.join(' ').trim();
  return { prTarget, commentId, body };
}

async function main() {
  const args = process.argv.slice(2);
  const { prTarget, commentId, body } = parseRespondArgs(args);

  if (!body) {
    console.error('Usage: respond_comment.js [pr_number_or_current] [comment_id_or_general] "body"');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  let prNumber;
  try {
    const pr = await findPR({
      octokit,
      owner,
      repo,
      target: prTarget === 'current' ? undefined : prTarget,
    });
    prNumber = pr.number;
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }

  try {
    const result = await respondComment({
      octokit,
      owner,
      repo,
      prNumber,
      commentId,
      body,
    });
    console.log(`✅ Successfully responded on PR #${prNumber} (${result.type}).`);
  } catch (err) {
    console.error(`❌ Error responding to PR comment: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
