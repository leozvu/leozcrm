import { timingSafeEqual } from 'node:crypto';
import { credentialFingerprint } from './g6Policy';
import { evidenceFingerprint } from './phase2Proof';
import type { ActivationCeremonyPolicyManifest } from './activationCeremonyPolicy';
import type { ExternalEvidenceType } from './externalEvidencePolicy';

export const PHASE7_TABLES = {
  policies: 'activation_ceremony_policies',
  dossiers: 'activation_ceremony_dossiers',
  verifications: 'activation_ceremony_verifications',
  handoffs: 'activation_ceremony_handoffs',
  recalls: 'activation_ceremony_recalls',
  events: 'activation_ceremony_events',
} as const;

export type ActivationVerificationDecision = 'approved' | 'rejected';
export type ActivationHandoffStatus = 'rehearsal_handoff_sealed' | 'production_handoff_sealed_external_execution_required';
export type ActivationEventType =
  | 'policy_accepted'
  | 'dossier_created'
  | 'dossier_approved'
  | 'dossier_rejected'
  | 'handoff_sealed'
  | 'handoff_recalled';

export interface ActivationCeremonyPolicyRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  phase6_policy_record_id: string;
  policy_id: string;
  environment: 'test' | 'production';
  phase6_policy_fingerprint: string;
  phase6_assessment_fingerprint: string;
  target_fingerprint: string;
  valid_from: string;
  valid_until: string;
  policy_fingerprint: string;
  manifest_json: string;
  accepted_at: string;
  created_at: string;
}

export interface ActivationDossierFacts {
  created_at: string;
  phase6_assessed_at: string;
  phase6_evidence_set_fingerprint: string;
  evidence: Array<{
    evidence_type: ExternalEvidenceType;
    attestation_id: string;
    envelope_fingerprint: string;
  }>;
  deployment_id: string;
  target_fingerprint: string;
  target_contract_fingerprint: string;
  canary_contract_fingerprint: string;
  rollback_contract_fingerprint: string;
}

export interface ActivationCeremonyDossierRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  dossier_key: string;
  policy_fingerprint: string;
  phase6_assessment_fingerprint: string;
  facts_json: string;
  facts_fingerprint: string;
  status: 'candidate';
  created_by: string;
  created_at: string;
  dossier_fingerprint: string;
}

export interface ActivationCeremonyVerificationRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  dossier_id: string;
  verification_key: string;
  dossier_fingerprint: string;
  decision: ActivationVerificationDecision;
  reason_code: string;
  verified_by: string;
  verified_at: string;
  expires_at: string;
  verification_fingerprint: string;
  created_at: string;
}

export interface ActivationCeremonyHandoffRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  dossier_id: string;
  verification_id: string;
  handoff_key: string;
  policy_fingerprint: string;
  dossier_fingerprint: string;
  verification_fingerprint: string;
  phase6_evidence_set_fingerprint: string;
  handoff_status: ActivationHandoffStatus;
  activation_status: 'not_executed';
  external_execution_required: true;
  sealed_by: string;
  sealed_at: string;
  handoff_fingerprint: string;
  created_at: string;
}

export interface ActivationCeremonyRecallRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  handoff_id: string;
  recall_key: string;
  handoff_fingerprint: string;
  reason_code: string;
  evidence_fingerprint: string;
  recalled_by: string;
  verified_by: string;
  recalled_at: string;
  recall_fingerprint: string;
  created_at: string;
}

export interface ActivationCeremonyEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  sequence: number;
  event_type: ActivationEventType;
  actor: string;
  evidence_fingerprint: string;
  reason_code: string;
  occurred_at: string;
  event_fingerprint: string;
  created_at: string;
}

export class ActivationCeremonyError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'ActivationCeremonyError';
  }
}

export function activationCeremonyFingerprint(value: unknown): string {
  return evidenceFingerprint(value);
}

export function activationCeremonyPolicyIsActive(policy: ActivationCeremonyPolicyManifest, at: string): boolean {
  const instant = Date.parse(at);
  return Number.isFinite(instant) && instant >= Date.parse(policy.valid_from) && instant < Date.parse(policy.valid_until);
}

export function activationCeremonyCredentialMatches(secret: string, expected: string): boolean {
  let actual: string;
  try {
    actual = credentialFingerprint(secret);
  } catch {
    return false;
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(expected) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
