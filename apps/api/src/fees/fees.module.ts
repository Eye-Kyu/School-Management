import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { FeesController } from './fees.controller';
import { FeesService } from './fees.service';

@Module({
  imports: [SupabaseModule],
  controllers: [FeesController],
  providers: [FeesService],
})
export class FeesModule {}
