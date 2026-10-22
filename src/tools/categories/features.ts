import { customCommand, reactionBinding } from '../../features/community.js';
import { z } from 'zod';
import type { Category, Tool } from '../types.js';
const address = { guild: z.string(), feature_id: z.string() };
export const featureTools: Category = {
  name: 'features',
  description: 'Configure autonomous features per bot and server',
  tools: [
    ...(['commands', 'bindings'] as const).flatMap((kind) => {
      const singular = kind === 'commands' ? 'custom_command' : 'reaction_role';
      return (['list', 'add', 'remove'] as const).map((operation): Tool => ({
        name: `${operation}_${singular}${operation === 'list' ? 's' : ''}`,
        description: `${operation} ${singular.replaceAll('_', ' ')} entries. Saved settings respect the existing feature and module toggles.`,
        schema:
          operation === 'list'
            ? z.object({ guild: z.string().default('all') })
            : operation === 'add'
              ? kind === 'commands'
                ? customCommand.safeExtend({ guild: z.string() })
                : reactionBinding.extend({ guild: z.string() })
              : z.object({
                  guild: z.string(),
                  ...(kind === 'commands'
                    ? { name: z.string(), match: z.enum(['command', 'exact']) }
                    : {
                        channelId: z.string().regex(/^\d+$/),
                        messageId: z.string().regex(/^\d+$/),
                        emoji: z.string(),
                      }),
                }),
        mutating: operation !== 'list',
        execute: ({ bot, manager }, args) => {
          const { guild, ...entry } = args;
          return manager.communityEntries(
            bot,
            String(guild),
            kind,
            operation,
            entry,
          );
        },
      }));
    }),
    {
      name: 'create_reaction_role_panel',
      description:
        'Post a plain-text panel in one server and return its channel and message IDs.',
      schema: z.object({
        guild: z.string(),
        channel: z.string().regex(/^\d+$/),
        text: z.string().min(1).max(2000),
      }),
      mutating: true,
      execute: ({ bot, manager }, args) =>
        manager.createReactionRolePanel(
          bot,
          String(args.guild),
          String(args.channel),
          String(args.text),
        ),
    },
    {
      name: 'get_modlogs',
      description:
        'Get recent cases and active warn count for a user in one server.',
      schema: z.object({ guild: z.string(), user: z.string().regex(/^\d+$/) }),
      mutating: false,
      execute: ({ bot, manager }, args) =>
        manager.getModlogs(bot, String(args.guild), String(args.user)),
    },
    {
      name: 'set_module_enabled',
      description:
        'Suspend or restore a module without changing individual feature settings.',
      schema: z.object({
        guild: z.string(),
        module_id: z.string(),
        enabled: z.boolean(),
      }),
      mutating: true,
      execute: ({ bot, manager }, args) =>
        manager.configureModule(
          bot,
          String(args.guild),
          String(args.module_id),
          undefined,
          args.enabled as boolean,
        ),
    },
    {
      name: 'configure_module',
      description:
        'Patch shared module settings in one server or all current servers.',
      schema: z.object({
        guild: z.string(),
        module_id: z.string(),
        config: z.record(z.string(), z.unknown()),
      }),
      mutating: true,
      execute: ({ bot, manager }, args) =>
        manager.configureModule(
          bot,
          String(args.guild),
          String(args.module_id),
          args.config as Record<string, unknown>,
        ),
    },
    {
      name: 'list_features',
      description:
        'List available features and enabled, disabled, or degraded instances.',
      schema: z.object({ guild: z.string().default('all') }),
      mutating: false,
      async execute({ bot, manager }, args) {
        return (await manager.resolveGuilds(bot, String(args.guild))).map(
          (guild) => ({
            guild,
            modules: manager.moduleStates(bot, guild.id),
          }),
        );
      },
    },
    {
      name: 'get_feature_config',
      description: 'Get one server’s stored feature configuration.',
      schema: z.object(address),
      mutating: false,
      async execute({ bot, manager }, args) {
        if (args.guild === 'all') throw new Error('Select one guild.');
        const [guild] = await manager.resolveGuilds(bot, String(args.guild));
        const feature = manager
          .featureStates(bot, guild.id)
          .find((f) => f.featureId === args.feature_id);
        if (!feature) throw new Error('Unknown feature.');
        return feature;
      },
    },
    {
      name: 'configure_feature',
      description:
        'Patch stored feature config in one server or all current servers. Settings can be saved before enabling.',
      schema: z.object({
        ...address,
        config: z.record(z.string(), z.unknown()),
      }),
      mutating: true,
      execute: ({ bot, manager }, args) =>
        manager.configureFeature(
          bot,
          String(args.guild),
          String(args.feature_id),
          args.config as Record<string, unknown>,
        ),
    },
    {
      name: 'set_feature_enabled',
      description:
        'Enable or disable in one server or all current servers. Supply required config on first enable.',
      schema: z.object({
        ...address,
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
      mutating: true,
      execute: ({ bot, manager }, args) =>
        manager.configureFeature(
          bot,
          String(args.guild),
          String(args.feature_id),
          args.config as Record<string, unknown> | undefined,
          args.enabled as boolean,
        ),
    },
  ],
};
