import type { ModCase, NewCase } from './cases.js';
import type {
  FeatureInstance,
  ModuleInstance,
  GatewaySettings,
} from '../features/types.js';
import { loggingFamilies } from '../features/logging.js';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { hashSecret, randomSecret } from './secrets.js';

export interface Bot {
  slug: string;
  id: string;
  name: string;
  avatar: string | null;
  token: string;
  categories: string[];
  intents?: GatewaySettings['intents'];
  messageCacheSize?: number;
}

export interface ApiKey {
  id: string;
  label: string;
  hash: string;
  bots: string[] | null;
  readOnly: boolean;
  categories: string[] | null;
  created: string;
  lastUsed: string | null;
}

export interface Person {
  id: string;
  name: string;
  avatar: string | null;
  role: 'owner' | 'member' | 'pending' | 'denied';
}

export interface AuditEntry {
  timestamp: string;
  key: string;
  bot: { slug: string; name: string };
  tool: string;
  target: string;
  result: string;
}

export class Store extends EventEmitter {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS keys (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feature_instances (botId TEXT NOT NULL, guildId TEXT NOT NULL, featureId TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(botId, guildId, featureId));
      CREATE TABLE IF NOT EXISTS module_instances (botId TEXT NOT NULL, guildId TEXT NOT NULL, moduleId TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(botId, guildId, moduleId));
      CREATE TABLE IF NOT EXISTS mod_cases (
        case_number INTEGER NOT NULL, bot_id TEXT NOT NULL, guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
        reason TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT,
        active INTEGER NOT NULL DEFAULT 1, metadata TEXT NOT NULL,
        PRIMARY KEY(guild_id, case_number));
      CREATE INDEX IF NOT EXISTS mod_cases_subject ON mod_cases(guild_id, user_id, created_at);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.migrateModules();
  }

  createCase(input: NewCase): ModCase {
    // A single INSERT allocates the guild sequence under SQLite's write lock.
    const row = this.db
      .prepare(
        `INSERT INTO mod_cases
      SELECT COALESCE(MAX(case_number), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
      FROM mod_cases WHERE guild_id = ? RETURNING *`,
      )
      .get(
        input.bot_id,
        input.guild_id,
        input.user_id,
        input.actor,
        input.action,
        input.reason,
        new Date().toISOString(),
        input.expires_at ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.guild_id,
      )!;
    return this.decodeCase(row);
  }
  private decodeCase(row: Record<string, unknown>): ModCase {
    return {
      ...row,
      active: Boolean(row.active),
      metadata: JSON.parse(String(row.metadata)),
    } as ModCase;
  }
  modCases(
    guildId: string,
    userId?: string,
    before = Number.MAX_SAFE_INTEGER,
    limit = 25,
  ): ModCase[] {
    return this.db
      .prepare(
        `SELECT * FROM mod_cases WHERE guild_id = ?
      AND (? IS NULL OR user_id = ?) AND case_number < ? ORDER BY case_number DESC LIMIT ?`,
      )
      .all(guildId, userId ?? null, userId ?? null, before, limit)
      .map((r) => this.decodeCase(r));
  }
  modCase(guildId: string, number: number): ModCase | undefined {
    const row = this.db
      .prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND case_number = ?')
      .get(guildId, number);
    return row ? this.decodeCase(row) : undefined;
  }
  activeWarnCount(guildId: string, userId: string): number {
    return Number(
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM mod_cases WHERE guild_id = ? AND user_id = ? AND action = 'warn' AND active = 1",
        )
        .get(guildId, userId)!.count,
    );
  }
  voidCase(guildId: string, number: number): ModCase | undefined {
    this.db
      .prepare(
        'UPDATE mod_cases SET active = 0 WHERE guild_id = ? AND case_number = ?',
      )
      .run(guildId, number);
    return this.modCase(guildId, number);
  }

  private migrateModules(): void {
    if ((this.setting<number>('featureSchemaVersion') ?? 1) >= 2) return;
    this.db.exec('BEGIN');
    try {
      const rows = this.db.prepare('SELECT value FROM feature_instances').all();
      for (const row of rows) {
        const old = JSON.parse(String(row.value)) as FeatureInstance;
        if (old.featureId !== 'logging') continue;
        const { families, ...config } = old.config;
        // Keep unrecognized values verbatim, including future family names.
        if (families !== undefined) config.families = families;
        this.writeModule({
          botId: old.botId,
          guildId: old.guildId,
          moduleId: 'logging',
          enabled: old.enabled,
          config,
        });
        const statement = this.db.prepare(
          'INSERT OR IGNORE INTO feature_instances VALUES (?, ?, ?, ?)',
        );
        for (const family of loggingFamilies) {
          const instance: FeatureInstance = {
            botId: old.botId,
            guildId: old.guildId,
            featureId: `logging.${family}`,
            enabled: Array.isArray(families)
              ? families.includes(family)
              : families && typeof families === 'object'
                ? Boolean((families as Record<string, unknown>)[family])
                : true,
            config: {},
          };
          statement.run(
            instance.botId,
            instance.guildId,
            instance.featureId,
            JSON.stringify(instance),
          );
        }
        this.db
          .prepare(
            'DELETE FROM feature_instances WHERE botId = ? AND guildId = ? AND featureId = ?',
          )
          .run(old.botId, old.guildId, 'logging');
      }
      this.setSetting('featureSchemaVersion', 2);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  moduleInstance(
    botId: string,
    guildId: string,
    moduleId: string,
  ): ModuleInstance {
    const row = this.db
      .prepare(
        'SELECT value FROM module_instances WHERE botId = ? AND guildId = ? AND moduleId = ?',
      )
      .get(botId, guildId, moduleId);
    return row
      ? JSON.parse(String(row.value))
      : { botId, guildId, moduleId, enabled: true, config: {} };
  }

  private writeModule(instance: ModuleInstance): void {
    this.db
      .prepare(
        'INSERT INTO module_instances VALUES (?, ?, ?, ?) ON CONFLICT(botId, guildId, moduleId) DO UPDATE SET value = excluded.value',
      )
      .run(
        instance.botId,
        instance.guildId,
        instance.moduleId,
        JSON.stringify(instance),
      );
  }

  saveModuleInstances(instances: ModuleInstance[]): void {
    this.db.exec('BEGIN');
    try {
      for (const instance of instances) this.writeModule(instance);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const instance of instances) this.emit('featuresChanged', instance);
  }

  private rows<T>(table: 'bots' | 'keys' | 'people'): T[] {
    return this.db
      .prepare(`SELECT value FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => JSON.parse(row.value as string) as T);
  }

  private put(
    table: 'bots' | 'keys' | 'people' | 'settings',
    id: string,
    value: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${table} VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
      )
      .run(id, JSON.stringify(value));
  }

  bots(): Bot[] {
    return this.rows<Bot>('bots');
  }
  keys(): ApiKey[] {
    return this.rows<ApiKey>('keys');
  }
  people(): Person[] {
    return this.rows<Person>('people');
  }

  saveBot(bot: Bot): void {
    this.put('bots', bot.slug, bot);
    if (!this.setting<string>('defaultBot'))
      this.setSetting('defaultBot', bot.slug);
    this.emit('toolsChanged');
  }

  deleteBot(slug: string): void {
    this.db.exec('BEGIN');
    try {
      const bot = this.bots().find((bot) => bot.slug === slug);
      if (bot)
        this.db
          .prepare('DELETE FROM module_instances WHERE botId = ?')
          .run(bot.id);
      if (bot)
        this.db
          .prepare('DELETE FROM feature_instances WHERE botId = ?')
          .run(bot.id);
      this.db.prepare('DELETE FROM bots WHERE id = ?').run(slug);
      for (const key of this.keys()) {
        if (key.bots)
          this.put('keys', key.id, {
            ...key,
            bots: key.bots.filter((bot) => bot !== slug),
          });
      }
      if (this.setting('defaultBot') === slug)
        this.setSetting('defaultBot', this.bots()[0]?.slug ?? null);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.emit('toolsChanged');
  }

  featureInstances(botId: string, guildId?: string): FeatureInstance[] {
    const rows =
      guildId === undefined
        ? this.db
            .prepare('SELECT value FROM feature_instances WHERE botId = ?')
            .all(botId)
        : this.db
            .prepare(
              'SELECT value FROM feature_instances WHERE botId = ? AND guildId = ?',
            )
            .all(botId, guildId);
    return rows.map((row) => JSON.parse(row.value as string));
  }

  saveFeatureInstances(instances: FeatureInstance[]): void {
    this.db.exec('BEGIN');
    try {
      const statement = this.db.prepare(
        'INSERT INTO feature_instances VALUES (?, ?, ?, ?) ON CONFLICT(botId, guildId, featureId) DO UPDATE SET value = excluded.value',
      );
      for (const instance of instances)
        statement.run(
          instance.botId,
          instance.guildId,
          instance.featureId,
          JSON.stringify(instance),
        );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const instance of instances) this.emit('featuresChanged', instance);
  }

  createKey(
    input: Pick<ApiKey, 'label' | 'bots' | 'readOnly' | 'categories'>,
  ): { key: ApiKey; secret: string } {
    const secret = `fam_${randomSecret()}`;
    const key: ApiKey = {
      ...input,
      id: randomUUID(),
      hash: hashSecret(secret),
      created: new Date().toISOString(),
      lastUsed: null,
    };
    this.put('keys', key.id, key);
    return { key, secret };
  }

  authenticate(secret: string): ApiKey | undefined {
    const hash = hashSecret(secret);
    const key = this.keys().find((item) => item.hash === hash);
    if (key) {
      key.lastUsed = new Date().toISOString();
      this.put('keys', key.id, key);
    }
    return key;
  }

  revokeKey(id: string): void {
    this.db.prepare('DELETE FROM keys WHERE id = ?').run(id);
    this.emit('keyRevoked', id);
  }

  savePerson(person: Person): void {
    this.put('people', person.id, person);
  }

  transferOwnership(previous: Person, next: Person): void {
    this.db.exec('BEGIN');
    try {
      this.put('people', previous.id, { ...previous, role: 'member' });
      this.put('people', next.id, { ...next, role: 'owner' });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setting<T>(id: string): T | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE id = ?')
      .get(id);
    return row ? (JSON.parse(row.value as string) as T) : undefined;
  }

  setSetting(id: string, value: unknown): void {
    this.put('settings', id, value);
    if (id === 'readOnly' || id === 'defaultBot') this.emit('toolsChanged');
  }

  audit(entry: AuditEntry): void {
    this.db
      .prepare('INSERT INTO audit(value) VALUES (?)')
      .run(JSON.stringify(entry));
  }

  auditEntries(
    limit = 100,
    before = Number.MAX_SAFE_INTEGER,
    bot?: string,
  ): (AuditEntry & { id: number })[] {
    return this.db
      .prepare(
        "SELECT id, value FROM audit WHERE id < ? AND (? IS NULL OR json_extract(value, '$.bot.slug') = ?) ORDER BY id DESC LIMIT ?",
      )
      .all(before, bot ?? null, bot ?? null, limit)
      .map((row) => ({
        ...JSON.parse(row.value as string),
        id: Number(row.id),
      }));
  }

  close(): void {
    this.db.close();
  }
}
