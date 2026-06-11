import { v4 as uuidv4 } from 'uuid';
import { db, Knex } from '../db/knex';

/**
 * Minimal, dialect-agnostic CRUD over a single table.
 *
 * - UUID ids are generated in app code (portable across SQLite & Postgres).
 * - `updated_at` is bumped on every update.
 * - Subclasses stay tiny; entity-specific queries live in the subclass.
 *
 * This is deliberately thin — it is a foundation seam, not a full ORM. The
 * query builder is intentionally returned untyped: callers get typed *results*
 * from the public methods, while Knex's per-call generics stay out of the way.
 */
export abstract class BaseRepository<TRow extends { id: string }> {
  protected constructor(
    protected readonly table: string,
    protected readonly knex: Knex = db,
  ) {}

  protected now(): string {
    return new Date().toISOString();
  }

  /**
   * Drop keys whose value is `undefined` so that (a) column DEFAULTs apply
   * instead of inserting NULL into NOT NULL columns, and (b) PATCH semantics
   * only touch fields the caller actually sent. `null` is preserved (an
   * explicit "clear this field"); only `undefined` is removed.
   */
  protected clean<T extends Record<string, unknown>>(data: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    ) as Partial<T>;
  }

  query(): Knex.QueryBuilder {
    return this.knex(this.table);
  }

  /** Fetch a single row by id from any table (used for FK existence checks). */
  protected getRow<R = Record<string, unknown>>(table: string, id: string): Promise<R | undefined> {
    return this.knex(table).where({ id }).first();
  }

  async list(limit = 100, offset = 0): Promise<TRow[]> {
    return this.query().select('*').orderBy('created_at', 'desc').limit(limit).offset(offset);
  }

  async findById(id: string): Promise<TRow | undefined> {
    return this.query().where({ id }).first();
  }

  async create(data: Omit<Partial<TRow>, 'id' | 'created_at' | 'updated_at'>): Promise<TRow> {
    const now = this.now();
    const row = { id: uuidv4(), created_at: now, updated_at: now, ...this.clean(data) } as unknown as TRow;
    await this.query().insert(row);
    const created = await this.findById(row.id);
    if (!created) throw new Error(`Failed to create row in ${this.table}`);
    return created;
  }

  async update(
    id: string,
    data: Omit<Partial<TRow>, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<TRow | undefined> {
    const patch = { ...this.clean(data), updated_at: this.now() };
    const affected = await this.query().where({ id }).update(patch);
    if (!affected) return undefined;
    return this.findById(id);
  }

  async remove(id: string): Promise<boolean> {
    const affected = await this.query().where({ id }).del();
    return affected > 0;
  }
}
