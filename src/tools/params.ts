import { z } from 'zod';

export const id = z.string().regex(/^\d+$/);
export const guild = z.object({ guild_id: id });
export const channel = z.object({ channel_id: id });
export const user = z.object({ user_id: id });
export const member = guild.extend({ user_id: id });
