#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Skip node_modules and .git
      if (file !== 'node_modules' && file !== '.git') {
        getFiles(filePath, fileList);
      }
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function checkCatchInFiles() {
  const rootDir = process.cwd();
  const files = getFiles(rootDir);
  let failed = false;

  console.log(`🔍 Scanning ${files.length} JavaScript files for 'catch' statements without an explicit error binding...`);

  for (const file of files) {
    // Relative path for cleaner output
    const relativePath = path.relative(rootDir, file);
    let content = fs.readFileSync(file, 'utf-8');

    // Strip block comments while preserving line count
    content = content.replace(/\/\*[\s\S]*?\*\//g, (match) => '\n'.repeat(match.split('\n').length - 1));
    // Strip single line comments
    content = content.replace(/\/\/.*$/gm, '');
    // Strip double-quoted, single-quoted, and template string literals
    content = content.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""');
    content = content.replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "''");
    content = content.replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, "``");

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const catchRegex = /\bcatch\b/g;
      let match;

      while ((match = catchRegex.exec(line)) !== null) {
        // Ignore property/method calls (e.g. promise.catch(...))
        const beforeCatch = line.slice(0, match.index).trim();
        if (beforeCatch.endsWith('.')) {
          continue;
        }

        const remaining = line.slice(match.index + 5).trim();
        // Match a valid parenthesis-enclosed variable parameter, e.g. (err), (error), (e)
        const hasParam = /^\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)/.test(remaining);
        if (!hasParam) {
          console.log(`❌ Violation: 'catch' statement without an explicit error binding found at ${relativePath}:${i + 1}`);
          console.log(`   Line: ${line.trim()}`);
          failed = true;
        }
      }
    }
  }

  if (failed) {
    console.log('\n🔴 Audit Failed: One or more catch statements violate the policy.');
    process.exit(1);
  } else {
    console.log("\n🟢 Audit Passed: All catch statements comply with explicit error binding policy!");
    process.exit(0);
  }
}

checkCatchInFiles();
