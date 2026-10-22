import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { Store } from '../storage/store.js';
import type { BotManager } from '../bots/manager.js';
import { Session } from './session.js';

export function createMcpServer(
  store: Store,
  manager: BotManager,
  keyId?: string,
) {
  const server = new Server(
    { name: 'Familiar', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );
  const session = new Session(
    store,
    manager,
    keyId,
    () => {
      void server.sendToolListChanged().catch(() => {});
    },
    () => {
      void server.close();
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: session.list() as Tool[],
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    session.call(request.params.name, request.params.arguments ?? {}),
  );
  server.onclose = () => session.close();
  return { server, session };
}
