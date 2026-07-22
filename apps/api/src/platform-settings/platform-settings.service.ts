import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Read-only — these are deployment env vars, not database rows. Changing
   * them means changing the deploy config, not saving a form here. The one
   * secret (webhook HMAC) is reported as a boolean, never its value.
   */
  getOverview() {
    return {
      notificationSenderEmail: this.config.get<string>('BREVO_SENDER_EMAIL') ?? 'noreply@schoolmanager.app',
      notificationSenderName: this.config.get<string>('BREVO_SENDER_NAME') ?? 'School Manager',
      appUrl: this.config.get<string>('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000',
      webhookSecretConfigured: !!this.config.get<string>('NOTIFICATION_HMAC_SECRET'),
    };
  }
}
