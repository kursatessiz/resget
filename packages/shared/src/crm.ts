import { z } from 'zod';
import type { ContactAttributionDTO } from './attribution';
import { PhoneSchema } from './validators';

/**
 * CRM core (docs/CRM.md): the restaurant's customer list becomes a contact
 * list with a pipeline. A contact is a RestaurantCustomer row; it may never
 * have ordered (a prospect: a restaurant owner for the platform tenant, a
 * catering lead for a restaurant). Stages, activities and tasks are tenant
 * data; the default stages are created on first use. Behind the
 * contacts_crm module switch; writing is the PRO crm feature.
 */

export const STAGE_KINDS = ['OPEN', 'WON', 'LOST'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export interface DefaultStage {
  key: string;
  kind: StageKind;
}

/** The platform's sales funnel for restaurant owners (labels are crm.stage.<key>). */
export const PLATFORM_DEFAULT_STAGES: readonly DefaultStage[] = [
  { key: 'lead', kind: 'OPEN' },
  { key: 'contacted', kind: 'OPEN' },
  { key: 'demo', kind: 'OPEN' },
  { key: 'onboarding', kind: 'OPEN' },
  { key: 'live', kind: 'WON' },
  { key: 'lost', kind: 'LOST' },
];

/** A restaurant's leads (catering, corporate accounts). */
export const RESTAURANT_DEFAULT_STAGES: readonly DefaultStage[] = [
  { key: 'new', kind: 'OPEN' },
  { key: 'contacted', kind: 'OPEN' },
  { key: 'won', kind: 'WON' },
  { key: 'lost', kind: 'LOST' },
];

export const ACTIVITY_TYPES = [
  'NOTE',
  'CALL',
  'MEETING',
  'EMAIL',
  'STAGE_CHANGE',
  'TASK_DONE',
  'FORM',
  'CONVERSION',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
/** What a person can log by hand; the others are written by the system. */
export const MANUAL_ACTIVITY_TYPES = ['NOTE', 'CALL', 'MEETING', 'EMAIL'] as const;

export const CreateContactSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: PhoneSchema,
    email: z.string().trim().email().max(200).optional(),
    company: z.string().trim().min(1).max(120).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    district: z.string().trim().min(1).max(80).optional(),
    source: z.string().trim().min(1).max(60).optional(),
    stageId: z.string().uuid().optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  })
  .strict();
export type CreateContactInput = z.infer<typeof CreateContactSchema>;

export const UpdateContactSchema = z
  .object({
    email: z.string().trim().email().max(200).nullable().optional(),
    company: z.string().trim().min(1).max(120).nullable().optional(),
    city: z.string().trim().min(1).max(80).nullable().optional(),
    district: z.string().trim().min(1).max(80).nullable().optional(),
    source: z.string().trim().min(1).max(60).nullable().optional(),
    stageId: z.string().uuid().nullable().optional(),
    ownerMembershipId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

export const LogActivitySchema = z
  .object({ type: z.enum(MANUAL_ACTIVITY_TYPES), body: z.string().trim().min(1).max(2000) })
  .strict();
export type LogActivityInput = z.infer<typeof LogActivitySchema>;

export const CreateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueAt: z.string().datetime().optional(),
    assigneeMembershipId: z.string().uuid().optional(),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z.object({ done: z.boolean() }).strict();
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export interface PipelineStageDTO {
  id: string;
  key: string | null;
  name: string | null;
  kind: StageKind;
  position: number;
}

export interface ContactCardDTO {
  id: string;
  fullName: string;
  /** Masked without customers.contact.view. */
  phone: string;
  email: string | null;
  company: string | null;
  city: string | null;
  district: string | null;
  source: string | null;
  stageId: string | null;
  owner: { membershipId: string; fullName: string } | null;
  orderCount: number;
  openTasks: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface PipelineDTO {
  stages: PipelineStageDTO[];
  /** Contacts per stage id; the key "none" holds contacts without a stage. */
  contacts: Record<string, ContactCardDTO[]>;
  /** Members who can own a contact. */
  owners: { membershipId: string; fullName: string }[];
}

export interface ContactActivityDTO {
  id: string;
  type: ActivityType;
  body: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface ContactTaskDTO {
  id: string;
  customerId: string;
  contactName: string;
  title: string;
  dueAt: string | null;
  doneAt: string | null;
  assignee: { membershipId: string; fullName: string } | null;
  createdAt: string;
}

export interface ContactDetailDTO {
  contact: ContactCardDTO;
  activities: ContactActivityDTO[];
  tasks: ContactTaskDTO[];
  /** Visits and conversions of the contact; null while the attribution module is off. */
  attribution: ContactAttributionDTO | null;
}

/** CSV columns of the contact export, in order; values are tenant data, headers are the keys. */
export const CONTACT_EXPORT_COLUMNS = [
  'fullName',
  'phone',
  'email',
  'company',
  'city',
  'district',
  'source',
  'stage',
  'orderCount',
  'marketingOptIn',
  'createdAt',
] as const;

/** One CSV field: quoted when it holds a comma, quote or line break; a leading formula character is neutralised. */
export function csvField(value: string | number | boolean | null): string {
  if (value === null) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
