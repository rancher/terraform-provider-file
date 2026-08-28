# Enforce Strict Cryptographic Gating for Approvals

## Objective

Update the Agentic Framework to strictly require cryptographic SSH signatures for all phase approvals. If a user's SSH keys or `ssh-agent` are not configured properly, the system should fail securely and provide explicit instructions on how to set them up.

## Implementation Steps

- [ ] **Revert Fallback Logic**: Remove the unsigned fallback logic previously added to `agent-scripts/after-ask.js` and `agent-scripts/gating.js` to ensure that `.sig` files and public keys are strictly required.
- [ ] **Update Plan Hook**: Modify `.gemini/hooks/02-plan/askUserLogic.js` (`afterAskUserPlan`) to call `deny(...)` if `hasValidSigningKey()` is false. Provide a "Fail-Forward" message instructing the user to generate an SSH key (`ssh-keygen -t ed25519 -f ~/.gemini/ssh-key`), start their `ssh-agent`, and run `ssh-add ~/.gemini/ssh-key`.
- [ ] **Update Commit Hook**: Modify `.gemini/hooks/04-commit/commitLogic.js` (`afterAskUserCommit`) to apply the same `deny(...)` logic with setup instructions if the signing key is unavailable.
- [ ] **Update E2E Tests**: Modify the unsigned fallback test in `agent-scripts/tests/hooks-e2e.test.js` to assert that the hook properly denies the request and outputs the setup instructions when the SSH agent is missing.

## Verification, Testing, and Compliance

- [ ] Execute comprehensive testing by running the test suites in `agent-scripts/tests/` to ensure the updated hooks and security checks function as expected.
- [ ] Ensure that we enforce the standard quality gates by strictly requiring `.sig` files and valid SSH keys.
- [ ] Maintain the agentic framework if improvements or bugs are found during the implementation phase.
- [ ] Ensure documentation is properly updated.
