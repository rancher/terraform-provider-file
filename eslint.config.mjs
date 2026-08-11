export default [
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      // Per .agent/rules/github-script.instructions.md: Use core.* instead of console.*
      "no-console": "error",
    },
  },
  {
    files: [".agent/hooks/**/*.js"],
    rules: {
      // Local agent hooks run outside Actions environment and must use console streams to report decisions
      "no-console": "off",
    },
  },
];
