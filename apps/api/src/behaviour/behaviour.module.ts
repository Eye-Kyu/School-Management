import { Module } from '@nestjs/common';
import { BehaviourController } from './behaviour.controller';
import { BehaviourService } from './behaviour.service';
import { BehaviourScheduler } from './behaviour.scheduler';

@Module({
  controllers: [BehaviourController],
  providers: [BehaviourService, BehaviourScheduler],
  exports: [BehaviourService],
})
export class BehaviourModule {}
