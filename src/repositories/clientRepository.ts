import { BaseRepository } from './baseRepository';
import { Client, TABLES } from '../domain/types';
import { ValidationError } from '../errors';
import { isEmail, isOneOf, CLIENT_STATUSES } from '../domain/validate';
import type { Knex } from '../db/knex';

type ClientWrite = Omit<Partial<Client>, 'id' | 'created_at' | 'updated_at'>;

/**
 * Canonical email form: trimmed + lowercased. Emails are matched (duplicate
 * onboarding check, `findByEmail`) and stored ONLY in this form, so
 * `Pilot@Acme.com` and `pilot@acme.com` are one tenant, and the DB-level
 * unique guard on `clients.email` can be exact-match.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class ClientRepository extends BaseRepository<Client> {
  constructor(knex?: Knex) {
    super(TABLES.clients, knex);
  }

  async findByEmail(email: string): Promise<Client | undefined> {
    return this.query().where({ email: normalizeEmail(email) }).first();
  }

  /**
   * Reject malformed input cleanly (400) before it can reach the DB, and return
   * the write with the email in canonical (normalized) form.
   */
  private validate(data: ClientWrite): ClientWrite {
    if (data.email === undefined) {
      // fall through — nothing email-shaped to normalize
    } else if (!isEmail(typeof data.email === 'string' ? normalizeEmail(data.email) : data.email)) {
      throw new ValidationError(400, 'email is not a valid email address', 'invalid_email');
    } else {
      data = { ...data, email: normalizeEmail(data.email) };
    }
    if (data.status !== undefined && !isOneOf(CLIENT_STATUSES, data.status)) {
      throw new ValidationError(400, `status must be one of: ${CLIENT_STATUSES.join(', ')}`, 'invalid_status');
    }
    return data;
  }

  async create(data: ClientWrite): Promise<Client> {
    return super.create(this.validate(data));
  }

  async update(id: string, data: ClientWrite): Promise<Client | undefined> {
    return super.update(id, this.validate(data));
  }
}

export const clientRepository = new ClientRepository();
