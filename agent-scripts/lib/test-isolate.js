import { runAgentSession } from './agent-runner.js';

async function testIsolate() {
  console.log('Testing isolated mode...');
  try {
    const text = await runAgentSession({
      initialPrompt: 'Respond with exactly the word "Hello". Do not use any tools.',
      requestedModel: 'gemini-3.5-flash',
      isolate: true,
    });
    console.log('\nOutput from isolated agent:', text);
    console.log('\nIsolate test passed (agent ran without crashing).');
  } catch (err) {
    console.error('\nIsolate test failed:', err);
    process.exit(1);
  }
}

testIsolate();
