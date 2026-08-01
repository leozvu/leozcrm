import { runAdvisorGoldenEval } from './integrations/advisor/advisorGoldenEval';
import { OpenAIResponsesAdvisorProvider } from './integrations/advisor/openaiResponsesAdvisorProvider';

const LIVE_ACK = 'I_UNDERSTAND_THIS_CALLS_OPENAI';

async function main(): Promise<void> {
  if (process.env.LEOZOPS_RUN_LIVE_OPENAI_EVAL !== LIVE_ACK) {
    throw new Error(`Set LEOZOPS_RUN_LIVE_OPENAI_EVAL=${LIVE_ACK} to authorize this billable eval run.`);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the live Advisor eval.');
  const provider = new OpenAIResponsesAdvisorProvider({ apiKey });
  const report = await runAdvisorGoldenEval(provider);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.accepted) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Advisor eval failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
