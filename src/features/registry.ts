import { z } from 'zod';
import { loggingFeatures, loggingModule } from './logging.js';
import { autorole } from './autorole.js';
import { welcome } from './welcome.js';
import type { Feature, Module } from './types.js';
export const features: Feature[] = [...loggingFeatures, autorole, welcome];
export const modules: Module[] = [
  loggingModule,
  {
    id: 'members',
    label: 'Members',
    description: 'Welcome members and assign their roles.',
    configSchema: z.object({}),
    fields: {},
  },
].filter((module) => features.some((f) => f.module === module.id));
if (new Set(features.map((f) => f.id)).size !== features.length)
  throw new Error('Duplicate feature id');
