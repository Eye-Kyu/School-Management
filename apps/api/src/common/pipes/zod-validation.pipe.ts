// =============================================================================
// ZodValidationPipe - validate request body/query against a Zod schema
// =============================================================================
// Usage:
//   @Post()
//   create(@Body(new ZodValidationPipe(CreateClassInput)) body: CreateClassInput) {
//     ...
//   }
// =============================================================================

import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodError, ZodTypeAny } from 'zod';

export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          issues: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        });
      }
      throw err;
    }
  }
}
