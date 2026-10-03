import { z } from 'zod';
import type { OrderChannelValue } from './delivery';
import { PaginationSchema } from './validators';

/**
 * The restaurant's own customer list (docs/PANEL.md). Every guest who ordered
 * or registered from a table becomes a RestaurantCustomer row of that
 * restaurant; the list itself is BASIC, notes and tags (the start of a CRM)
 * are a PRO feature (`crm`). Phone numbers are masked for staff without
 * `customers.contact.view`.
 */

export const CustomersQuerySchema = PaginationSchema.extend({
  query: z.string().trim().max(80).optional(),
  sort: z.enum(['recent', 'orders', 'spend']).default('recent'),
}).strict();
export type CustomersQuery = z.infer<typeof CustomersQuerySchema>;

export interface CustomerDTO {
  id: string;
  userId: string;
  fullName: string;
  phone: string | null;
  firstChannel: OrderChannelValue;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  orderCount: number;
  lifetimeGrossMinor: number;
  currency: string;
  tags: string[];
  note: string | null;
  marketingOptIn: boolean;
  /** Loyalty balance (docs/SADAKAT.md); 0 when the restaurant runs no program. */
  loyaltyPoints: number;
  createdAt: string;
}

export interface CustomerPageDTO {
  items: CustomerDTO[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    total: number;
    newLast30Days: number;
    /** Customers with more than one order. */
    returning: number;
  };
}

export const UpdateCustomerSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
