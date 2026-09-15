import fs from 'node:fs';
import path from 'node:path';

const docsDir = path.join(process.cwd(), 'docs/development');

const skipList = new Set([
  'docs/development/reference/Go.toml',
  'docs/development/reference/Terraform.toml',
  'docs/development/reference/ShellScripts.toml',
  'docs/development/reference/JavaScript.toml',
  'docs/development/reference/Workflows.toml',
  'docs/development/reference/CodingStandards.toml',
  'docs/development/reference/DocumentationFormatting.toml',
  'docs/development/explanation/Diataxis.toml',
]);

const renameMap = {
  'Documentation.md': 'DocumentationFormatting.toml',
};

// Helper to recursively get files with specific extension in docs/development
async function getFilesRecursively(dir, ext) {
  let results = [];
  const list = await fs.promises.readdir(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = await fs.promises.stat(fullPath);
    if (stat && stat.isDirectory()) {
      const subResults = await getFilesRecursively(fullPath, ext);
      results = results.concat(subResults);
    } else if (file.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function truncateDescription(desc) {
  const clean = desc.replace(/\n/g, ' ').trim();
  if (clean.length <= 150) {
    return clean;
  }
  // Truncate safely at word boundary
  const truncated = clean.substring(0, 147);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 100) {
    return truncated.substring(0, lastSpace) + '...';
  }
  return truncated + '...';
}

// Convert a single .md file to TOML
async function migrateFile(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  const baseName = path.basename(filePath);
  let tomlPath;
  if (renameMap[baseName]) {
    tomlPath = path.join(path.dirname(filePath), renameMap[baseName]);
  } else {
    tomlPath = filePath.replace(/\.md$/, '.toml');
  }
  const relTomlPath = path.relative(process.cwd(), tomlPath);

  if (skipList.has(relTomlPath)) {
    console.info(`Skipping predefined high-quality TOML reference: ${relTomlPath}`);
    // Still delete the legacy .md file if it exists to clean up
    const exists = await fs.promises
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      await fs.promises.unlink(filePath);
    }
    return;
  }

  // Determine quadrant from directory structure using platform-agnostic path.sep
  const relativeParts = path.relative(process.cwd(), filePath).split(path.sep);
  let quadrant = 'Explanation';
  if (relativeParts.includes('how-to')) {
    quadrant = 'How-To';
  } else if (relativeParts.includes('tutorials')) {
    quadrant = 'Tutorial';
  } else if (relativeParts.includes('reference')) {
    // For prose documents inside reference/ directory, we map them to quadrant = "Explanation"
    // so they can safely use the generic [[sections]] layout schema
    quadrant = 'Explanation';
  } else if (relativeParts.includes('explanation')) {
    quadrant = 'Explanation';
  }

  // Parse title and description
  let title = path.basename(filePath, '.md');

  // Match first # Title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Match first paragraph after title as description (fallback to title)
  // Clean paragraphs, ignoring blueprint blocks, HTML blocks, or other headers
  const cleanParagraphs = content
    .replace(/^#\s+.+$/m, '') // strip title
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('>') && !line.startsWith('**') && !line.startsWith('<'));

  let description = title;
  if (cleanParagraphs.length > 0) {
    description = cleanParagraphs[0].replace(/"/g, '\\"');
  }

  // Line-by-line parsing to extract headings that are NOT inside fenced code blocks (F3)
  const lines = content.split('\n');
  const headings = [];
  let inCodeBlock = false;
  let accumulatedIndex = 0;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inCodeBlock && line.startsWith('## ')) {
      const headingTitle = line.substring(3).trim();
      headings.push({
        title: headingTitle,
        index: accumulatedIndex,
        fullLength: line.length + 1, // including newline
      });
    }
    accumulatedIndex += line.length + 1; // plus newline
  }

  const sections = [];
  if (headings.length === 0) {
    // Single section document
    const cleanBody = content.replace(/^#\s+.+$/m, '').trim();
    if (cleanBody) {
      sections.push({
        heading: 'Overview',
        content: cleanBody,
      });
    }
  } else {
    // Handle content before first heading
    const firstSectionContent = content
      .substring(0, headings[0].index)
      .replace(/^#\s+.+$/m, '')
      .trim();
    if (firstSectionContent) {
      sections.push({
        heading: 'Introduction',
        content: firstSectionContent,
      });
    }

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const start = heading.index + heading.fullLength;
      const end = i + 1 < headings.length ? headings[i + 1].index : content.length;
      const sectionContent = content.substring(start, end).trim();
      sections.push({
        heading: heading.title,
        content: sectionContent,
      });
    }
  }

  // Construct TOML string using schema-compliant formats
  let toml = `title = "${title.replace(/"/g, '\\"')}"\n`;
  toml += `description = "${truncateDescription(description)}"\n`;
  toml += `quadrant = "${quadrant}"\n\n`;

  if (quadrant === 'Tutorial') {
    toml += `[prerequisites]\n`;
    toml += `knowledge_level = "Intermediate"\n`;
    toml += `tools_required = ["git", "go", "nix"]\n\n`;

    for (const sec of sections) {
      toml += `[[steps]]\n`;
      toml += `title = "${sec.heading.replace(/"/g, '\\"')}"\n`;
      const escapedContent = sec.content.replace(/"""/g, '\\"\\"\\"');
      toml += `action = """\n${escapedContent}\n"""\n`;
      toml += `expected_result = "Verification completes successfully."\n\n`;
    }
  } else if (quadrant === 'How-To') {
    toml += `[context]\n`;
    toml += `goal = "Perform procedural workspace changes."\n`;
    toml += `audience = "Developer"\n\n`;

    for (const sec of sections) {
      toml += `[[instructions]]\n`;
      toml += `step = "${sec.heading.replace(/"/g, '\\"')}"\n`;
      const escapedContent = sec.content.replace(/"""/g, '\\"\\"\\"');
      toml += `description = """\n${escapedContent}\n"""\n\n`;
    }
  } else {
    // Explanation schema
    toml += `[background]\n`;
    toml += `context = "Detailed architectural background and explanations."\n\n`;

    for (const sec of sections) {
      toml += `[[sections]]\n`;
      toml += `heading = "${sec.heading.replace(/"/g, '\\"')}"\n`;
      const escapedContent = sec.content.replace(/"""/g, '\\"\\"\\"');
      toml += `content = """\n${escapedContent}\n"""\n\n`;
    }
  }

  await fs.promises.writeFile(tomlPath, toml, 'utf8');
  console.info(`Migrated: ${relativePath} -> ${relTomlPath}`);

  // Delete original md file
  await fs.promises.unlink(filePath);
}

async function updateReferences(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf8');

  // Robust relative path regex matching folders or dot-references without word boundaries blocks
  const refRegex = /((?:\.\.?\/)?(?:reference|how-to|tutorials|explanation)\/[\w.-]+)\.md\b/g;
  const readmeRegex = /(\bREADME)\.md\b/g;
  const dotRefRegex = /(\.\/[\w.-]+)\.md\b/g;
  const dotDotRefRegex = /(\.\.\/[\w/.-]+)\.md\b/g;

  let updated = content.replace(refRegex, '$1.toml');
  updated = updated.replace(readmeRegex, '$1.toml');

  updated = updated.replace(dotRefRegex, (match, p1) => {
    if (p1.includes('remediation-report')) {
      return match;
    }
    return `${p1}.toml`;
  });
  updated = updated.replace(dotDotRefRegex, (match, p1) => {
    if (p1.includes('remediation-report')) {
      return match;
    }
    return `${p1}.toml`;
  });

  // Explicitly fix Document -> DocumentationFormatting reference updates
  updated = updated.replace(/Documentation\.md\b/g, 'DocumentationFormatting.toml');
  updated = updated.replace(/Documentation\.toml\b/g, 'DocumentationFormatting.toml');

  if (content !== updated) {
    await fs.promises.writeFile(filePath, updated, 'utf8');
    console.info(`Updated references in: ${path.relative(process.cwd(), filePath)}`);
  }
}

async function main() {
  const mdFiles = await getFilesRecursively(docsDir, '.md');
  console.info(`Found ${mdFiles.length} Markdown files to migrate.`);

  for (const file of mdFiles) {
    await migrateFile(file);
  }

  // Phase 2: Search and replace .md with .toml references in the newly created .toml files
  const tomlFiles = await getFilesRecursively(docsDir, '.toml');
  for (const file of tomlFiles) {
    await updateReferences(file);
  }

  console.info('Migration completed successfully!');
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exitCode = 1;
});
