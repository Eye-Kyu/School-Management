import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ClassesModule } from './classes/classes.module';
import { SubjectsModule } from './subjects/subjects.module';
import { TeachersModule } from './teachers/teachers.module';
import { StudentsModule } from './students/students.module';
import { TermsModule } from './terms/terms.module';
import { TimetableModule } from './timetable/timetable.module';
import { FeesModule } from './fees/fees.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { GuardiansModule } from './guardians/guardians.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SupabaseModule,
    AuthModule,
    AttendanceModule,
    ClassesModule,
    SubjectsModule,
    TeachersModule,
    StudentsModule,
    TermsModule,
    TimetableModule,
    FeesModule,
    AnnouncementsModule,
    GuardiansModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
