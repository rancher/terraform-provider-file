#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

async function cleanDir(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }
}

async function runCommand(file, args, cwd, extraEnv = {}) {
  const cleanEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
  };

  const mergedEnv = {
    ...cleanEnv,
    ...extraEnv,
  };

  try {
    const { stdout, stderr } = await execFileAsync(file, args, { cwd, env: mergedEnv });
    return { stdout, stderr, success: true };
  } catch (err) {
    console.error(`❌ Command failed: "${file} ${args.join(' ')}" in ${cwd || process.cwd()}`);
    console.error(err.stderr || err.message);
    return { error: err, success: false };
  }
}

async function main() {
  const repoUrl = 'https://github.com/google-gemini/gemini-cli.git';
  const tag = '6a466a7e2fe2b1255752c1e74f69b31f0216084d';
  const tmpDir = path.join(process.cwd(), '.tmp-gemini-sdk');

  const destSdk = path.join(process.cwd(), 'node_modules', '@google', 'gemini-cli-sdk');
  const destCore = path.join(process.cwd(), 'node_modules', '@google', 'gemini-cli-core');

  // Prepend local bin directories to ensure tools like tsc are directly in PATH
  const localBin = path.join(tmpDir, 'node_modules', '.bin');
  const pathWithLocalBin = `${localBin}:${process.env.PATH}`;
  const runEnv = {
    PATH: pathWithLocalBin,
  };

  console.log(`🤖 [Programmatic SDK Installer] Starting setup for @google/gemini-cli-sdk...`);

  // 1. Clean up stale directories
  await cleanDir(tmpDir);
  await cleanDir(destSdk);
  await cleanDir(destCore);

  try {
    // 2. Clone the repository single branch/tag
    console.log(`Cloning gemini-cli repository at commit ${tag}...`);
    const cloneRes = await runCommand('git', ['clone', repoUrl, tmpDir, '--quiet'], null, runEnv);
    if (!cloneRes.success) {
      throw new Error('Failed to clone repository');
    }

    const resetRes = await runCommand('git', ['reset', '--hard', tag, '--quiet'], tmpDir, runEnv);
    if (!resetRes.success) {
      throw new Error('Failed to reset repository to correct commit');
    }

    // 3. Install repository dependencies and build SDK workspace
    console.log(`Installing repository workspace dependencies...`);
    const installRes = await runCommand('npm', ['install', '--silent'], tmpDir, runEnv);
    if (!installRes.success) {
      throw new Error('Failed to install repo workspace dependencies');
    }

    console.log(`Compiling workspaces and building @google/gemini-cli-sdk...`);
    const buildRes = await runCommand('npm', ['run', 'build', '--workspace=@google/gemini-cli-sdk'], tmpDir, runEnv);
    if (!buildRes.success) {
      throw new Error('Failed to build gemini-cli-sdk');
    }

    // 4. Create destination directories in node_modules
    await fs.mkdir(destSdk, { recursive: true });
    await fs.mkdir(destCore, { recursive: true });

    // Helper to copy non-typescript files from src to dist/src
    async function copyNonTsFiles(src, dest) {
      try {
        await fs.cp(src, dest, {
          recursive: true,
          filter: (fileSrc) => {
            const isTs = fileSrc.endsWith('.ts') || fileSrc.endsWith('.tsx');
            return !isTs;
          },
        });
      } catch (err) {
        console.warn(`⚠️ Note: could not copy assets from ${src} to ${dest}: ${err.message}`);
      }
    }

    // 5. Copy built outputs into our node_modules
    console.log(`Installing built assets to local node_modules...`);

    // Copy SDK
    await fs.cp(path.join(tmpDir, 'packages', 'sdk', 'package.json'), path.join(destSdk, 'package.json'));
    await fs.cp(path.join(tmpDir, 'packages', 'sdk', 'dist'), path.join(destSdk, 'dist'), { recursive: true });
    await copyNonTsFiles(path.join(tmpDir, 'packages', 'sdk', 'src'), path.join(destSdk, 'dist', 'src'));

    // Copy Core
    await fs.cp(path.join(tmpDir, 'packages', 'core', 'package.json'), path.join(destCore, 'package.json'));
    await fs.cp(path.join(tmpDir, 'packages', 'core', 'dist'), path.join(destCore, 'dist'), { recursive: true });
    await copyNonTsFiles(path.join(tmpDir, 'packages', 'core', 'src'), path.join(destCore, 'dist', 'src'));

    console.log(`✅ Programs successfully installed!`);
  } catch (error) {
    console.error(`❌ Setup failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    // 6. Clean up temporary checkout directory
    console.log(`Cleaning up temporary files...`);
    try {
      await cleanDir(tmpDir);
    } catch (cleanupError) {
      console.error(`⚠️ Warning during cleanup: ${cleanupError.message}`);
    }
  }
}

main();
