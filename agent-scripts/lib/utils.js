import toml from '@iarna/toml';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedRepoRoot = null;

/**
 * Gets the repository root path dynamically.
 * @returns {Promise<string>}
 */
export async function getRepoRoot() {
  if (cachedRepoRoot) {
    return cachedRepoRoot;
  }
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel']);
    cachedRepoRoot = stdout.trim();
    return cachedRepoRoot;
  } catch (err) {
    console.debug(`[DEBUG] Failed to resolve git repo root via execFile: ${err.message}. Falling back to cwd.`);
    cachedRepoRoot = process.cwd();
    return cachedRepoRoot;
  }
}

/**
 * Checks if a file exists.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads custom agent instructions from .gemini/agents/<agentName>.toml
 * @param {string} agentName
 * @returns {Promise<Object>}
 */
export async function loadAgentInstructions(agentName) {
  const repoRoot = await getRepoRoot();
  const filePath = path.join(repoRoot, `.gemini/agents/${agentName}.toml`);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = toml.parse(content);
    return {
      instructions: parsed.instructions || '',
      model: parsed.model,
      max_turns: parsed.max_turns,
      temperature: parsed.temperature,
    };
  } catch (err) {
    console.warn(`⚠️ Could not load custom instructions for agent ${agentName}: ${err.message}`);
    return { instructions: '' };
  }
}

/**
 * Maps a file path to its corresponding standards file.
 * @param {string} filePath
 * @returns {string} Relative path to the standards file
 */
export function getStandardsFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mappings = {
    '.go': 'docs/development/reference/Go.toml',
    '.tf': 'docs/development/reference/Terraform.toml',
    '.sh': 'docs/development/reference/ShellScripts.toml',
    '.bash': 'docs/development/reference/ShellScripts.toml',
    '.js': 'docs/development/reference/JavaScript.toml',
    '.mjs': 'docs/development/reference/JavaScript.toml',
    '.cjs': 'docs/development/reference/JavaScript.toml',
    '.ts': 'docs/development/reference/JavaScript.toml',
    '.md': 'docs/development/reference/DocumentationFormatting.toml',
    '.toml': 'docs/development/reference/DocumentationFormatting.toml',
    '.yml': 'docs/development/reference/Workflows.toml',
    '.yaml': 'docs/development/reference/Workflows.toml',
    default: 'docs/development/reference/CodingStandards.toml',
  };
  return mappings[ext] || mappings['default'];
}

/**
 * Extracts balanced top-level JSON objects from mixed text.
 * @param {string} str
 * @returns {Array<Object>}
 */
function extractTopLevelJSONObjects(str) {
  const objects = [];
  const stack = [];
  let startIndex = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      if (stack.length === 0) {
        startIndex = i;
      }
      stack.push(char);
    } else if (char === '}' || char === ']') {
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        if ((top === '{' && char === '}') || (top === '[' && char === ']')) {
          stack.pop();
          if (stack.length === 0 && startIndex !== -1) {
            const candidate = str.slice(startIndex, i + 1);
            try {
              const parsed = JSON.parse(candidate);
              if (parsed && typeof parsed === 'object') {
                objects.push(parsed);
              }
            } catch (err) {
              console.debug(`[DEBUG] Skipping malformed JSON candidate: ${err.message}`);
            }
            startIndex = -1;
          }
        } else {
          startIndex = -1;
          stack.length = 0;
        }
      }
    }
  }
  return objects;
}

/**
 * Normalizes any parsed JSON object or array into a standard implementation plan structure.
 * @param {Object|Array} raw
 * @param {string} [fallbackObjective]
 * @returns {Object}
 */
export function normalizePlanObject(raw, fallbackObjective = '') {
  const obj = Array.isArray(raw) ? { plan: raw } : { ...raw };

  let title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : '';
  let objective = typeof obj.objective === 'string' && obj.objective.trim() ? obj.objective.trim() : '';
  const description = typeof obj.description === 'string' && obj.description.trim() ? obj.description.trim() : '';
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : '';

  let firstPlanItemDesc = '';
  if (Array.isArray(obj.plan) && obj.plan.length > 0 && typeof obj.plan[0] === 'object' && obj.plan[0]) {
    const p0 = obj.plan[0];
    const filePrefix = p0.file ? `[${p0.file}] ` : '';
    if (p0.description) {
      firstPlanItemDesc = p0.description;
    } else if (p0.title) {
      firstPlanItemDesc = p0.title;
    } else if (p0.task) {
      firstPlanItemDesc = `${filePrefix}${p0.task}`;
    } else if (Array.isArray(p0.steps) && p0.steps.length > 0) {
      firstPlanItemDesc = `${filePrefix}${p0.steps[0]}`;
    }
  }

  if (!title) {
    title = objective || name || description || firstPlanItemDesc || fallbackObjective || 'Implementation Plan';
  }
  if (!objective) {
    objective = fallbackObjective || description || title || firstPlanItemDesc || 'Implementation Plan';
  }

  let implementationTasks = [];
  if (Array.isArray(obj.implementation_tasks)) {
    implementationTasks = obj.implementation_tasks.map((t) =>
      typeof t === 'object' && t ? t.description || t.task || JSON.stringify(t) : String(t),
    );
  } else if (Array.isArray(obj.tasks)) {
    implementationTasks = obj.tasks.map((t) =>
      typeof t === 'object' && t ? t.description || t.task || JSON.stringify(t) : String(t),
    );
  } else if (Array.isArray(obj.steps)) {
    implementationTasks = obj.steps.map((s) =>
      typeof s === 'object' && s ? s.description || s.step || JSON.stringify(s) : String(s),
    );
  } else if (Array.isArray(obj.plan)) {
    for (const item of obj.plan) {
      if (typeof item === 'string') {
        implementationTasks.push(item);
      } else if (item && typeof item === 'object') {
        const filePrefix = item.file ? `[${item.file}] ` : '';
        if (Array.isArray(item.steps) && item.steps.length > 0) {
          for (const step of item.steps) {
            implementationTasks.push(`${filePrefix}${step}`);
          }
        } else if (item.description) {
          implementationTasks.push(`${filePrefix}${item.description}`);
        } else if (item.task) {
          implementationTasks.push(`${filePrefix}${item.task}`);
        } else if (item.title) {
          implementationTasks.push(`${filePrefix}${item.title}`);
        }
      }
    }
  }

  if (implementationTasks.length === 0) {
    if (typeof obj.plan === 'string' && obj.plan.trim()) {
      implementationTasks.push(obj.plan.trim());
    } else {
      implementationTasks.push('Execute implementation according to plan.');
    }
  }

  let inScope = [];
  let outOfScope = [];
  if (obj.scope_boundaries && typeof obj.scope_boundaries === 'object') {
    if (Array.isArray(obj.scope_boundaries.in_scope)) {
      inScope = obj.scope_boundaries.in_scope.map(String);
    }
    if (Array.isArray(obj.scope_boundaries.out_of_scope)) {
      outOfScope = obj.scope_boundaries.out_of_scope.map(String);
    }
  }
  if (inScope.length === 0) {
    if (Array.isArray(obj.in_scope)) {
      inScope = obj.in_scope.map(String);
    } else if (Array.isArray(obj.plan)) {
      const files = obj.plan
        .map((p) => (p && typeof p === 'object' ? p.file : null))
        .filter(Boolean);
      if (files.length > 0) {
        inScope = files.map((f) => `Modify ${f}`);
      }
    }
  }
  if (inScope.length === 0) {
    inScope = ['Implement requested tasks as planned'];
  }

  if (outOfScope.length === 0) {
    if (Array.isArray(obj.out_of_scope)) {
      outOfScope = obj.out_of_scope.map(String);
    } else {
      outOfScope = ['Unrelated refactoring or changes outside the defined scope'];
    }
  }

  let exitCriteria;
  if (Array.isArray(obj.exit_criteria)) {
    exitCriteria = obj.exit_criteria.map(String);
  } else if (typeof obj.exit_criteria === 'string' && obj.exit_criteria.trim()) {
    exitCriteria = [obj.exit_criteria.trim()];
  } else {
    exitCriteria = ['All implementation tasks completed successfully.', 'Tests and linters pass cleanly.'];
  }

  return {
    title,
    objective,
    scope_boundaries: {
      in_scope: inScope,
      out_of_scope: outOfScope,
    },
    exit_criteria: exitCriteria,
    implementation_tasks: implementationTasks,
  };
}

/**
 * Parses JSON blocks out of raw text.
 * @param {string} text
 * @param {string} [fallbackType]
 * @returns {Object|null}
 */
export function parseJSONFromText(text, fallbackType = 'qa') {
  const safeText = typeof text === 'string' ? text : '';
  const normalizeResult = (obj) => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    if (fallbackType === 'qa') {
      if (Array.isArray(obj.findings) && !obj.approval_status) {
        obj.approval_status = obj.findings.length === 0 ? 'APPROVED' : 'UNAPPROVED';
      }
    } else if (fallbackType === 'plan') {
      return normalizePlanObject(obj);
    }
    return obj;
  };

  const matches = [...safeText.matchAll(/```(?:[a-zA-Z0-9_-]+)?\s*?\n?([\s\S]*?)\n?\s*```/gi)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i][1].trim();
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return normalizeResult(parsed);
      }
    } catch (err) {
      console.debug(`[DEBUG] Code block candidate did not contain valid JSON: ${err.message}`);
    }
  }
  try {
    const clean = safeText.trim();
    if (clean) {
      const parsed = JSON.parse(clean);
      if (parsed && typeof parsed === 'object') {
        return normalizeResult(parsed);
      }
    }
  } catch (err) {
    console.debug(`[DEBUG] Raw text was not pure JSON: ${err.message}`);
  }

  const unadorned = extractTopLevelJSONObjects(safeText);
  if (unadorned.length > 0) {
    if (fallbackType === 'plan') {
      const validPlans = unadorned.filter((item) => {
        if (Array.isArray(item)) {
          return item.length > 0 && typeof item[0] === 'object' && item[0] !== null;
        }
        return (
          typeof item === 'object' &&
          item !== null &&
          (item.plan || item.tasks || item.steps || item.title || item.implementation_tasks)
        );
      });
      if (validPlans.length > 0) {
        return normalizeResult(validPlans[validPlans.length - 1]);
      }
    } else {
      return normalizeResult(unadorned[unadorned.length - 1]);
    }
  }

  console.warn(`⚠️ JSON parsing failed: no valid JSON block found. Failing closed.`);
  if (fallbackType === 'qa') {
    return {
      approval_status: 'UNAPPROVED',
      findings: [
        {
          file: 'unknown',
          line_numbers: [],
          narrative: `Malformed output: agent did not produce valid JSON findings.\nRaw response: ${safeText.trim()}`,
        },
      ],
    };
  }
  return null;
}

/**
 * Formats and saves an implementation plan to plans/current.md
 * @param {string} text - Raw JSON plan string
 * @param {string} [fallbackObjective] - Fallback objective if plan has no explicit objective
 * @returns {Promise<boolean>}
 */
export async function savePlanFromJSON(text, fallbackObjective = '') {
  const planJSON = parseJSONFromText(text, 'plan');
  if (planJSON && planJSON.title) {
    if (fallbackObjective) {
      if (!planJSON.objective || planJSON.objective === 'Implementation Plan') {
        planJSON.objective = fallbackObjective;
      }
      if (!planJSON.title || planJSON.title === 'Implementation Plan') {
        planJSON.title = fallbackObjective;
      }
    }
    const mdPlan = [
      `# IMPLEMENTATION PLAN: ${planJSON.title}`,
      '',
      `## 🎯 OBJECTIVE`,
      planJSON.objective || '',
      '',
      `## 🚧 SCOPE BOUNDARIES`,
      `**IN SCOPE:**`,
      ...(planJSON.scope_boundaries?.in_scope || []).map((i) => `- ${i}`),
      '',
      `**OUT OF SCOPE (Do NOT attempt):**`,
      ...(planJSON.scope_boundaries?.out_of_scope || []).map((i) => `- ${i}`),
      '',
      `## ✅ EXIT CRITERIA (Definition of Done)`,
      ...(planJSON.exit_criteria || []).map((i) => `- [ ] ${i}`),
      '',
      `## 🛠️ IMPLEMENTATION TASKS`,
      ...(planJSON.implementation_tasks || []).map((i) => `- [ ] ${i}`),
      '',
    ].join('\n');
    const repoRoot = await getRepoRoot();
    await fs.mkdir(path.join(repoRoot, 'plans'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'plans/current.md'), mdPlan, 'utf8');
    return true;
  }
  return false;
}
