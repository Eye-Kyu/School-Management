import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

type ModuleRow = {
  key: string;
  name: string;
  description: string;
  category: string;
  is_core: boolean;
  can_disable: boolean;
  status: string;
  dependencies: string[];
};

type SchoolModuleRow = {
  module_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  enabled_at: string | null;
  disabled_at: string | null;
};

@Injectable()
export class SuperAdminService {
  constructor(private readonly supabase: SupabaseService) {}

  async listSchools() {
    const { data, error } = await this.supabase.admin
      .from('schools')
      .select('id, name, slug, is_active, created_at')
      .order('name');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /** Full catalogue joined with this school's entitlement state — no row means enabled. */
  async getSchoolModules(schoolId: string) {
    const { data: school } = await this.supabase.admin
      .from('schools')
      .select('id')
      .eq('id', schoolId)
      .maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    const { data: modules } = await this.supabase.admin
      .from('modules')
      .select('key, name, description, category, is_core, can_disable, status, dependencies')
      .order('category');

    const { data: schoolModules } = await this.supabase.admin
      .from('school_modules')
      .select('module_key, enabled, config, enabled_at, disabled_at')
      .eq('school_id', schoolId);

    const stateByKey = new Map((schoolModules as SchoolModuleRow[] ?? []).map((m) => [m.module_key, m]));

    return (modules as ModuleRow[] ?? []).map((m) => {
      const state = stateByKey.get(m.key);
      return {
        ...m,
        enabled: state?.enabled ?? true,
        config: state?.config ?? {},
        enabledAt: state?.enabled_at ?? null,
        disabledAt: state?.disabled_at ?? null,
      };
    });
  }

  async toggleModule(schoolId: string, moduleKey: string, enabled: boolean, callerAuthId: string) {
    const { data: school } = await this.supabase.admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    const { data: allModules } = await this.supabase.admin
      .from('modules')
      .select('key, is_core, can_disable, dependencies');
    const modules = (allModules as ModuleRow[] | null) ?? [];
    const targetModule = modules.find((m) => m.key === moduleKey);
    if (!targetModule) throw new NotFoundException(`Unknown module: ${moduleKey}`);

    if (!enabled && (targetModule.is_core || !targetModule.can_disable)) {
      throw new BadRequestException(`Module '${moduleKey}' is core and cannot be disabled`);
    }

    const { data: schoolModules } = await this.supabase.admin
      .from('school_modules')
      .select('module_key, enabled')
      .eq('school_id', schoolId);
    const enabledState = new Map((schoolModules as { module_key: string; enabled: boolean }[] ?? []).map((m) => [m.module_key, m.enabled]));
    const isEnabled = (key: string) => enabledState.get(key) ?? true; // no row = enabled

    if (enabled) {
      const missing = (targetModule.dependencies ?? []).find((dep) => !isEnabled(dep));
      if (missing) {
        throw new BadRequestException(`Module '${moduleKey}' requires '${missing}' to be enabled first`);
      }
    }

    // Soft warning: other enabled modules that depend on this one, if disabling.
    const warnings: string[] = [];
    if (!enabled) {
      for (const m of modules) {
        if (m.key !== moduleKey && (m.dependencies ?? []).includes(moduleKey) && isEnabled(m.key)) {
          warnings.push(`'${m.key}' depends on '${moduleKey}' and will stop working until it's re-enabled`);
        }
      }
    }

    const { data: caller } = await this.supabase.admin
      .from('users')
      .select('id')
      .eq('auth_id', callerAuthId)
      .maybeSingle();

    const now = new Date().toISOString();
    const patch = enabled
      ? { enabled: true, enabled_at: now, enabled_by: caller?.id ?? null, updated_at: now }
      : { enabled: false, disabled_at: now, disabled_by: caller?.id ?? null, updated_at: now };

    const { error } = await this.supabase.admin
      .from('school_modules')
      .upsert({ id: randomUUID(), school_id: schoolId, module_key: moduleKey, ...patch }, { onConflict: 'school_id,module_key' });
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: caller?.id ?? null,
      action: enabled ? 'module.enable' : 'module.disable',
      entity_type: 'school_modules',
      entity_id: null,
      metadata: { module_key: moduleKey, previous_state: !enabled },
    });

    return { ok: true, warnings };
  }
}
