import { z } from 'zod';
import type { Method, Upload } from '../../bots/manager.js';
import type { Category } from '../types.js';

export const rawApi: Category = {
  name: 'raw_api',
  description: 'Full Discord REST API passthrough',
  tools: [
    {
      name: 'api_request',
      description:
        'Call a Discord REST endpoint using the acting bot. Use a relative path without /api/v10. Optional files accept base64 data for multipart uploads. No alternate credentials or hosts are accepted.',
      schema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().startsWith('/'),
        body: z.unknown().optional(),
        form: z
          .boolean()
          .optional()
          .describe(
            'Send body fields as multipart form fields instead of payload_json.',
          ),
        files: z
          .array(
            z.object({
              name: z.string().min(1),
              key: z
                .string()
                .optional()
                .describe(
                  'Multipart field name, for example file for stickers.',
                ),
              data: z.string().base64(),
              contentType: z.string().optional(),
            }),
          )
          .max(10)
          .optional(),
      }),
      mutating: (args) => args.method !== 'GET',
      destructive: (args) => args.method !== 'GET',
      execute: ({ bot, manager }, args) =>
        manager.request(
          bot,
          args.method as Method,
          args.path as string,
          args.body,
          args.files as Upload[] | undefined,
          args.form as boolean | undefined,
        ),
    },
  ],
};
