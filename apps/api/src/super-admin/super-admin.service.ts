import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  CreateSchoolInput,
  UpdateSchoolInput,
  UpdateSchoolStatusInput,
  OnboardSchoolInput,
  CreatePackageInput,
  UpdatePackageInput,
  SetPackageModulesInput,
  AssignSubscriptionInput,
  CreateCurriculumInput,
  UpdateCurriculumInput,
  SetCurriculumSubjectsInput,
  AssignCurriculumInput,
} from '@school-manager/types';

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
      .select('id, name, slug, status, created_at')
      .order('name');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getSchool(schoolId: string) {
    const { data, error } = await this.supabase.admin
      .from('schools')
      .select('id, name, slug, phone, email, address, timezone, status, created_at')
      .eq('id', schoolId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('School not found');
    return data;
  }

  /**
   * Real, currently-computable per-school stats only. `users.last_login_at`
   * is never written to anywhere in this codebase — engagement is computed
   * from `audit_logs`'s real `auth.login` events instead (written by the
   * login page on every successful sign-in).
   */
  async getSchoolOverview(schoolId: string) {
    const { data: school } = await this.supabase.admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgoDate = last30d.slice(0, 10);

    const [
      usersRes,
      classesRes,
      subjectsCountRes,
      studentsRes,
      attendanceTotalRes,
      attendancePresentRes,
      assessmentsCreatedRes,
      gradesRecordedRes,
      loginsDayRes,
      loginsWeekRes,
      loginsMonthRes,
    ] = await Promise.all([
      this.supabase.admin.from('users').select('id, role, is_active, created_at').eq('school_id', schoolId),
      this.supabase.admin.from('classes').select('id, grade_level').eq('school_id', schoolId),
      this.supabase.admin.from('subjects').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
      this.supabase.admin.from('students').select('id, current_class_id').eq('school_id', schoolId),
      this.supabase.admin.from('attendance_records').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).gte('date', thirtyDaysAgoDate),
      this.supabase.admin.from('attendance_records').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).gte('date', thirtyDaysAgoDate).eq('status', 'PRESENT'),
      this.supabase.admin.from('assessments').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).gte('created_at', last30d),
      this.supabase.admin.from('grades').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).gte('created_at', last30d),
      this.supabase.admin.from('audit_logs').select('user_id').eq('school_id', schoolId).eq('action', 'auth.login').gte('created_at', last24h),
      this.supabase.admin.from('audit_logs').select('user_id').eq('school_id', schoolId).eq('action', 'auth.login').gte('created_at', last7d),
      this.supabase.admin.from('audit_logs').select('user_id').eq('school_id', schoolId).eq('action', 'auth.login').gte('created_at', last30d),
    ]);

    type UserRow = { id: string; role: string; is_active: boolean; created_at: string };
    const users = (usersRes.data as UserRow[] | null) ?? [];
    const roleOf = new Map(users.map((u) => [u.id, u.role]));

    const usersByRole = { ADMIN: 0, TEACHER: 0, STUDENT: 0, PARENT: 0 };
    let active = 0;
    let inactive = 0;
    let newThisMonth = 0;
    for (const u of users) {
      if (u.role in usersByRole) usersByRole[u.role as keyof typeof usersByRole]++;
      if (u.is_active) active++; else inactive++;
      if (u.created_at >= startOfMonth) newThisMonth++;
    }

    const classes = (classesRes.data as { id: string; grade_level: number }[] | null) ?? [];
    const gradeByClassId = new Map(classes.map((c) => [c.id, c.grade_level]));
    const students = (studentsRes.data as { id: string; current_class_id: string | null }[] | null) ?? [];
    const studentsPerGrade: Record<number, number> = {};
    for (const s of students) {
      const grade = s.current_class_id ? gradeByClassId.get(s.current_class_id) : undefined;
      if (grade == null) continue;
      studentsPerGrade[grade] = (studentsPerGrade[grade] ?? 0) + 1;
    }

    const distinctUserIds = (rows: { data: { user_id: string }[] | null }) =>
      new Set((rows.data ?? []).map((r) => r.user_id).filter(Boolean));
    const dau = distinctUserIds(loginsDayRes);
    const wau = distinctUserIds(loginsWeekRes);
    const mau = distinctUserIds(loginsMonthRes);

    const loginsByRoleLast7Days = { ADMIN: 0, TEACHER: 0, STUDENT: 0, PARENT: 0 };
    for (const uid of wau) {
      const role = roleOf.get(uid);
      if (role && role in loginsByRoleLast7Days) loginsByRoleLast7Days[role as keyof typeof loginsByRoleLast7Days]++;
    }

    const attendanceTotal = attendanceTotalRes.count ?? 0;
    const attendancePresent = attendancePresentRes.count ?? 0;

    return {
      users: {
        total: users.length,
        byRole: usersByRole,
        active,
        inactive,
        newThisMonth,
      },
      academic: {
        classCount: classes.length,
        subjectCount: subjectsCountRes.count ?? 0,
        studentsPerGrade,
        attendance: {
          recordCount: attendanceTotal,
          presentRate: attendanceTotal > 0 ? Math.round((attendancePresent / attendanceTotal) * 100) : null,
        },
        assessmentsCreatedLast30Days: assessmentsCreatedRes.count ?? 0,
        gradesRecordedLast30Days: gradesRecordedRes.count ?? 0,
      },
      engagement: {
        dau: dau.size,
        wau: wau.size,
        mau: mau.size,
        loginsByRoleLast7Days,
      },
    };
  }

  async createSchool(input: CreateSchoolInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const now = new Date().toISOString();
    const id = randomUUID();

    const { data, error } = await this.supabase.admin
      .from('schools')
      .insert({
        id,
        name: input.name,
        slug: input.slug,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        timezone: input.timezone ?? 'Africa/Nairobi',
        updated_at: now,
      })
      .select('id, name, slug, status, created_at')
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException(`Slug '${input.slug}' is already in use`);
      throw new BadRequestException(error.message);
    }

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: id,
      user_id: caller?.id ?? null,
      action: 'school.create',
      entity_type: 'school',
      entity_id: id,
      metadata: { name: input.name, slug: input.slug },
    });

    return data;
  }

  async updateSchool(schoolId: string, input: UpdateSchoolInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: existing } = await this.supabase.admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
    if (!existing) throw new NotFoundException('School not found');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.email !== undefined) patch.email = input.email;
    if (input.address !== undefined) patch.address = input.address;
    if (input.timezone !== undefined) patch.timezone = input.timezone;

    const { data, error } = await this.supabase.admin
      .from('schools')
      .update(patch)
      .eq('id', schoolId)
      .select('id, name, slug, status, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: caller?.id ?? null,
      action: 'school.update',
      entity_type: 'school',
      entity_id: schoolId,
      metadata: patch,
    });

    return data;
  }

  async updateSchoolStatus(schoolId: string, input: UpdateSchoolStatusInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: existing } = await this.supabase.admin.from('schools').select('id, status').eq('id', schoolId).maybeSingle();
    if (!existing) throw new NotFoundException('School not found');

    const { data, error } = await this.supabase.admin
      .from('schools')
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', schoolId)
      .select('id, name, slug, status, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: caller?.id ?? null,
      action: 'school.status_change',
      entity_type: 'school',
      entity_id: schoolId,
      metadata: { from: existing.status, to: input.status, reason: input.reason ?? null },
    });

    return data;
  }

  private async resolveCaller(callerAuthId: string) {
    const { data } = await this.supabase.admin.from('users').select('id').eq('auth_id', callerAuthId).maybeSingle();
    return data;
  }

  /**
   * Real, currently-computable platform metrics only — no fabricated MRR/
   * churn/health scores. Those need the package/subscription/health-score
   * infrastructure built in later phases.
   */
  async getDashboardStats() {
    const [
      totalSchools,
      activeSchools,
      inactiveSchools,
      suspendedSchools,
      archivedSchools,
      totalAdmins,
      totalTeachers,
      totalStudents,
      totalParents,
    ] = await Promise.all([
      this.supabase.admin.from('schools').select('id', { count: 'exact', head: true }),
      this.supabase.admin.from('schools').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
      this.supabase.admin.from('schools').select('id', { count: 'exact', head: true }).eq('status', 'INACTIVE'),
      this.supabase.admin.from('schools').select('id', { count: 'exact', head: true }).eq('status', 'SUSPENDED'),
      this.supabase.admin.from('schools').select('id', { count: 'exact', head: true }).eq('status', 'ARCHIVED'),
      this.supabase.admin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'ADMIN'),
      this.supabase.admin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'TEACHER'),
      this.supabase.admin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT'),
      this.supabase.admin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'PARENT'),
    ]);

    const usersByRole = {
      ADMIN: totalAdmins.count ?? 0,
      TEACHER: totalTeachers.count ?? 0,
      STUDENT: totalStudents.count ?? 0,
      PARENT: totalParents.count ?? 0,
    };

    return {
      totalSchools: totalSchools.count ?? 0,
      schoolsByStatus: {
        ACTIVE: activeSchools.count ?? 0,
        INACTIVE: inactiveSchools.count ?? 0,
        SUSPENDED: suspendedSchools.count ?? 0,
        ARCHIVED: archivedSchools.count ?? 0,
      },
      totalUsers: usersByRole.ADMIN + usersByRole.TEACHER + usersByRole.STUDENT + usersByRole.PARENT,
      usersByRole,
    };
  }

  /** Full catalogue joined with this school's entitlement state — no row means enabled. */
  /**
   * Real effective state per module (via effective_enabled_modules(), the
   * same function RLS/FeatureGuard consult), annotated with *why* — clearly
   * distinguishing a custom override from package-derived entitlement.
   */
  async getSchoolModules(schoolId: string) {
    const { data: school } = await this.supabase.admin
      .from('schools')
      .select('id')
      .eq('id', schoolId)
      .maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    const [{ data: modules }, { data: schoolModules }, { data: subscription }, { data: effective }] = await Promise.all([
      this.supabase.admin
        .from('modules')
        .select('key, name, description, category, is_core, can_disable, status, dependencies')
        .order('category'),
      this.supabase.admin
        .from('school_modules')
        .select('module_key, enabled, config, enabled_at, disabled_at')
        .eq('school_id', schoolId),
      this.supabase.admin
        .from('school_subscriptions')
        .select('package_id')
        .eq('school_id', schoolId)
        .eq('status', 'ACTIVE')
        .maybeSingle(),
      this.supabase.admin.rpc('effective_enabled_modules', { p_school_id: schoolId }),
    ]);

    const stateByKey = new Map((schoolModules as SchoolModuleRow[] ?? []).map((m) => [m.module_key, m]));
    const effectiveEnabled = new Set(((effective as { module_key: string }[] | null) ?? []).map((r) => r.module_key));

    let packageEntitlementByKey = new Map<string, 'INCLUDED' | 'OPTIONAL_ADD_ON'>();
    if (subscription) {
      const { data: pkgModules } = await this.supabase.admin
        .from('package_modules')
        .select('module_key, entitlement')
        .eq('package_id', subscription.package_id);
      packageEntitlementByKey = new Map((pkgModules ?? []).map((m) => [m.module_key, m.entitlement]));
    }

    return (modules as ModuleRow[] ?? []).map((m) => {
      const state = stateByKey.get(m.key);
      const enabled = effectiveEnabled.has(m.key);

      let entitlementSource: 'OVERRIDE' | 'CORE' | 'PACKAGE_INCLUDED' | 'PACKAGE_ADD_ON' | 'PACKAGE_UNAVAILABLE' | 'DEFAULT';
      if (state) entitlementSource = 'OVERRIDE';
      else if (m.is_core) entitlementSource = 'CORE';
      else if (subscription) {
        const ent = packageEntitlementByKey.get(m.key);
        entitlementSource = ent === 'INCLUDED' ? 'PACKAGE_INCLUDED' : ent === 'OPTIONAL_ADD_ON' ? 'PACKAGE_ADD_ON' : 'PACKAGE_UNAVAILABLE';
      } else {
        entitlementSource = 'DEFAULT';
      }

      return {
        ...m,
        enabled,
        entitlementSource,
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

    if (!enabled) this.assertDisableable(targetModule);

    // Effective state (school_modules override > core > package
    // entitlement > default-enabled) — same source of truth as RLS, so
    // dependency checks here match what will actually be enforced.
    const { data: effective } = await this.supabase.admin.rpc('effective_enabled_modules', { p_school_id: schoolId });
    const effectiveEnabled = new Set(((effective as { module_key: string }[] | null) ?? []).map((r) => r.module_key));
    const isEnabled = (key: string) => effectiveEnabled.has(key);

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

  private assertDisableable(m: Pick<ModuleRow, 'key' | 'is_core' | 'can_disable'>) {
    if (m.is_core || !m.can_disable) {
      throw new BadRequestException(`Module '${m.key}' is core and cannot be disabled`);
    }
  }

  /** Bare module catalogue — no school context, so no per-school enabled state. */
  async listModuleCatalogue() {
    const { data, error } = await this.supabase.admin
      .from('modules')
      .select('key, name, description, category, is_core, can_disable, status, dependencies')
      .order('category');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Creates a school, its first ADMIN account, and any opening module
   * overrides in one logical operation. Postgres transactions can't span the
   * Auth Admin API + table writes, so this compensates on partial failure
   * (deletes whatever was already created) instead of leaving orphans.
   */
  async onboardSchool(input: OnboardSchoolInput, callerAuthId: string) {
    if (!input.admin.email && !input.admin.phone) {
      throw new BadRequestException('Admin must have either an email or phone number');
    }

    const caller = await this.resolveCaller(callerAuthId);

    const { data: allModules } = await this.supabase.admin
      .from('modules')
      .select('key, name, description, category, is_core, can_disable, status, dependencies');
    const modules = (allModules as ModuleRow[] | null) ?? [];
    const modulesToDisable: ModuleRow[] = [];
    for (const key of input.disabledModuleKeys) {
      const m = modules.find((mod) => mod.key === key);
      if (!m) throw new BadRequestException(`Unknown module: ${key}`);
      this.assertDisableable(m);
      modulesToDisable.push(m);
    }

    let schoolId: string | null = null;
    let authUserId: string | null = null;
    const now = new Date().toISOString();

    try {
      schoolId = randomUUID();
      const { error: schoolError } = await this.supabase.admin.from('schools').insert({
        id: schoolId,
        name: input.school.name,
        slug: input.school.slug,
        phone: input.school.phone ?? null,
        email: input.school.email ?? null,
        address: input.school.address ?? null,
        timezone: input.school.timezone ?? 'Africa/Nairobi',
        updated_at: now,
      });
      if (schoolError) {
        if (schoolError.code === '23505') throw new BadRequestException(`Slug '${input.school.slug}' is already in use`);
        throw new BadRequestException(schoolError.message);
      }

      const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
      const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
        email: input.admin.email,
        phone: input.admin.phone,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { school_id: schoolId, role: 'ADMIN', full_name: input.admin.fullName },
      });
      if (authError) throw new BadRequestException(authError.message);
      authUserId = authData.user.id;

      const userId = randomUUID();
      const { error: userError } = await this.supabase.admin.from('users').upsert({
        id: userId,
        school_id: schoolId,
        auth_id: authUserId,
        email: input.admin.email ?? null,
        phone: input.admin.phone ?? null,
        full_name: input.admin.fullName,
        role: 'ADMIN',
        updated_at: now,
      }, { onConflict: 'auth_id' });
      if (userError) throw new BadRequestException(userError.message);

      const { data: adminRow } = await this.supabase.admin
        .from('users')
        .select('id, full_name, email, phone')
        .eq('auth_id', authUserId)
        .single();

      for (const m of modulesToDisable) {
        const { error: moduleError } = await this.supabase.admin.from('school_modules').upsert({
          id: randomUUID(),
          school_id: schoolId,
          module_key: m.key,
          enabled: false,
          disabled_at: now,
          disabled_by: adminRow?.id ?? null,
          updated_at: now,
        }, { onConflict: 'school_id,module_key' });
        if (moduleError) throw new BadRequestException(moduleError.message);
      }

      await this.supabase.admin.from('audit_logs').insert({
        id: randomUUID(),
        school_id: schoolId,
        user_id: caller?.id ?? null,
        action: 'school.onboard',
        entity_type: 'school',
        entity_id: schoolId,
        metadata: {
          name: input.school.name,
          slug: input.school.slug,
          adminEmail: input.admin.email ?? null,
          disabledModuleKeys: input.disabledModuleKeys,
        },
      });

      const { data: school } = await this.supabase.admin
        .from('schools')
        .select('id, name, slug, status, created_at')
        .eq('id', schoolId)
        .single();

      return { school, admin: { ...adminRow, temporaryPassword: tempPassword } };
    } catch (err) {
      if (authUserId) await this.supabase.admin.auth.admin.deleteUser(authUserId).catch(() => {});
      if (schoolId) {
        try {
          await this.supabase.admin.from('schools').delete().eq('id', schoolId);
        } catch {
          // best-effort compensation — the original error is what matters
        }
      }
      throw err;
    }
  }

  // ── Packages ──────────────────────────────────────────────────────────────

  async listPackages() {
    const { data: packages, error } = await this.supabase.admin
      .from('packages')
      .select('id, name, description, price, currency, billing_cycle, is_active, display_order, created_at')
      .order('display_order');
    if (error) throw new BadRequestException(error.message);

    const pkgs = packages ?? [];
    if (pkgs.length === 0) return [];

    const [{ data: pkgModules }, { data: subs }] = await Promise.all([
      this.supabase.admin.from('package_modules').select('package_id, module_key, entitlement').in('package_id', pkgs.map((p) => p.id)),
      this.supabase.admin.from('school_subscriptions').select('package_id').eq('status', 'ACTIVE').in('package_id', pkgs.map((p) => p.id)),
    ]);

    const modulesByPackage = new Map<string, { moduleKey: string; entitlement: string }[]>();
    for (const m of pkgModules ?? []) {
      const list = modulesByPackage.get(m.package_id) ?? [];
      list.push({ moduleKey: m.module_key, entitlement: m.entitlement });
      modulesByPackage.set(m.package_id, list);
    }
    const schoolCountByPackage = new Map<string, number>();
    for (const s of subs ?? []) {
      schoolCountByPackage.set(s.package_id, (schoolCountByPackage.get(s.package_id) ?? 0) + 1);
    }

    return pkgs.map((p) => ({
      ...p,
      modules: modulesByPackage.get(p.id) ?? [],
      schoolCount: schoolCountByPackage.get(p.id) ?? 0,
    }));
  }

  async getPackage(packageId: string) {
    const { data: pkg, error } = await this.supabase.admin
      .from('packages')
      .select('id, name, description, price, currency, billing_cycle, is_active, display_order, created_at')
      .eq('id', packageId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!pkg) throw new NotFoundException('Package not found');

    const { data: pkgModules } = await this.supabase.admin
      .from('package_modules')
      .select('module_key, entitlement')
      .eq('package_id', packageId);

    return { ...pkg, modules: (pkgModules ?? []).map((m) => ({ moduleKey: m.module_key, entitlement: m.entitlement })) };
  }

  async createPackage(input: CreatePackageInput) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from('packages')
      .insert({
        id: randomUUID(),
        name: input.name,
        description: input.description ?? '',
        price: input.price,
        currency: input.currency ?? 'KES',
        billing_cycle: input.billingCycle ?? 'MONTHLY',
        display_order: input.displayOrder ?? 0,
        updated_at: now,
      })
      .select('id, name, description, price, currency, billing_cycle, is_active, display_order, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updatePackage(packageId: string, input: UpdatePackageInput) {
    const { data: existing } = await this.supabase.admin.from('packages').select('id').eq('id', packageId).maybeSingle();
    if (!existing) throw new NotFoundException('Package not found');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.price !== undefined) patch.price = input.price;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.billingCycle !== undefined) patch.billing_cycle = input.billingCycle;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const { data, error } = await this.supabase.admin
      .from('packages')
      .update(patch)
      .eq('id', packageId)
      .select('id, name, description, price, currency, billing_cycle, is_active, display_order, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async setPackageModules(packageId: string, input: SetPackageModulesInput) {
    const { data: pkg } = await this.supabase.admin.from('packages').select('id').eq('id', packageId).maybeSingle();
    if (!pkg) throw new NotFoundException('Package not found');

    const { data: validModules } = await this.supabase.admin.from('modules').select('key');
    const validKeys = new Set((validModules ?? []).map((m) => m.key));
    for (const m of input.modules) {
      if (!validKeys.has(m.moduleKey)) throw new BadRequestException(`Unknown module: ${m.moduleKey}`);
    }

    // Replace the full set: delete then insert, matching "one call, whole array" semantics.
    const { error: deleteError } = await this.supabase.admin.from('package_modules').delete().eq('package_id', packageId);
    if (deleteError) throw new BadRequestException(deleteError.message);

    if (input.modules.length > 0) {
      const { error: insertError } = await this.supabase.admin.from('package_modules').insert(
        input.modules.map((m) => ({ id: randomUUID(), package_id: packageId, module_key: m.moduleKey, entitlement: m.entitlement })),
      );
      if (insertError) throw new BadRequestException(insertError.message);
    }

    return this.getPackage(packageId);
  }

  // ── School subscriptions ─────────────────────────────────────────────────

  async getSchoolSubscription(schoolId: string) {
    const { data, error } = await this.supabase.admin
      .from('school_subscriptions')
      .select('id, package_id, status, started_at, package:packages(id, name, price, currency, billing_cycle)')
      .eq('school_id', schoolId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Diff current effective entitlements against a hypothetical package,
   * via simulate_effective_modules() — the exact same resolution chain as
   * the real thing (Phase 6), so this preview can never drift from what
   * actually happens on switch.
   */
  async previewSubscriptionChange(schoolId: string, targetPackageId: string) {
    const { data: school } = await this.supabase.admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    const [{ data: targetPkg }, { data: currentSub }, { data: allModules }, { data: currentEff }, { data: targetEff }] = await Promise.all([
      this.supabase.admin.from('packages').select('id, name, price, currency, billing_cycle').eq('id', targetPackageId).maybeSingle(),
      this.supabase.admin
        .from('school_subscriptions')
        .select('package:packages(id, name, price)')
        .eq('school_id', schoolId)
        .eq('status', 'ACTIVE')
        .maybeSingle(),
      this.supabase.admin.from('modules').select('key, name'),
      this.supabase.admin.rpc('effective_enabled_modules', { p_school_id: schoolId }),
      this.supabase.admin.rpc('simulate_effective_modules', { p_school_id: schoolId, p_hypothetical_package_id: targetPackageId }),
    ]);
    if (!targetPkg) throw new NotFoundException('Package not found');

    const nameByKey = new Map((allModules ?? []).map((m) => [m.key, m.name]));
    const currentKeys = new Set(((currentEff as { module_key: string }[] | null) ?? []).map((r) => r.module_key));
    const targetKeys = new Set(((targetEff as { module_key: string }[] | null) ?? []).map((r) => r.module_key));

    const toRow = (key: string) => ({ key, name: nameByKey.get(key) ?? key });
    const modulesGained = [...targetKeys].filter((k) => !currentKeys.has(k)).map(toRow);
    const modulesLost = [...currentKeys].filter((k) => !targetKeys.has(k)).map(toRow);

    const currentPackage = (currentSub?.package as unknown as { id: string; name: string; price: number } | null) ?? null;
    const priceDifference = targetPkg.price - (currentPackage?.price ?? 0);
    const changeType: 'NEW' | 'UPGRADE' | 'DOWNGRADE' | 'LATERAL' = !currentPackage
      ? 'NEW'
      : priceDifference > 0 ? 'UPGRADE' : priceDifference < 0 ? 'DOWNGRADE' : 'LATERAL';

    return {
      currentPackage,
      targetPackage: targetPkg,
      priceDifference,
      changeType,
      modulesGained,
      modulesLost,
    };
  }

  async assignSchoolSubscription(schoolId: string, input: AssignSubscriptionInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: school } = await this.supabase.admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
    if (!school) throw new NotFoundException('School not found');
    const { data: pkg } = await this.supabase.admin.from('packages').select('id, name').eq('id', input.packageId).maybeSingle();
    if (!pkg) throw new NotFoundException('Package not found');

    const now = new Date().toISOString();

    const { error: cancelError } = await this.supabase.admin
      .from('school_subscriptions')
      .update({ status: 'CANCELLED', updated_at: now })
      .eq('school_id', schoolId)
      .eq('status', 'ACTIVE');
    if (cancelError) throw new BadRequestException(cancelError.message);

    const { data, error } = await this.supabase.admin
      .from('school_subscriptions')
      .insert({
        id: randomUUID(),
        school_id: schoolId,
        package_id: input.packageId,
        status: 'ACTIVE',
        started_at: now,
        updated_at: now,
      })
      .select('id, package_id, status, started_at')
      .single();
    if (error) throw new BadRequestException(error.message);

    // "Convert to add-on": explicit overrides for modules the SuperAdmin
    // chose to keep despite the new package not including them. Overrides
    // always win at priority 1 of the entitlement chain (Phase 6).
    for (const moduleKey of input.preserveModuleKeys ?? []) {
      const { error: overrideError } = await this.supabase.admin.from('school_modules').upsert({
        id: randomUUID(),
        school_id: schoolId,
        module_key: moduleKey,
        enabled: true,
        enabled_at: now,
        enabled_by: caller?.id ?? null,
        updated_at: now,
      }, { onConflict: 'school_id,module_key' });
      if (overrideError) throw new BadRequestException(overrideError.message);
    }

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: caller?.id ?? null,
      action: 'school.subscription_change',
      entity_type: 'school_subscriptions',
      entity_id: data.id,
      metadata: { package_id: input.packageId, package_name: pkg.name, preserved_module_keys: input.preserveModuleKeys ?? [] },
    });

    return data;
  }

  // ── Curriculum catalog ───────────────────────────────────────────────────

  async listCurricula() {
    const { data: curricula, error } = await this.supabase.admin
      .from('curricula')
      .select('id, name, description, is_active, display_order, created_at, code, country_code, source_url, source_verified_on')
      .order('display_order');
    if (error) throw new BadRequestException(error.message);

    const list = curricula ?? [];
    if (list.length === 0) return [];

    const { data: subjects } = await this.supabase.admin
      .from('curriculum_subjects')
      .select('curriculum_id')
      .in('curriculum_id', list.map((c) => c.id));
    const subjectCountByCurriculum = new Map<string, number>();
    for (const s of subjects ?? []) {
      subjectCountByCurriculum.set(s.curriculum_id, (subjectCountByCurriculum.get(s.curriculum_id) ?? 0) + 1);
    }

    return list.map((c) => ({ ...c, subjectCount: subjectCountByCurriculum.get(c.id) ?? 0 }));
  }

  async getCurriculum(curriculumId: string) {
    const { data: curriculum, error } = await this.supabase.admin
      .from('curricula')
      .select('id, name, description, is_active, display_order, created_at, code, country_code, source_url, source_verified_on')
      .eq('id', curriculumId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!curriculum) throw new NotFoundException('Curriculum not found');

    const { data: subjects } = await this.supabase.admin
      .from('curriculum_subjects')
      .select(
        'id, grade_level, name, code, display_order, is_core, verified, verification_note, pathway, grade_level_id, grade_level_info:curriculum_grade_levels(code, name, sequence_number, age_range_from, age_range_to)',
      )
      .eq('curriculum_id', curriculumId)
      .order('grade_level')
      .order('display_order');

    const subjectList = subjects ?? [];
    const { data: strands } = subjectList.length
      ? await this.supabase.admin
          .from('curriculum_subject_strands')
          .select('curriculum_subject_id, name, display_order')
          .in('curriculum_subject_id', subjectList.map((s) => s.id))
          .order('display_order')
      : { data: [] };
    const strandsBySubject = new Map<string, string[]>();
    for (const s of strands ?? []) {
      const list = strandsBySubject.get(s.curriculum_subject_id) ?? [];
      list.push(s.name);
      strandsBySubject.set(s.curriculum_subject_id, list);
    }

    return {
      ...curriculum,
      subjects: subjectList.map((s) => ({ ...s, strands: strandsBySubject.get(s.id) ?? [] })),
    };
  }

  async createCurriculum(input: CreateCurriculumInput) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from('curricula')
      .insert({
        id: randomUUID(),
        name: input.name,
        description: input.description ?? '',
        display_order: input.displayOrder ?? 0,
        code: input.code ?? null,
        country_code: input.countryCode ?? 'KE',
        source_url: input.sourceUrl ?? null,
        source_verified_on: input.sourceVerifiedOn ?? null,
        updated_at: now,
      })
      .select('id, name, description, is_active, display_order, created_at, code, country_code, source_url, source_verified_on')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateCurriculum(curriculumId: string, input: UpdateCurriculumInput) {
    const { data: existing } = await this.supabase.admin.from('curricula').select('id').eq('id', curriculumId).maybeSingle();
    if (!existing) throw new NotFoundException('Curriculum not found');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.code !== undefined) patch.code = input.code;
    if (input.countryCode !== undefined) patch.country_code = input.countryCode;
    if (input.sourceUrl !== undefined) patch.source_url = input.sourceUrl;
    if (input.sourceVerifiedOn !== undefined) patch.source_verified_on = input.sourceVerifiedOn;

    const { data, error } = await this.supabase.admin
      .from('curricula')
      .update(patch)
      .eq('id', curriculumId)
      .select('id, name, description, is_active, display_order, created_at, code, country_code, source_url, source_verified_on')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async setCurriculumSubjects(curriculumId: string, input: SetCurriculumSubjectsInput) {
    const { data: curriculum } = await this.supabase.admin.from('curricula').select('id').eq('id', curriculumId).maybeSingle();
    if (!curriculum) throw new NotFoundException('Curriculum not found');

    const { error: deleteError } = await this.supabase.admin.from('curriculum_subjects').delete().eq('curriculum_id', curriculumId);
    if (deleteError) throw new BadRequestException(deleteError.message);

    if (input.subjects.length > 0) {
      const { error: insertError } = await this.supabase.admin.from('curriculum_subjects').insert(
        input.subjects.map((s) => ({
          id: randomUUID(),
          curriculum_id: curriculumId,
          grade_level: s.gradeLevel,
          name: s.name,
          code: s.code ?? null,
        })),
      );
      if (insertError) throw new BadRequestException(insertError.message);
    }

    return this.getCurriculum(curriculumId);
  }

  // ── School curriculum assignment ─────────────────────────────────────────

  async getSchoolCurriculum(schoolId: string) {
    const { data, error } = await this.supabase.admin
      .from('schools')
      .select('curriculum:curricula(id, name, description)')
      .eq('id', schoolId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('School not found');
    return data.curriculum ?? null;
  }

  async assignSchoolCurriculum(schoolId: string, input: AssignCurriculumInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: school } = await this.supabase.admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    if (input.curriculumId) {
      const { data: curriculum } = await this.supabase.admin.from('curricula').select('id').eq('id', input.curriculumId).maybeSingle();
      if (!curriculum) throw new NotFoundException('Curriculum not found');
    }

    const { error } = await this.supabase.admin
      .from('schools')
      .update({ curriculum_id: input.curriculumId, updated_at: new Date().toISOString() })
      .eq('id', schoolId);
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: caller?.id ?? null,
      action: 'school.curriculum_change',
      entity_type: 'school',
      entity_id: schoolId,
      metadata: { curriculum_id: input.curriculumId },
    });

    return this.getSchoolCurriculum(schoolId);
  }

  // ── Platform intelligence (Phase 9) ──────────────────────────────────────
  // Every number here traces back to a real, already-collected column —
  // no MRR/ARR/trials/churn/support/system-error metrics, since none of
  // that data exists in this system yet (see the Phase 9 plan for why).

  async getGrowthAnalytics(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: schools }, { data: users }] = await Promise.all([
      this.supabase.admin.from('schools').select('created_at').gte('created_at', since),
      this.supabase.admin.from('users').select('created_at').gte('created_at', since),
    ]);

    const bucketByDay = (rows: { created_at: string }[]) => {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const day = r.created_at.slice(0, 10);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
    };

    return {
      days,
      schoolsByDay: bucketByDay(schools ?? []),
      usersByDay: bucketByDay(users ?? []),
      totalNewSchools: (schools ?? []).length,
      totalNewUsers: (users ?? []).length,
    };
  }

  async getModuleAdoption() {
    const [{ data: schools }, { data: modules }, { data: overrides }, { data: subs }] = await Promise.all([
      this.supabase.admin.from('schools').select('id').eq('status', 'ACTIVE'),
      this.supabase.admin.from('modules').select('key, name, is_core').order('category'),
      this.supabase.admin.from('school_modules').select('school_id, module_key, enabled'),
      this.supabase.admin.from('school_subscriptions').select('school_id, package_id').eq('status', 'ACTIVE'),
    ]);

    const schoolIds = (schools ?? []).map((s) => s.id);
    const totalSchools = schoolIds.length;
    const nonCoreModules = (modules ?? []).filter((m) => !m.is_core);

    if (totalSchools === 0) {
      return nonCoreModules.map((m) => ({ key: m.key, name: m.name, enabledCount: 0, totalSchools: 0, percentage: 0 }));
    }

    const packageIdBySchool = new Map((subs ?? []).map((s) => [s.school_id, s.package_id]));
    const packageIds = [...new Set((subs ?? []).map((s) => s.package_id))];
    const { data: pkgModules } = packageIds.length
      ? await this.supabase.admin.from('package_modules').select('package_id, module_key, entitlement').in('package_id', packageIds)
      : { data: [] };
    const entitlementByPackageModule = new Map((pkgModules ?? []).map((pm) => [`${pm.package_id}:${pm.module_key}`, pm.entitlement]));
    const overrideBySchoolModule = new Map((overrides ?? []).map((o) => [`${o.school_id}:${o.module_key}`, o.enabled]));

    return nonCoreModules.map((m) => {
      let enabledCount = 0;
      for (const schoolId of schoolIds) {
        const overrideKey = `${schoolId}:${m.key}`;
        let enabled: boolean;
        if (overrideBySchoolModule.has(overrideKey)) {
          enabled = overrideBySchoolModule.get(overrideKey)!;
        } else {
          const packageId = packageIdBySchool.get(schoolId);
          enabled = packageId ? entitlementByPackageModule.get(`${packageId}:${m.key}`) === 'INCLUDED' : true;
        }
        if (enabled) enabledCount++;
      }
      return { key: m.key, name: m.name, enabledCount, totalSchools, percentage: Math.round((enabledCount / totalSchools) * 100) };
    });
  }

  async getPackageAnalytics() {
    const packages = await this.listPackages();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: subscriptionChangesLast30Days } = await this.supabase.admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'school.subscription_change')
      .gte('created_at', since30d);

    return {
      packages: packages.map((p) => ({ id: p.id, name: p.name, price: p.price, currency: p.currency, schoolCount: p.schoolCount })),
      subscriptionChangesLast30Days: subscriptionChangesLast30Days ?? 0,
    };
  }

  async getSchoolHealth() {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: schools }, { data: recentLogins }, { data: recentAttendance }, { data: recentAssessments }, { data: recentGrades }] = await Promise.all([
      this.supabase.admin.from('schools').select('id, name, status'),
      this.supabase.admin.from('audit_logs').select('school_id').eq('action', 'auth.login').gte('created_at', since7d),
      this.supabase.admin.from('attendance_records').select('school_id').gte('created_at', since7d),
      this.supabase.admin.from('assessments').select('school_id').gte('created_at', since30d),
      this.supabase.admin.from('grades').select('school_id').gte('created_at', since30d),
    ]);

    const loginSchools = new Set((recentLogins ?? []).map((r) => r.school_id));
    const attendanceSchools = new Set((recentAttendance ?? []).map((r) => r.school_id));
    const gradebookSchools = new Set([
      ...(recentAssessments ?? []).map((r) => r.school_id),
      ...(recentGrades ?? []).map((r) => r.school_id),
    ]);

    return (schools ?? []).map((s) => {
      if (s.status !== 'ACTIVE') {
        return { id: s.id, name: s.name, status: 'INACTIVE' as const, reasons: [`School lifecycle status is ${s.status}`] };
      }

      const reasons: string[] = [];
      if (!loginSchools.has(s.id)) reasons.push('No logins in the last 7 days');
      if (!attendanceSchools.has(s.id)) reasons.push('No attendance marked in the last 7 days');
      if (!gradebookSchools.has(s.id)) reasons.push('No assessment or grade activity in the last 30 days');

      const status = reasons.length >= 2 ? 'AT_RISK' as const : reasons.length === 1 ? 'NEEDS_ATTENTION' as const : 'HEALTHY' as const;
      return { id: s.id, name: s.name, status, reasons };
    });
  }
}
