# Enforce Strict TOML Ask-User Intent Validation and Fail-Forward Messaging

## Objective

Update the agentic framework to enforce a strict allowlist of intents for all `ask_user` tool calls, eliminating "silent allows" and guiding agents through security blocks via explicit "Fail-Forward" denial messages.

## Implementation Steps

- [ ] **Create an Intent Allowlist**: Define a strict list of allowed intents in `.gemini/hooks/shared.js` (or a similar central location).
  - Allowed Intents: `plan approval`, `commit approval`, `clarification`, `suggest action`, `question`, `feedback`.
- [ ] **Enforce Intent Allowlist**: Update the universal `validateAskUser` function to immediately `deny` any `ask_user` call where the `intent` is not in the allowlist. The denial reason must explicitly list the allowed intents to guide the agent.
- [ ] **Fix Silent Allows in Phase Hooks**:
  - Modify `.gemini/hooks/02-plan/askUserLogic.js` to replace `allow(..., warning)` with a hard `deny(...)` if the agent provides planning fields without using the `plan approval` intent.
  - Modify `.gemini/hooks/04-commit/commitLogic.js` to replace `allow(..., warning)` with a hard `deny(...)` if the agent provides commit fields without using the `commit approval` intent.
- [ ] **Update Security Rejections (Fail-Forward)**: Modify `agent-scripts/security.js` to update the rejection reasons in `verifyGitCommand`. These rejections must include explicit instructions on the correct tool and `intent` to use.
- [ ] **Update Documentation**: Update `docs/development/AgenticFramework/AskUserComponent.md` to:
  - Explicitly define the new strict allowlist of intents.
  - Provide a clear, copy-pasteable TOML template and a descriptive explanation for _each_ of the allowed intents.

## Verification, Testing, and Compliance

- [ ] Execute comprehensive testing by running the test suites in `agent-scripts/tests/` to ensure the updated hooks and security checks function as expected.
- [ ] Ensure that we enforce the standard quality gates by verifying all `ask_user` TOML intents.
- [ ] Maintain the agentic framework if improvements or bugs are found during the implementation phase.
- [ ] Ensure documentation is properly updated.
