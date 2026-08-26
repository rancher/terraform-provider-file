import { handleCommitApproval } from './agent-scripts/after-ask.js';
const targetDir = '/Users/matt.trachier/.gemini/tmp/terraform-provider-file';
const pubKeyFile = '/Users/matt.trachier/.gemini/ssh-key.pub';
const promptText = 'Commit Message: "chore: optimize shell environment variables, functions, and aliases"';
handleCommitApproval(targetDir, pubKeyFile, promptText);
