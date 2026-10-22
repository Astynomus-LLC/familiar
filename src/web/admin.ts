import express, { type Express, type ErrorRequestHandler } from 'express';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Store } from '../storage/store.js';
import type { BotManager } from '../bots/manager.js';
import { categories, validateCategories } from '../tools/registry.js';
import { mountAuth, type AuthOptions } from './auth.js';

const keyInput = z.object({
  label: z.string().min(1).max(100),
  bots: z.array(z.string()).nullable(),
  readOnly: z.boolean(),
  categories: z.array(z.string()).nullable(),
});

export function mountAdmin(
  app: Express,
  store: Store,
  manager: BotManager,
  options: AuthOptions,
) {
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  const auth = mountAuth(app, options);
  app.use('/api/admin', auth.requireMember);

  app.get('/api/admin/state', (_req, res) => {
    res.json({
      bots: store.bots().map((bot) => ({
        slug: bot.slug,
        id: bot.id,
        name: bot.name,
        avatar: bot.avatar,
        categories: bot.categories,
        ...manager.status(bot.slug),
      })),
      keys: store.keys().map((key) => ({
        id: key.id,
        label: key.label,
        bots: key.bots,
        readOnly: key.readOnly,
        categories: key.categories,
        created: key.created,
        lastUsed: key.lastUsed,
      })),
      categories: categories.map(({ name, description }) => ({
        name,
        description,
      })),
      defaultBot: store.setting('defaultBot') ?? null,
      readOnly: store.setting('readOnly') ?? false,
      audit: store.auditEntries(20),
    });
  });

  app.post('/api/admin/bots', async (req, res) => {
    const input = z
      .object({
        slug: z.string(),
        token: z.string().min(1),
        categories: z.array(z.string()),
      })
      .parse(req.body);
    validateCategories(input.categories);
    const bot = await manager.save(input.slug, input.token, input.categories);
    res.json({ slug: bot.slug, name: bot.name, ...manager.status(bot.slug) });
  });

  app.patch('/api/admin/bots/:slug', (req, res) => {
    const bot = store.bots().find((bot) => bot.slug === req.params.slug);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found.' });
      return;
    }
    const input = z.object({ categories: z.array(z.string()) }).parse(req.body);
    validateCategories(input.categories);
    store.saveBot({ ...bot, categories: input.categories });
    res.json({ ok: true });
  });

  app.get('/api/admin/bots/:slug/affected-keys', (req, res) => {
    res.json(
      store
        .keys()
        .filter((key) => key.bots?.includes(String(req.params.slug)))
        .map((key) => ({
          id: key.id,
          label: key.label,
          becomesInert: key.bots?.length === 1,
        })),
    );
  });

  app.delete('/api/admin/bots/:slug', (req, res) => {
    if (req.body.confirm !== req.params.slug) {
      res.status(400).json({ error: 'Confirm the bot slug.' });
      return;
    }
    manager.remove(String(req.params.slug));
    res.json({ ok: true });
  });

  app.post('/api/admin/keys', (req, res) => {
    const input = keyInput.parse(req.body);
    if (
      input.bots?.some((slug) => !store.bots().some((bot) => bot.slug === slug))
    ) {
      res.status(400).json({ error: 'Bot not found.' });
      return;
    }
    if (input.categories) validateCategories(input.categories);
    const { key, secret } = store.createKey(input);
    res.json({
      id: key.id,
      secret,
      config: {
        mcpServers: {
          familiar: {
            url: `${new URL(options.publicUrl).origin}/mcp`,
            headers: { Authorization: `Bearer ${secret}` },
          },
        },
      },
    });
  });

  app.delete('/api/admin/keys/:id', (req, res) => {
    store.revokeKey(String(req.params.id));
    res.json({ ok: true });
  });

  app.patch('/api/admin/settings', (req, res) => {
    const input = z
      .object({
        readOnly: z.boolean().optional(),
        defaultBot: z.string().optional(),
      })
      .parse(req.body);
    if (
      input.defaultBot !== undefined &&
      !store.bots().some((bot) => bot.slug === input.defaultBot)
    ) {
      res.status(400).json({ error: 'Bot not found.' });
      return;
    }
    if (input.readOnly !== undefined)
      store.setSetting('readOnly', input.readOnly);
    if (input.defaultBot !== undefined)
      store.setSetting('defaultBot', input.defaultBot);
    res.json({ ok: true });
  });

  app.post('/api/admin/oauth', (req, res) => {
    const input = z
      .object({
        clientId: z.string().regex(/^\d+$/),
        clientSecret: z.string().min(1),
      })
      .parse(req.body);
    store.setSetting('oauthClientId', input.clientId);
    store.setSetting(
      'oauthClientSecret',
      options.secrets.encrypt(input.clientSecret),
    );
    res.json({ ok: true });
  });

  app.get('/api/admin/audit', (req, res) => {
    const before = z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .parse(req.query.before);
    res.json(store.auditEntries(100, before));
  });

  app.get('/api/admin/access', auth.requireOwner, (_req, res) =>
    res.json(store.people()),
  );
  app.post('/api/admin/access', auth.requireOwner, (req, res) => {
    const input = z
      .object({
        id: z.string().regex(/^\d+$/),
        role: z.enum(['member', 'denied']),
      })
      .parse(req.body);
    const existing = store.people().find((person) => person.id === input.id);
    if (existing?.role === 'owner') {
      res
        .status(400)
        .json({ error: 'Transfer ownership before changing this account.' });
      return;
    }
    store.savePerson({
      id: input.id,
      name: existing?.name ?? input.id,
      avatar: existing?.avatar ?? null,
      role: input.role,
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/ownership', auth.requireOwner, (req, res) => {
    const input = z
      .object({ id: z.string(), confirm: z.literal('transfer ownership') })
      .parse(req.body);
    const next = store
      .people()
      .find((person) => person.id === input.id && person.role === 'member');
    if (!next) {
      res.status(400).json({ error: 'Select an approved member.' });
      return;
    }
    const previous = auth.person(req)!;
    store.transferOwnership(previous, next);
    res.json({ ok: true });
  });

  app.use(
    express.static(fileURLToPath(new URL('../../public', import.meta.url))),
  );
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
      _next(error);
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
      return;
    }
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Request failed.',
    });
  };
  app.use(errors);
}
