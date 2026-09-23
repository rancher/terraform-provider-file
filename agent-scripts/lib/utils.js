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
  let depth = 0;
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
    } else if (char === '{') {
      if (depth === 0) {
        startIndex = i;
      }
      depth++;
    } else if (char === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && startIndex !== -1) {
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
      }
    }
  }
  return objects;
}

/**
 * Parses JSON blocks out of raw text.
 * @param {string} text
 * @param {string} [fallbackType]
 * @returns {Object|null}
 */
export function parseJSONFromText(text, fallbackType = 'qa') {
  const safeText = typeof text === 'string' ? text : '';

  const matches = [...safeText.matchAll(/```(?:[a-zA-Z0-9_-]+)?\s*?\n?([\s\S]*?)\n?\s*```/gi)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i][1].trim();
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed;
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
        return parsed;
      }
    }
  } catch (err) {
    console.debug(`[DEBUG] Raw text was not pure JSON: ${err.message}`);
  }

  const unadorned = extractTopLevelJSONObjects(safeText);
  if (unadorned.length > 0) {
    return unadorned[unadorned.length - 1];
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
 * @returns {Promise<boolean>}
 */
export async function savePlanFromJSON(text) {
  const planJSON = parseJSONFromText(text, 'plan');
  if (planJSON && planJSON.title) {
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
