# Enforce Strict Question Types and Restore Pipeline Logs

## Objective

Update the Agentic Framework to enforce strict, deterministic `yesno` question types for all cryptographic approval requests, eliminating parsing ambiguity. Simultaneously, restore the missing terminal output from the automated `commit-push.sh` and `create-pr.sh` pipelines.

## Implementation Steps

- [ ] **Enforce `yesno` Question Type**: Modify `validateAskUser` in `.gemini/hooks/shared.js`. If the intent is `plan approval` or `commit approval`, strictly verify that `tool_input.questions[0].type === "yesno"`. If it is not, immediately `deny` the request with explicit instructions to fix it.
- [ ] **Simplify Approval Parsers**: Update `afterAskUserPlan` (`askUserLogic.js`) and `afterAskUserCommit` (`commitLogic.js`). Since we are enforcing `yesno` strictly, we can simplify `isApproved` to simply check `answerText.toLowerCase() === 'yes'`.
- [ ] **Restore Pipeline Logs**: Modify `handleCommitApproval` in `agent-scripts/after-ask.js`. When executing `commit-push.sh` and `create-pr.sh` with `stdio: ['ignore', 'pipe', 'pipe']`, capture the returned byte buffers and explicitly print them via `console.error` to restore the live terminal output logs to the user on success.
- [ ] **Update Documentation**: Update `docs/development/AgenticFramework/AskUserComponent.md` to document that the `type` parameter must be `"yesno"` for approval intents.
- [ ] **Verify E2E Tests**: Ensure `hooks-e2e.test.js` passes with these new strict constraints.

## Verification & Testing

- [ ] Execute comprehensive testing by running the test suites in `agent-scripts/tests/` to ensure all 58 tests pass successfully.
- [ ] Maintain the agentic framework if improvements or bugs are found during the implementation phase.
