import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { loggingFamilies } from '../src/features/logging.js';

for (const arrayShape of [false, true])
  test(`v1.1 migration preserves logging config and is idempotent (${arrayShape ? 'array' : 'boolean families'})`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'familiar-migration-'));
    const path = join(dir, 'store.db');
    const config = {
      channelId: '123456789012345678',
      families: arrayShape
        ? [...loggingFamilies]
        : {
            messageEdited: true,
            messageDeleted: true,
            memberJoined: true,
            memberLeft: true,
            memberModerated: true,
            roles: true,
            channels: true,
          },
      ignoreBots: true,
      ignoredChannelIds: [],
      includeContent: true,
      ...(arrayShape ? { futureSetting: { preserve: 'verbatim' } } : {}),
    };
    try {
      const db = new DatabaseSync(path);
      db.exec(
        'CREATE TABLE feature_instances (botId TEXT NOT NULL, guildId TEXT NOT NULL, featureId TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(botId, guildId, featureId))',
      );
      const insert = db.prepare(
        'INSERT INTO feature_instances VALUES (?, ?, ?, ?)',
      );
      insert.run(
        '1',
        '10',
        'logging',
        JSON.stringify({
          botId: '1',
          guildId: '10',
          featureId: 'logging',
          enabled: false,
          config,
        }),
      );
      const autorole = {
        botId: '1',
        guildId: '10',
        featureId: 'autorole',
        enabled: true,
        config: { roleIds: ['88'], skipBots: true, delaySeconds: 0 },
      };
      insert.run('1', '10', 'autorole', JSON.stringify(autorole));
      db.close();
      for (let run = 0; run < 2; run++) {
        const store = new Store(path);
        try {
          assert.equal(store.setting('featureSchemaVersion'), 2);
          assert.deepEqual(store.moduleInstance('1', '10', 'logging'), {
            botId: '1',
            guildId: '10',
            moduleId: 'logging',
            enabled: false,
            config,
          });
          const instances = store.featureInstances('1', '10');
          assert.equal(instances.length, 8);
          assert.deepEqual(
            instances.find((i) => i.featureId === 'autorole'),
            autorole,
          );
          assert.equal(
            store.moduleInstance('1', '10', 'members').enabled,
            true,
          );
          for (const family of loggingFamilies)
            assert.equal(
              instances.find((i) => i.featureId === `logging.${family}`)
                ?.enabled,
              true,
            );
        } finally {
          store.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
