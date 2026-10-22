import express from 'express';
import { mountAdmin } from '../src/web/admin.js';
import { mountMcp } from '../src/mcp/http.js';
import { fixture } from './helpers.js';

const { store, manager, secrets } = await fixture();
for (const bot of store.bots()) manager.remove(bot.slug);
const app = express();
app.use(express.json());
let setupCode = '';
app.get('/test/setup-code', (_req, res) => res.json({ code: setupCode }));
mountMcp(app, store, manager, 'http://localhost:3210');
mountAdmin(app, store, manager, {
  store,
  secrets,
  publicUrl: 'http://localhost:3210',
  printSetupCode(code) {
    setupCode = code;
  },
  oauth: {
    async exchange() {
      return { id: '100', username: 'Jesse', avatar: null };
    },
  },
});
app.listen(3210);
