export type ModAction =
  'warn' | 'kick' | 'ban' | 'unban' | 'timeout' | 'untimeout' | 'automod';
export interface ModCase {
  case_number: number;
  bot_id: string;
  guild_id: string;
  user_id: string;
  actor: string;
  action: ModAction;
  reason: string;
  created_at: string;
  expires_at: string | null;
  active: boolean;
  metadata: Record<string, string>;
}
export type NewCase = Omit<
  ModCase,
  'case_number' | 'created_at' | 'active' | 'expires_at' | 'metadata'
> &
  Partial<Pick<ModCase, 'expires_at' | 'metadata'>>;
