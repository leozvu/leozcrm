import { BaseRepository } from './baseRepository';
import { Client, TABLES } from '../domain/types';
import type { Knex } from '../db/knex';

export class ClientRepository extends BaseRepository<Client> {
  constructor(knex?: Knex) {
    super(TABLES.clients, knex);
  }

  async findByEmail(email: string): Promise<Client | undefined> {
    return this.query().where({ email }).first();
  }
}

export const clientRepository = new ClientRepository();
