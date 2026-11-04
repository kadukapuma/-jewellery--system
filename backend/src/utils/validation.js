import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Optional text: '' / undefined / null all become null.
export const optionalText = (max) =>
  z.string().trim().max(max).nullish().transform((v) => v || null);

export const optionalEmail = z
  .string()
  .trim()
  .max(150)
  .refine((v) => v === '' || EMAIL_RE.test(v), 'Enter a valid email')
  .nullish()
  .transform((v) => v || null);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const idSchema = z.coerce.number().int().positive();

// Grams, stored with 3 decimals.
export const gramsSchema = (label) =>
  z.coerce.number({ error: `Enter the ${label}` }).max(100000, 'Too large').transform((v) => Math.round(v * 1000) / 1000);

export const dateSchema = z
  .string({ error: 'Enter a date' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Use a valid date');

export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque'];

// Selling range of an item, as % above its final price (gold value + making). 0% = the final price.
export const priceRangeFields = {
  price_min_percent: z.coerce.number().min(0, 'Min price cannot be below the final price (0%)').max(1000, 'At most 1000%').default(0),
  price_max_percent: z.coerce.number().min(0, 'Max price cannot be below the final price (0%)').max(1000, 'At most 1000%').default(0),
};

export function checkPriceRange(data, ctx, path = []) {
  if (data.price_max_percent < data.price_min_percent) {
    ctx.addIssue({ code: 'custom', path: [...path, 'price_max_percent'], message: 'Max price cannot be below the min price' });
  }
}
