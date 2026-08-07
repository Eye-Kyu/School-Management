import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AssistAuditInterceptor } from './common/interceptors/assist-audit.interceptor';

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
import { QuizzesModule } from './quizzes/quizzes.module';
import { DocumentsModule } from './documents/documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { NotificationsAggregationModule } from './notifications-aggregation/notifications-aggregation.module';
import { MessagingModule } from './messaging/messaging.module';
import { PaymentsModule } from './payments/payments.module';
import { AiModule } from './ai/ai.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { PrivilegedAccessModule } from './privileged-access/privileged-access.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { BillingModule } from './billing/billing.module';
import { SystemHealthModule } from './system-health/system-health.module';
import { PlatformUsersModule } from './platform-users/platform-users.module';
import { PlatformMessagesModule } from './platform-messages/platform-messages.module';
import { PrefectsModule } from './prefects/prefects.module';
import { AbsenceRequestsModule } from './absence-requests/absence-requests.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Global so AuthGuard (used via @UseGuards(AuthGuard) in every controller,
    // none of which import AuthModule directly) can inject JwtService to
    // verify the assist-mode cookie's JWT alongside the Supabase bearer token.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) throw new Error('JWT_SECRET environment variable is not set');
        return { secret };
      },
    }),
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
    QuizzesModule,
    DocumentsModule,
    NotificationsModule,
    NotificationsAggregationModule,
    MessagingModule,
    PaymentsModule,
    AiModule,
    SuperAdminModule,
    PrivilegedAccessModule,
    AuditLogsModule,
    BillingModule,
    SystemHealthModule,
    PlatformUsersModule,
    PlatformMessagesModule,
    PrefectsModule,
    AbsenceRequestsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AssistAuditInterceptor }],
})
export class AppModule {}
