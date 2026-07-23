import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ClassesModule } from './classes/classes.module';
import { SubjectsModule } from './subjects/subjects.module';
import { DepartmentsModule } from './departments/departments.module';
import { TeachersModule } from './teachers/teachers.module';
import { StudentsModule } from './students/students.module';
import { TermsModule } from './terms/terms.module';
import { TimetableModule } from './timetable/timetable.module';
import { FeesModule } from './fees/fees.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { GuardiansModule } from './guardians/guardians.module';
import { AssessmentsModule } from './assessments/assessments.module';
import { BehaviourModule } from './behaviour/behaviour.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { HomeworkModule } from './homework/homework.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagingModule } from './messaging/messaging.module';
import { PaymentsModule } from './payments/payments.module';
import { AiModule } from './ai/ai.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { PrivilegedAccessModule } from './privileged-access/privileged-access.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { BillingModule } from './billing/billing.module';
import { SystemHealthModule } from './system-health/system-health.module';
import { PlatformUsersModule } from './platform-users/platform-users.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    SupabaseModule,
    AuthModule,
    AttendanceModule,
    ClassesModule,
    SubjectsModule,
    DepartmentsModule,
    TeachersModule,
    StudentsModule,
    TermsModule,
    TimetableModule,
    FeesModule,
    AnnouncementsModule,
    GuardiansModule,
    AssessmentsModule,
    BehaviourModule,
    UsersModule,
    EventsModule,
    HomeworkModule,
    NotificationsModule,
    MessagingModule,
    PaymentsModule,
    AiModule,
    SuperAdminModule,
    PrivilegedAccessModule,
    AuditLogsModule,
    BillingModule,
    SystemHealthModule,
    PlatformUsersModule,
    PlatformSettingsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
