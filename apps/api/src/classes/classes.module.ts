import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { AssistScopeGuard } from '../common/guards/assist-scope.guard';

@Module({
  controllers: [ClassesController],
  providers: [ClassesService, AssistScopeGuard],
})
export class ClassesModule {}
