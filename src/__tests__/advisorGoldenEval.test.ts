import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISOR_ANSWER_VERSION,
  AdvisorModelProvider,
} from '../domain/advisorConversation';
import {
  ADVISOR_GOLDEN_CASES,
  ADVISOR_GOLDEN_EVIDENCE,
  runAdvisorGoldenEval,
} from '../integrations/advisor/advisorGoldenEval';

class GoldenProvider implements AdvisorModelProvider {
  readonly key = 'golden-scripted';
  readonly version = '1';

  async answer(input: Parameters<AdvisorModelProvider['answer']>[0], _signal: AbortSignal) {
    const golden = ADVISOR_GOLDEN_CASES.find((item) => item.question === input.question)!;
    const key = golden.expectedAnyEvidenceKey?.[0];
    return {
      answer: {
        answer_version: ADVISOR_ANSWER_VERSION,
        summary: {
          statement: golden.expectedCannotAnswer ? 'The approved evidence is insufficient.' : 'Grounded answer.',
          evidence_keys: key ? [key] : [],
        },
        facts: [],
        inferences: [],
        recommendations: [],
        limitations: key ? [{ statement: 'Evidence boundary.', evidence_keys: [key] }] : [],
        cannot_answer: golden.expectedCannotAnswer,
        advisory_only: true,
      },
      usage: { input_units: 100, output_units: 20, cost_microunits: 10 },
    };
  }
}

test('expanded golden evaluator requires perfect contract and at least 90% behavior', async () => {
  const report = await runAdvisorGoldenEval(new GoldenProvider());
  assert.equal(ADVISOR_GOLDEN_CASES.length, 12);
  assert.equal(ADVISOR_GOLDEN_EVIDENCE.items.length, 6);
  assert.equal(report.caseCount, 12);
  assert.equal(report.contractPassRate, 1);
  assert.equal(report.behaviorPassRate, 1);
  assert.equal(report.totalCostMicrounits, 120);
  assert.equal(report.accepted, true);
  assert.deepEqual(report.thresholds, { contractPassRate: 1, behaviorPassRate: 0.9 });
});

test('one invalid provider answer fails the perfect contract threshold', async () => {
  let calls = 0;
  const provider: AdvisorModelProvider = {
    key: 'one-invalid',
    version: '1',
    async answer(input, signal) {
      calls += 1;
      if (calls === 1) return { answer: {}, usage: { input_units: 1, output_units: 1, cost_microunits: 1 } };
      return new GoldenProvider().answer(input, signal);
    },
  };
  const report = await runAdvisorGoldenEval(provider);
  assert.equal(report.contractPassRate, 11 / 12);
  assert.equal(report.accepted, false);
  assert.equal(report.cases[0].failureCode, 'invalid_provider_answer');
});
