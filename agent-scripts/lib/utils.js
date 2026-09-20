import fs from 'node:fs/promises';
import path from 'node:path';
import toml from '@iarna/toml';

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
  const filePath = path.join(process.cwd(), `.gemini/agents/${agentName}.toml`);
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
 * Parses JSON blocks out of raw text.
 * @param {string} text
 * @param {string} [fallbackType]
 * @returns {Object|null}
 */
export function parseJSONFromText(text, fallbackType = 'qa') {
  const match = text.match(/```json\s*\n([\s\S]*?)\n\s*```/) || text.match(/```\s*\n([\s\S]*?)\n\s*```/);
  const clean = (match ? match[1] : text).trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    console.warn(`⚠️ JSON parsing failed: ${err.message}. Attempting graceful fallback structure.`);
    if (fallbackType === 'qa') {
      const containsApproved = text.toUpperCase().includes('APPROVED') && !text.toUpperCase().includes('UNAPPROVED');
      return {
        approval_status: containsApproved ? 'APPROVED' : 'UNAPPROVED',
        findings: containsApproved
          ? []
          : [
              {
                file: 'unknown',
                line_numbers: [],
                narrative: text.trim() || 'No detail provided in raw text response.',
              },
            ],
      };
    }
    return null;
  }
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
    await fs.mkdir(path.join(process.cwd(), 'plans'), { recursive: true });
    await fs.writeFile(path.join(process.cwd(), 'plans/current.md'), mdPlan, 'utf8');
    return true;
  }
  return false;
}
