import {
  ADVISOR_ANSWER_VERSION,
  AdvisorAnswer,
  AdvisorEvidenceItem,
  AdvisorModelProvider,
  AdvisorProviderInput,
  AdvisorProviderResult,
  AdvisorStatement,
} from '../../domain/advisorConversation';
import { AdvisorReadToolRegistry } from './advisorReadToolRegistry';

function statement(text: string, ...evidenceKeys: string[]): AdvisorStatement {
  return { statement: text, evidence_keys: evidenceKeys };
}

function byKey(input: AdvisorProviderInput): Map<string, AdvisorEvidenceItem> {
  return new Map(input.evidence.items.map((item) => [item.key, item]));
}

function value(rows: Map<string, AdvisorEvidenceItem>, key: string): string | number | boolean | null {
  const found = rows.get(key);
  if (!found) throw new Error(`deterministic provider is missing evidence ${key}`);
  return found.value;
}

function answer(input: Partial<AdvisorAnswer> & Pick<AdvisorAnswer, 'summary'>): AdvisorAnswer {
  return {
    answer_version: ADVISOR_ANSWER_VERSION,
    summary: input.summary,
    facts: input.facts ?? [],
    inferences: input.inferences ?? [],
    recommendations: input.recommendations ?? [],
    limitations: input.limitations ?? [],
    cannot_answer: input.cannot_answer ?? false,
    advisory_only: true,
  };
}

function limitationStatements(rows: Map<string, AdvisorEvidenceItem>): AdvisorStatement[] {
  return [...rows.values()]
    .filter((item) => item.key.startsWith('brief.limitation.'))
    .slice(0, 8)
    .map((item) => statement(String(item.value), item.key));
}

function isVietnamese(question: string): boolean {
  return /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]|\b(bao nhiêu|tình hình|tỷ lệ|nguồn|hạn chế|mục tiêu|quyết định)\b/i.test(question);
}

/**
 * Safe local provider used by Phase 9A and tests. It has no network, secret,
 * generic tool, or action capability. A production language-model adapter is a
 * later separately reviewed integration behind the same contract.
 */
export class DeterministicAdvisorProvider implements AdvisorModelProvider {
  readonly key = 'deterministic_readonly';
  readonly version = '1.0.0';
  private readonly tools = new AdvisorReadToolRegistry();

  async answer(input: AdvisorProviderInput, signal: AbortSignal): Promise<AdvisorProviderResult> {
    if (signal.aborted) throw new DOMException('advisor request aborted', 'AbortError');
    const rows = byKey(input);
    const question = input.question.trim().toLowerCase();
    const vi = isVietnamese(question);
    let output: AdvisorAnswer;

    if (/ignore (all|previous)|bỏ qua (mọi|chỉ dẫn)|system prompt|developer message|api[_ -]?key|bearer token/i.test(question)) {
      output = answer({
        summary: statement(vi
          ? 'Tôi không làm theo chỉ dẫn nhằm thay đổi nguồn sự thật hoặc quyền hạn.'
          : 'I cannot follow instructions that try to change the evidence or authority boundary.'),
        limitations: limitationStatements(rows),
        cannot_answer: true,
      });
    } else if (/\b(delete|execute|send|publish|create task|update record)\b|\b(xóa|thực thi|gửi|đăng bài|tạo task|cập nhật bản ghi)\b/i.test(question)) {
      output = answer({
        summary: statement(vi
          ? 'Ask LeozOps hiện chỉ tư vấn từ dữ liệu đã duyệt và không thể thực thi hành động.'
          : 'Ask LeozOps is advisory-only and cannot execute an operational action.'),
        limitations: limitationStatements(rows),
        cannot_answer: true,
      });
    } else if (/histor|trend|so sánh|tháng trước|tuần trước|conversion|chuyển đổi theo thời gian/i.test(question)) {
      const key = 'brief.limitation.current_state_only';
      output = answer({
        summary: statement(vi
          ? 'Chưa thể trả lời so sánh lịch sử vì nguồn hiện chỉ có trạng thái hiện tại.'
          : 'Historical comparison is unavailable because the source contains current state only.', key),
        limitations: rows.has(key) ? [statement(String(value(rows, key)), key)] : limitationStatements(rows),
        cannot_answer: true,
      });
    } else if (/win rate|tỷ lệ thắng|ti le thang/i.test(question)) {
      const rateKey = 'brief.headline.win_rate';
      const closedKey = 'brief.headline.closed';
      const rate = value(rows, rateKey);
      const text = rate === null
        ? (vi ? 'Chưa có đủ kết quả đóng để tính tỷ lệ thắng.' : 'There are no closed outcomes, so win rate is undefined.')
        : (vi ? `Tỷ lệ thắng theo trạng thái hiện tại là ${Math.round(Number(rate) * 10_000) / 100}%.` : `Current-state win rate is ${Math.round(Number(rate) * 10_000) / 100}%.`);
      output = answer({
        summary: statement(text, rateKey, closedKey),
        facts: [statement(
          vi ? `Có ${value(rows, closedKey)} kết quả đã đóng.` : `There are ${value(rows, closedKey)} closed outcomes.`,
          closedKey,
        )],
        limitations: rows.has('brief.limitation.current_state_only')
          ? [statement(String(value(rows, 'brief.limitation.current_state_only')), 'brief.limitation.current_state_only')]
          : [],
      });
    } else if (/stage|funnel|giai đoạn|phễu/i.test(question)) {
      const stages = this.tools.read('funnel_state', input.evidence)
        .filter((item) => /^brief\.stage\.[^.]+\.count$/.test(item.key));
      output = answer({
        summary: statement(
          vi ? 'Đây là phân bổ lead theo trạng thái hiện tại.' : 'This is the current-state lead distribution by stage.',
          ...stages.map((item) => item.key),
        ),
        facts: stages.map((item) => statement(`${item.label}: ${item.value}.`, item.key)),
        limitations: rows.has('brief.limitation.current_state_only')
          ? [statement(String(value(rows, 'brief.limitation.current_state_only')), 'brief.limitation.current_state_only')]
          : [],
      });
    } else if (/source|nguồn/i.test(question)) {
      const sources = this.tools.read('source_mix', input.evidence)
        .filter((item) => /^brief\.source\.[^.]+\.count$/.test(item.key));
      output = answer({
        summary: statement(
          vi ? 'Đây là phân bổ lead theo nguồn an toàn để hiển thị.' : 'This is the lead distribution by presentation-safe source.',
          ...sources.map((item) => item.key),
        ),
        facts: sources.map((item) => statement(`${item.label}: ${item.value}.`, item.key)),
        limitations: rows.has('brief.limitation.campaign_and_spend_unavailable')
          ? [statement(
            String(value(rows, 'brief.limitation.campaign_and_spend_unavailable')),
            'brief.limitation.campaign_and_spend_unavailable',
          )]
          : [],
      });
    } else if (/fresh|stale|cập nhật|mới nhất|tuổi dữ liệu/i.test(question)) {
      const statusKey = 'brief.freshness.status';
      const ageKey = 'brief.freshness.age_seconds';
      const timeKey = 'brief.freshness.source_generated_at';
      output = answer({
        summary: statement(
          vi
            ? `Trạng thái dữ liệu là ${value(rows, statusKey)}, tuổi dữ liệu ${value(rows, ageKey)} giây.`
            : `Data is ${value(rows, statusKey)} and ${value(rows, ageKey)} seconds old.`,
          statusKey,
          ageKey,
        ),
        facts: [statement(
          vi ? `Nguồn tạo snapshot lúc ${value(rows, timeKey)}.` : `The source generated the snapshot at ${value(rows, timeKey)}.`,
          timeKey,
        )],
      });
    } else if (/goal|constraint|decision|mục tiêu|ràng buộc|quyết định/i.test(question)) {
      const context = this.tools.read('business_context', input.evidence);
      output = context.length === 0
        ? answer({
          summary: statement(vi ? 'Chưa có business context phù hợp được ghi nhận.' : 'No matching business context has been recorded.'),
          limitations: limitationStatements(rows),
          cannot_answer: true,
        })
        : answer({
          summary: statement(
            vi ? 'Đây là business context hiện hành đã được ghi nhận.' : 'These are the currently recorded business-context entries.',
            ...context.map((item) => item.key),
          ),
          facts: context.map((item) => statement(`${item.label}: ${item.value}`, item.key)),
        });
    } else if (/overdue|quá hạn|owner|phụ trách|estimated value|giá trị/i.test(question)) {
      const keys = [
        'brief.headline.overdue_expected_close',
        'brief.headline.active_owner_coverage',
        'brief.headline.active_estimated_value',
      ];
      output = answer({
        summary: statement(
          vi ? 'Đây là các tín hiệu vận hành hiện tại của pipeline.' : 'These are the current pipeline operating signals.',
          ...keys,
        ),
        facts: keys.map((key) => statement(`${rows.get(key)?.label}: ${value(rows, key)}.`, key)),
        limitations: rows.has('brief.limitation.estimated_value_currency_unavailable')
          ? [statement(
            String(value(rows, 'brief.limitation.estimated_value_currency_unavailable')),
            'brief.limitation.estimated_value_currency_unavailable',
          )]
          : [],
      });
    } else if (/how many|total lead|bao nhiêu|tổng.*lead/i.test(question)) {
      const totalKey = 'brief.headline.total_leads';
      output = answer({
        summary: statement(
          vi ? `Snapshot hiện có ${value(rows, totalKey)} lead.` : `The current snapshot contains ${value(rows, totalKey)} leads.`,
          totalKey,
        ),
        facts: [statement(`${rows.get(totalKey)?.label}: ${value(rows, totalKey)}.`, totalKey)],
      });
    } else if (/overview|tình hình|tong quan|pipeline|business/i.test(question)) {
      const totalKey = 'brief.headline.total_leads';
      const activeKey = 'brief.headline.active_pipeline';
      const wonKey = 'brief.headline.won';
      const lostKey = 'brief.headline.lost';
      output = answer({
        summary: statement(
          vi
            ? `Hiện có ${value(rows, totalKey)} lead, trong đó ${value(rows, activeKey)} đang ở pipeline hoạt động.`
            : `There are ${value(rows, totalKey)} leads, with ${value(rows, activeKey)} in the active pipeline.`,
          totalKey,
          activeKey,
        ),
        facts: [
          statement(vi ? `Đã thắng ${value(rows, wonKey)} lead.` : `${value(rows, wonKey)} leads are won.`, wonKey),
          statement(vi ? `Đã mất ${value(rows, lostKey)} lead.` : `${value(rows, lostKey)} leads are lost.`, lostKey),
        ],
        recommendations: value(rows, 'brief.headline.overdue_expected_close') as number > 0
          ? [statement(
            vi ? 'Nên rà soát các lead đã quá thời điểm dự kiến chốt.' : 'Review leads whose expected close time has passed.',
            'brief.headline.overdue_expected_close',
          )]
          : [],
        limitations: limitationStatements(rows).slice(0, 2),
      });
    } else {
      output = answer({
        summary: statement(vi
          ? 'Chưa có đủ dữ liệu hoặc typed read tool để trả lời câu hỏi này.'
          : 'The approved evidence and typed read tools do not support this question yet.'),
        limitations: limitationStatements(rows),
        cannot_answer: true,
      });
    }

    const serialized = JSON.stringify(output);
    return {
      answer: output,
      usage: {
        input_units: Math.ceil((input.question.length + JSON.stringify(input.evidence).length) / 4),
        output_units: Math.ceil(serialized.length / 4),
        cost_microunits: 0,
      },
    };
  }
}
