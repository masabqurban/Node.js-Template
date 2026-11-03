import { z } from 'zod';

/** Shared building blocks for request and response schemas. */

export const emailSchema = z
  .email('Enter a valid email address.')
  .trim()
  .toLowerCase()
  .max(254)
  .meta({ examples: ['jane@example.com'] });

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  // scrypt input is bounded so a huge password can't be used to burn CPU.
  .max(128, 'Use at most 128 characters.')
  .meta({ examples: ['correct-horse-battery'] });

export const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters.').max(100);

export const idParams = z.object({ id: z.string().min(1).max(64) });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export const pageMetaSchema = z
  .object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: 'PageMeta' });

export type PageMeta = z.infer<typeof pageMetaSchema>;

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export const errorEnvelope = z
  .object({
    success: z.literal(false),
    error: z.object({
      code: z.string().meta({ examples: ['VALIDATION_ERROR'] }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });
