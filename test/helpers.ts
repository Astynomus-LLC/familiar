import { Store } from '../src/storage/store.js';
import { SecretBox } from '../src/storage/secrets.js';
import { BotManager, type ConnectionFactory } from '../src/bots/manager.js';

export async function fixture() {
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
