import { logging } from './logging.js';
import { autorole } from './autorole.js';
import { welcome } from './welcome.js';
import type { Feature } from './types.js';
export const features: Feature[] = [logging, autorole, welcome];
if (new Set(features.map((f) => f.id)).size !== features.length)
  throw new Error('Duplicate feature id');
