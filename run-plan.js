import { handlePlanApproval } from './agent-scripts/after-ask.js';
const targetDir = '/Users/matt.trachier/.gemini/tmp/terraform-provider-file';
const pubKeyFile = '/Users/matt.trachier/.gemini/ssh-key.pub';
const promptText = '# Plan: Fix PS1 Terminal Line Wrapping Issue';
handlePlanApproval(targetDir, pubKeyFile, promptText);
