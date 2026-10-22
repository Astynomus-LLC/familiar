import { EventEmitter } from 'node:events';
import type { Client } from 'discord.js';
import { Store } from '../src/storage/store.js';
import { SecretBox } from '../src/storage/secrets.js';
import { BotManager, type ConnectionFactory } from '../src/bots/manager.js';

export async function fixture(liveClient: boolean | Client = false) {
  const store = new Store(':memory:');
  const secrets = new SecretBox(
    'test master secret with enough entropy length',
  );
  const calls: {
    token: string;
    method: string;
    path: string;
    body: unknown;
  }[] = [];
  const factory: ConnectionFactory = (token) => ({
    ...(liveClient
      ? {
          client:
            typeof liveClient === 'object'
              ? liveClient
              : (Object.assign(new EventEmitter(), {
                  isReady: () => true,
                  guilds: {
                    cache: new Map(),
                    fetch: async (id: string) => ({
                      id,
                      emojis: {
                        fetch: async () =>
                          new Map([['77', { id: '77', name: 'party' }]]),
                      },
                      channels: {
                        fetch: async () =>
                          new Map([
                            ['99', { id: '99', name: 'activity', type: 0 }],
                            ['98', { id: '98', name: 'logs', type: 0 }],
                          ]),
                      },
                      roles: {
                        fetch: async () =>
                          new Map([
                            [
                              '88',
                              { id: '88', name: 'Member', hexColor: '#32634c' },
                            ],
                            [
                              '89',
                              { id: '89', name: 'Helper', hexColor: '#4466aa' },
                            ],
                          ]),
                      },
                    }),
                  },
                }) as unknown as Client),
        }
      : {}),
    async request(method, path, body) {
      calls.push({ token, method, path, body });
      if (token === 'invalid') throw new Error('Unauthorized');
      if (path === '/users/@me')
        return {
          id: token === 'hello-token' ? '1' : '2',
          username: token.split('-')[0],
          bot: true,
          avatar: null,
        };
      if (path.startsWith('/users/@me/guilds'))
        return [
          { id: '10', name: 'Server A' },
          { id: '20', name: 'Server B' },
        ];
      if (path === '/channels/99' && method === 'GET')
        return { guild_id: '10' };
      if (path === '/channels/99/messages' && method === 'POST')
        return { id: '55' };
      return { ok: true };
    },
    async login() {
      if (token === 'offline-token') throw new Error('Offline');
    },
    async voice() {
      return { connected: true };
    },
    destroy() {},
    status() {
      return { state: 'online', guilds: 1 };
    },
  });
  const manager = new BotManager(store, secrets, factory);
  await manager.save('hello', 'hello-token', ['messages']);
  await manager.save('other', 'other-token', []);
  calls.length = 0;
  return { store, secrets, manager, calls };
}
