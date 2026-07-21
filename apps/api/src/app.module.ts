import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
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
import { AssessmentsModule } from './assessments/assessments.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { HomeworkModule } from './homework/homework.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagingModule } from './messaging/messaging.module';
import { PaymentsModule } from './payments/payments.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
    AssessmentsModule,
    UsersModule,
    EventsModule,
    HomeworkModule,
    NotificationsModule,
    MessagingModule,
    PaymentsModule,
    AiModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
