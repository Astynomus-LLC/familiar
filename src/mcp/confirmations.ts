import { randomBytes } from 'node:crypto';
import { hashSecret } from '../storage/secrets.js';

export class Confirmations {
  private readonly pending = new Map<
    string,
    { fingerprint: string; expires: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  check(
    bot: string,
    tool: string,
    args: Record<string, unknown>,
    code?: string,
  ): { code: string; expires: string } | undefined {
    for (const [key, entry] of this.pending)
      if (entry.expires <= this.now()) this.pending.delete(key);
    const fingerprint = hashSecret(JSON.stringify({ bot, tool, args }));
    if (code) {
      const entry = this.pending.get(code);
      this.pending.delete(code);
      if (!entry || entry.fingerprint !== fingerprint)
        throw new Error(
          'Confirmation is invalid or expired. Request a new code.',
        );
      return;
    }
    if (this.pending.size >= 100)
      this.pending.delete(this.pending.keys().next().value!);
    const next = randomBytes(6).toString('hex');
    const expires = this.now() + 120_000;
    this.pending.set(next, { fingerprint, expires });
    return { code: next, expires: new Date(expires).toISOString() };
  }
}
