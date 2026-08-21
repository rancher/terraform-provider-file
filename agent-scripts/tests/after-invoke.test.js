import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  saveReport,
  verifyTestReport,
  verifyReviewReport,
  validateTestContent,
  validateReviewContent,
} from '../after-invoke.js';

test('after-invoke.js: subagent report parsing unit tests', async (t) => {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const tempHome = path.resolve(`/tmp/gemini-after-invoke-test-${uniqueId}`);
  const tempTmpDir = path.resolve(tempHome, '.gemini/tmp/terraform-provider-file');

  fs.mkdirSync(tempTmpDir, { recursive: true });

  t.after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  await t.test('saveReport writes report markdown correctly', () => {
    const logsDir = path.join(tempTmpDir, 'logs');
    saveReport('testing-agent', 'Standard Report Content', logsDir);

    const reportFile = path.join(logsDir, 'testing-agent_report.md');
    assert.strictEqual(fs.existsSync(reportFile), true);
    assert.strictEqual(fs.readFileSync(reportFile, 'utf-8'), 'Standard Report Content');
  });

  await t.test('validateTestContent rejects structurally incomplete test reports', () => {
    const invalidReport = 'TEST RUN status: 🟢 SUCCESS';
    const validation = validateTestContent(invalidReport);
    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.errors.length, 2); // missing lint and execution details
  });

  await t.test('validateTestContent approves compliant test reports', () => {
    const validReport =
      'TEST RUN status: 🟢 SUCCESS\nStatic Analysis & Linters Audit: passed\nUnit Tests & Test Suites Audit: all passed';
    const validation = validateTestContent(validReport);
    assert.strictEqual(validation.valid, true);
  });

  await t.test('verifyTestReport signs Gate 2 when report indicates SUCCESS and is structurally complete', () => {
    const testApprovalFile = path.join(tempTmpDir, 'test-approval.json');
    const report =
      'TEST RUN status: 🟢 SUCCESS\nStatic Analysis & Linters Audit: passed\nUnit Tests & Test Suites Audit: all passed';

    // Write mock logs for empirical validation
    fs.writeFileSync(path.join(process.cwd(), 'report.json'), '{"Action":"pass"}\n');
    fs.writeFileSync(path.join(process.cwd(), 'node-test.log'), 'ok 1 - test\n');

    const result = verifyTestReport(report, 'diff123', 'plan123', testApprovalFile);

    assert.strictEqual(result.status, 'approved');
    assert.strictEqual(fs.existsSync(testApprovalFile), true);
    const content = JSON.parse(fs.readFileSync(testApprovalFile, 'utf-8'));
    assert.strictEqual(content.status, 'approved');
    assert.strictEqual(content.diff_hash, 'diff123');
    assert.strictEqual(content.plan_hash, 'plan123');
  });

  await t.test('verifyTestReport rejects Gate 2 when Go test log contains failures', () => {
    const testApprovalFile = path.join(tempTmpDir, 'test-approval.json');
    const report =
      'TEST RUN status: 🟢 SUCCESS\nStatic Analysis & Linters Audit: passed\nUnit Tests & Test Suites Audit: all passed';

    // Write failing Go test log
    fs.writeFileSync(path.join(process.cwd(), 'report.json'), '{"Action":"fail","Package":"pkg","Test":"TestFail"}\n');
    fs.writeFileSync(path.join(process.cwd(), 'node-test.log'), 'ok 1 - test\n');

    const result = verifyTestReport(report, 'diff123', 'plan123', testApprovalFile);

    assert.strictEqual(result.status, 'rejected');
    assert.ok(result.systemMessage.includes('Empirical Go Test Failure'));
    assert.strictEqual(fs.existsSync(testApprovalFile), false);

    // Clean up
    try {
      fs.unlinkSync(path.join(process.cwd(), 'report.json'));
      fs.unlinkSync(path.join(process.cwd(), 'node-test.log'));
    } catch {}
  });

  await t.test('verifyTestReport rejects Gate 2 when Node test log contains failures', () => {
    const testApprovalFile = path.join(tempTmpDir, 'test-approval.json');
    const report =
      'TEST RUN status: 🟢 SUCCESS\nStatic Analysis & Linters Audit: passed\nUnit Tests & Test Suites Audit: all passed';

    // Write failing Node test log
    fs.writeFileSync(path.join(process.cwd(), 'report.json'), '{"Action":"pass"}\n');
    fs.writeFileSync(path.join(process.cwd(), 'node-test.log'), 'not ok 1 - test failed\n');

    const result = verifyTestReport(report, 'diff123', 'plan123', testApprovalFile);

    assert.strictEqual(result.status, 'rejected');
    assert.ok(result.systemMessage.includes('Empirical Node Test Failure'));
    assert.strictEqual(fs.existsSync(testApprovalFile), false);

    // Clean up
    try {
      fs.unlinkSync(path.join(process.cwd(), 'report.json'));
      fs.unlinkSync(path.join(process.cwd(), 'node-test.log'));
    } catch {}
  });

  await t.test('verifyTestReport revokes Gate 2 when report indicates FAILURE', () => {
    const testApprovalFile = path.join(tempTmpDir, 'test-approval.json');
    fs.writeFileSync(testApprovalFile, JSON.stringify({ status: 'approved' }));

    const result = verifyTestReport('TEST RUN status: 🔴 FAILED', 'diff123', 'plan123', testApprovalFile);

    assert.strictEqual(result.status, 'rejected');
    assert.strictEqual(fs.existsSync(testApprovalFile), false);
  });

  await t.test('validateReviewContent rejects structurally incomplete review reports', () => {
    const invalidReport = 'PR Review status: 🟢 PERFECT - 0 findings.';
    const validation = validateReviewContent(invalidReport);
    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.errors.length, 4); // missing security, standards, spelling, automation audit
  });

  await t.test('validateReviewContent approves compliant review reports', () => {
    const validReport =
      'PR Review status: 🟢 PERFECT - 0 findings.\nSecurity Audit: passed\nCoding Standards Audit: compliant\nSpelling & Wording Audit: checked\nAutomation Audit: checked';
    const validation = validateReviewContent(validReport);
    assert.strictEqual(validation.valid, true);
  });

  await t.test('verifyReviewReport blocks signature if Gate 2 is missing', () => {
    const testApprovalFile = path.join(tempTmpDir, 'test-approval.json');
    const reviewApprovalFile = path.join(tempTmpDir, 'review-approval.json');
    fs.rmSync(testApprovalFile, { force: true });

    const report =
      'PR Review status: 🟢 PERFECT - 0 findings.\nSecurity Audit: passed\nCoding Standards Audit: compliant\nSpelling & Wording Audit: checked\nAutomation Audit: checked';
    const result = verifyReviewReport(report, 'diff123', 'plan123', reviewApprovalFile, testApprovalFile);

    assert.strictEqual(result.status, 'gated');
    assert.strictEqual(fs.existsSync(reviewApprovalFile), false);
  });
});
