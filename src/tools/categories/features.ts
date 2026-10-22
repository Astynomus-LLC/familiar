import { z } from 'zod';
import type { Category } from '../types.js';
const address = { guild: z.string(), feature_id: z.string() };
export const featureTools: Category = {
  name: 'features',
  description: 'Configure autonomous features per bot and server',
  tools: [
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
