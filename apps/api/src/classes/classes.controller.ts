import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateClassInput, UpdateClassInput } from '@school-manager/types';
import { ClassesService } from './classes.service';

@Controller('classes')
@UseGuards(AuthGuard)
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.classes.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateClassInput)) body: CreateClassInput,
  ) {
    return this.classes.create(token, body);
  }

  @Patch(':id')
  update(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateClassInput)) body: UpdateClassInput,
  ) {
    return this.classes.update(token, id, body);
  }

  @Patch(':id/prefect')
  setPrefect(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { studentId: string | null },
  ) {
    return this.classes.setPrefect(token, user.id, id, body.studentId ?? null);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.classes.softDelete(token, id);
  }
}
