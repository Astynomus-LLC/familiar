import type { Express, Request, Response, NextFunction } from 'express';
import type { Store, Person } from '../storage/store.js';
import {
  hashSecret,
  matchesSecret,
  randomSecret,
  type SecretBox,
} from '../storage/secrets.js';
import { discordOAuth, type OAuthProvider } from './oauth.js';

interface WebSession {
  expires: number;
  setup: boolean;
  user?: string;
  oauth?: { hash: string; expires: number };
}

export interface AuthOptions {
  store: Store;
  secrets: SecretBox;
  publicUrl: string;
  oauth?: OAuthProvider;
  printSetupCode?: (code: string) => void;
}

export function mountAuth(app: Express, options: AuthOptions) {
  const { store, secrets, publicUrl } = options;
  const oauth = options.oauth ?? discordOAuth;
  const sessions = new Map<string, WebSession>();
  const origin = new URL(publicUrl).origin;
  const redirectUri = `${origin}/auth/callback`;
  const hasOwner = () =>
    store.people().some((person) => person.role === 'owner');
  function needsSetup(): boolean {
    if (!hasOwner()) return true;
    const encrypted = store.setting<string>('oauthClientSecret');
    if (!encrypted) return true;
    try {
      secrets.decrypt(encrypted);
      return false;
    } catch {
      return true;
    }
  }

  let attempts = 0;
  let windowStart = Date.now();
  if (needsSetup()) {
    const code = randomSecret();
    store.setSetting('setupCodeHash', hashSecret(code));
    (
      options.printSetupCode ??
      ((code) => console.error(`Familiar setup code: ${code}`))
    )(code);
  }

  function getSession(req: Request): WebSession | undefined {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('familiar='))
      ?.slice(9);
    if (!cookie) return;
    const session = sessions.get(hashSecret(cookie));
    if (!session || session.expires < Date.now()) return;
    return session;
  }

  function newSession(res: Response, values: Partial<WebSession> = {}) {
    for (const [id, session] of sessions)
      if (session.expires < Date.now()) sessions.delete(id);
    if (sessions.size >= 1000)
      throw new Error('Too many web sessions. Try again later.');
    const token = randomSecret();
    const session: WebSession = {
      expires: Date.now() + 8 * 60 * 60_000,
      setup: false,
      ...values,
    };
    sessions.set(hashSecret(token), session);
    res.cookie('familiar', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https:'),
      maxAge: 8 * 60 * 60_000,
      path: '/',
    });
    return session;
  }

  app.use(['/api', '/auth'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      req.headers.origin !== origin
    ) {
      res.status(403).json({ error: 'Invalid request origin.' });
      return;
    }
    next();
  });

  function person(req: Request): Person | undefined {
    const session = getSession(req);
    return store.people().find((person) => person.id === session?.user);
  }

  function requireMember(req: Request, res: Response, next: NextFunction) {
    const user = person(req);
    if (!user || !['owner', 'member'].includes(user.role)) {
      res.status(403).json({ error: 'Access approval required.' });
      return;
    }
    res.locals.person = user;
    next();
  }

  function requireOwner(req: Request, res: Response, next: NextFunction) {
    if (person(req)?.role !== 'owner') {
      res.status(403).json({ error: 'Owner access required.' });
      return;
    }
    next();
  }

  app.get('/api/session', (req, res) => {
    res.json({
      user: person(req) ?? null,
      setupRequired: needsSetup(),
      setupVerified: Boolean(getSession(req)?.setup && needsSetup()),
      oauthConfigured: Boolean(store.setting('oauthClientId')),
      redirectUri,
      publicUrl: origin,
    });
  });

  app.post('/api/setup/verify', (req, res) => {
    if (!needsSetup()) {
      res.status(404).end();
      return;
    }
    if (Date.now() - windowStart > 60_000) {
      attempts = 0;
      windowStart = Date.now();
    }
    if (++attempts > 10) {
      res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
      return;
    }
    if (
      typeof req.body.code !== 'string' ||
      !matchesSecret(
        req.body.code,
        store.setting<string>('setupCodeHash') ?? '',
      )
    ) {
      res.status(403).json({ error: 'Invalid setup code.' });
      return;
    }
    store.setSetting('setupCodeHash', null);
    newSession(res, { setup: true });
    res.json({ ok: true });
  });

  app.post('/api/setup/oauth', (req, res) => {
    if (!needsSetup() || !getSession(req)?.setup) {
      res.status(403).json({ error: 'Verify the setup code first.' });
      return;
    }
    const { clientId, clientSecret } = req.body;
    if (
      typeof clientId !== 'string' ||
      !/^\d+$/.test(clientId) ||
      typeof clientSecret !== 'string' ||
      !clientSecret.length
    ) {
      res.status(400).json({
        error: 'Enter your bot application ID and OAuth client secret.',
      });
      return;
    }
    store.setSetting('oauthClientId', clientId);
    store.setSetting('oauthClientSecret', secrets.encrypt(clientSecret));
    res.json({ ok: true });
  });

  app.get('/auth/login', (req, res) => {
    if (!hasOwner() && !getSession(req)?.setup) {
      res.redirect('/');
      return;
    }
    const clientId = store.setting<string>('oauthClientId');
    if (!clientId) {
      res.redirect('/');
      return;
    }
    const session = getSession(req) ?? newSession(res);
    const state = randomSecret();
    session.oauth = {
      hash: hashSecret(state),
      expires: Date.now() + 10 * 60_000,
    };
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify',
      state,
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/auth/callback', async (req, res) => {
    const session = getSession(req);
    const state = session?.oauth;
    if (session) delete session.oauth;
    if (
      !state ||
      state.expires < Date.now() ||
      typeof req.query.state !== 'string' ||
      !matchesSecret(req.query.state, state.hash) ||
      typeof req.query.code !== 'string'
    ) {
      res
        .status(400)
        .send('Login expired or denied. Return to Familiar and try again.');
      return;
    }
    const user = await oauth.exchange(
      req.query.code,
      store.setting<string>('oauthClientId')!,
      secrets.decrypt(store.setting<string>('oauthClientSecret')!),
      redirectUri,
    );
    const existing = store.people().find((person) => person.id === user.id);
    const claiming = !hasOwner() && session?.setup;
    if (!hasOwner() && !claiming) {
      res.status(403).end();
      return;
    }
    store.savePerson({
      id: user.id,
      name: user.username,
      avatar: user.avatar,
      role: claiming ? 'owner' : (existing?.role ?? 'pending'),
    });
    if (claiming) store.setSetting('setupCodeHash', null);
    session!.expires = 0;
    newSession(res, { user: user.id });
    res.redirect('/');
  });

  app.post('/api/logout', (req, res) => {
    const session = getSession(req);
    if (session) session.expires = 0;
    res.clearCookie('familiar', { path: '/' });
    res.json({ ok: true });
  });

  return { requireMember, requireOwner, person };
}
