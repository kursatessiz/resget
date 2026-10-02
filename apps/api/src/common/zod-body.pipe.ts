import { BadRequestException, Body, Param, PipeTransform, Query } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/** Validates with a shared Zod schema and returns 400 with field paths; the client translates `errors.VALIDATION`. */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'Invalid request',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

export const ZodBody = <T extends ZodTypeAny>(schema: T) => Body(new ZodValidationPipe(schema));
export const ZodQuery = <T extends ZodTypeAny>(schema: T) => Query(new ZodValidationPipe(schema));
export const ZodParam = <T extends ZodTypeAny>(name: string, schema: T) => Param(name, new ZodValidationPipe(schema));
