import fs from 'fs';
import { findLatestActivePlan } from './gating.js';
import { resolveTargetDir } from './workspace.js';

/**
 * Checks if there is an active plan in the ~/.gemini/tmp/<repo>/session[star]/plans/ directory.
 * @param {string} cwd - The current working directory
 * @returns {boolean} - True if an active plan exists, false otherwise
 */
export function checkActivePlan(cwd) {
  try {
    const targetDir = resolveTargetDir(cwd);
    if (!fs.existsSync(targetDir)) {
      return false;
    }
    return findLatestActivePlan(targetDir) !== null;
  } catch (err) {
    console.error('Failed to check for active plans:', err.message || err);
    return false;
  }
}

/**
 * Programmatically validates that a plan file contains all of our strict requirements.
 * @param {string} planPath - The path to the active plan markdown file
 * @returns {object} - { valid: boolean, errors: string[] }
 */
export function validatePlanContent(planPath) {
  const errors = [];
  if (!fs.existsSync(planPath)) {
    return { valid: false, errors: ['Plan file does not exist.'] };
  }

  const content = fs.readFileSync(planPath, 'utf-8');

  // 1. Checklist check: must contain markdown checklist items "[ ]"
  const checklistMatch = /-\s*\[\s*\]/g.test(content);
  if (!checklistMatch) {
    errors.push('The plan must include each step in a checklist (using "- [ ]").');
  }

  // 2. Comprehensive tests check
  const testMatch = /test|testing|linter/i.test(content);
  if (!testMatch) {
    errors.push('The plan must include running comprehensive tests.');
  }

  // 3. Quality gates check
  const gateMatch = /gate|signature|seal|approval/i.test(content);
  if (!gateMatch) {
    errors.push('The plan must include our standard quality gates.');
  }

  // 4. Maintaining the agentic framework check
  const frameworkMatch = /agentic framework|system script|enforcer hook/i.test(content);
  if (!frameworkMatch) {
    errors.push('The plan must include maintaining the agentic framework if improvements or bugs are found in it.');
  }

  // 5. Updating documentation check
  const docMatch = /document|documentation|docs\//i.test(content);
  if (!docMatch) {
    errors.push('The plan must include updating documentation to describe the changes we plan to make.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
