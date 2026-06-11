import { BaseRepository } from './baseRepository';
import { Client, TABLES } from '../domain/types';
import { ValidationError } from '../errors';
import { isEmail, isOneOf, CLIENT_STATUSES } from '../domain/validate';
import type { Knex } from '../db/knex';

type ClientWrite = Omit<Partial<Client>, 'id' | 'created_at' | 'updated_at'>;

export class ClientRepository extends BaseRepository<Client> {
  constructor(knex?: Knex) {
    super(TABLES.clients, knex);
  }

  async findByEmail(email: string): Promise<Client | undefined> {
    return this.query().where({ email }).first();
  }

  /** Reject malformed input cleanly (400) before it can reach the DB. */
  private validate(data: ClientWrite): void {
    if (data.email !== undefined && !isEmail(data.email)) {
      throw new ValidationError(400, 'email is not a valid email address', 'invalid_email');
    }
    if (data.status !== undefined && !isOneOf(CLIENT_STATUSES, data.status)) {
      throw new ValidationError(400, `status must be one of: ${CLIENT_STATUSES.join(', ')}`, 'invalid_status');
    }
  }

  async create(data: ClientWrite): Promise<Client> {
    this.validate(data);
    return super.create(data);
  }

  async update(id: string, data: ClientWrite): Promise<Client | undefined> {
    this.validate(data);
    return super.update(id, data);
  }
}

export const clientRepository = new ClientRepository();
