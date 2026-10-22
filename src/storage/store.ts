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
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    `);
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
  ): (AuditEntry & { id: number })[] {
    return this.db
      .prepare(
        'SELECT id, value FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?',
      )
      .all(before, limit)
      .map((row) => ({
        ...JSON.parse(row.value as string),
        id: Number(row.id),
      }));
  }

  close(): void {
    this.db.close();
  }
}
