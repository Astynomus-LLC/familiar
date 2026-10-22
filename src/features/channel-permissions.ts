import { PermissionFlagsBits as P } from 'discord.js';
export const channelPermissions = {
  purge: P.ManageMessages,
  lock: P.ManageChannels,
  unlock: P.ManageChannels,
  slowmode: P.ManageChannels,
};
