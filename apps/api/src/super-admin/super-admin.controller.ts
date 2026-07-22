import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
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
  type CreateSchoolInput as CreateSchoolInputType,
  type UpdateSchoolInput as UpdateSchoolInputType,
  type UpdateSchoolStatusInput as UpdateSchoolStatusInputType,
  type OnboardSchoolInput as OnboardSchoolInputType,
  type CreatePackageInput as CreatePackageInputType,
  type UpdatePackageInput as UpdatePackageInputType,
  type SetPackageModulesInput as SetPackageModulesInputType,
  type AssignSubscriptionInput as AssignSubscriptionInputType,
  type CreateCurriculumInput as CreateCurriculumInputType,
  type UpdateCurriculumInput as UpdateCurriculumInputType,
  type SetCurriculumSubjectsInput as SetCurriculumSubjectsInputType,
  type AssignCurriculumInput as AssignCurriculumInputType,
} from '@school-manager/types';
import { SuperAdminService } from './super-admin.service';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly svc: SuperAdminService) {}

  @ApiOperation({ summary: 'Real, currently-computable platform metrics (schools + user counts)' })
  @RequirePlatformPermission('VIEW_PLATFORM_ANALYTICS')
  @Get('dashboard')
  getDashboardStats() {
    return this.svc.getDashboardStats();
  }

  @ApiOperation({ summary: 'List all schools on the platform' })
  @RequirePlatformPermission('VIEW_SCHOOLS')
  @Get('schools')
  listSchools() {
    return this.svc.listSchools();
  }

  @ApiOperation({ summary: "Get a single school's full profile" })
  @RequirePlatformPermission('VIEW_SCHOOLS')
  @Get('schools/:id')
  getSchool(@Param('id') schoolId: string) {
    return this.svc.getSchool(schoolId);
  }

  @ApiOperation({ summary: "Real, currently-computable stats for a single school (users, academic, engagement)" })
  @RequirePlatformPermission('VIEW_SCHOOLS')
  @Get('schools/:id/overview')
  getSchoolOverview(@Param('id') schoolId: string) {
    return this.svc.getSchoolOverview(schoolId);
  }

  @ApiOperation({ summary: 'Create a new school' })
  @RequirePlatformPermission('MANAGE_SCHOOLS')
  @Post('schools')
  createSchool(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateSchoolInput)) input: CreateSchoolInputType,
  ) {
    return this.svc.createSchool(input, user.id);
  }

  @ApiOperation({ summary: 'Onboard a new school: create it, its first ADMIN, and any opening module overrides in one operation' })
  @RequirePlatformPermission('MANAGE_SCHOOLS')
  @Post('schools/onboard')
  onboardSchool(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(OnboardSchoolInput)) input: OnboardSchoolInputType,
  ) {
    return this.svc.onboardSchool(input, user.id);
  }

  @ApiOperation({ summary: 'Bare module catalogue (no school context)' })
  @RequirePlatformPermission('VIEW_MODULES')
  @Get('modules')
  listModuleCatalogue() {
    return this.svc.listModuleCatalogue();
  }

  @ApiOperation({ summary: "Update a school's profile fields" })
  @RequirePlatformPermission('MANAGE_SCHOOLS')
  @Patch('schools/:id')
  updateSchool(
    @CurrentUser() user: { id: string },
    @Param('id') schoolId: string,
    @Body(new ZodValidationPipe(UpdateSchoolInput)) input: UpdateSchoolInputType,
  ) {
    return this.svc.updateSchool(schoolId, input, user.id);
  }

  @ApiOperation({ summary: "Transition a school's lifecycle status" })
  @RequirePlatformPermission('MANAGE_SCHOOLS')
  @Patch('schools/:id/status')
  updateSchoolStatus(
    @CurrentUser() user: { id: string },
    @Param('id') schoolId: string,
    @Body(new ZodValidationPipe(UpdateSchoolStatusInput)) input: UpdateSchoolStatusInputType,
  ) {
    return this.svc.updateSchoolStatus(schoolId, input, user.id);
  }

  @ApiOperation({ summary: "Get a school's full module catalogue with its entitlement state" })
  @RequirePlatformPermission('VIEW_SCHOOLS')
  @Get('schools/:id/modules')
  getSchoolModules(@Param('id') schoolId: string) {
    return this.svc.getSchoolModules(schoolId);
  }

  @ApiOperation({ summary: 'Enable or disable a module for a specific school' })
  @RequirePlatformPermission('MANAGE_MODULES')
  @Patch('schools/:id/modules/:key')
  toggleModule(
    @CurrentUser() user: { id: string },
    @Param('id') schoolId: string,
    @Param('key') moduleKey: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.svc.toggleModule(schoolId, moduleKey, body.enabled, user.id);
  }

  // ── Packages ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List all packages, with their module entitlements and subscriber counts' })
  @RequirePlatformPermission('VIEW_PACKAGES')
  @Get('packages')
  listPackages() {
    return this.svc.listPackages();
  }

  @ApiOperation({ summary: "Get a single package's profile and module entitlements" })
  @RequirePlatformPermission('VIEW_PACKAGES')
  @Get('packages/:id')
  getPackage(@Param('id') packageId: string) {
    return this.svc.getPackage(packageId);
  }

  @ApiOperation({ summary: 'Create a new package' })
  @RequirePlatformPermission('MANAGE_PACKAGES')
  @Post('packages')
  createPackage(@Body(new ZodValidationPipe(CreatePackageInput)) input: CreatePackageInputType) {
    return this.svc.createPackage(input);
  }

  @ApiOperation({ summary: "Update a package's profile fields" })
  @RequirePlatformPermission('MANAGE_PACKAGES')
  @Patch('packages/:id')
  updatePackage(
    @Param('id') packageId: string,
    @Body(new ZodValidationPipe(UpdatePackageInput)) input: UpdatePackageInputType,
  ) {
    return this.svc.updatePackage(packageId, input);
  }

  @ApiOperation({ summary: "Replace a package's full module-entitlement set" })
  @RequirePlatformPermission('MANAGE_PACKAGES')
  @Put('packages/:id/modules')
  setPackageModules(
    @Param('id') packageId: string,
    @Body(new ZodValidationPipe(SetPackageModulesInput)) input: SetPackageModulesInputType,
  ) {
    return this.svc.setPackageModules(packageId, input);
  }

  // ── School subscriptions ─────────────────────────────────────────────────

  @ApiOperation({ summary: "Get a school's current package subscription, if any" })
  @RequirePlatformPermission('VIEW_SCHOOLS')
  @Get('schools/:id/subscription')
  getSchoolSubscription(@Param('id') schoolId: string) {
    return this.svc.getSchoolSubscription(schoolId);
  }

  @ApiOperation({ summary: 'Preview the module-access impact of switching a school to a candidate package, without changing anything' })
  @RequirePlatformPermission('VIEW_SCHOOLS')
  @Get('schools/:id/subscription/preview')
  previewSubscriptionChange(@Param('id') schoolId: string, @Query('packageId') packageId: string) {
    return this.svc.previewSubscriptionChange(schoolId, packageId);
  }

  @ApiOperation({ summary: "Assign or switch a school's package subscription" })
  @RequirePlatformPermission('MANAGE_SCHOOLS')
  @Post('schools/:id/subscription')
  assignSchoolSubscription(
    @CurrentUser() user: { id: string },
    @Param('id') schoolId: string,
    @Body(new ZodValidationPipe(AssignSubscriptionInput)) input: AssignSubscriptionInputType,
  ) {
    return this.svc.assignSchoolSubscription(schoolId, input, user.id);
  }

  // ── Curriculum catalog ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List all curricula, with subject counts' })
  @RequirePlatformPermission('VIEW_CURRICULUM')
  @Get('curricula')
  listCurricula() {
    return this.svc.listCurricula();
  }

  @ApiOperation({ summary: "Get a single curriculum's profile and grade-level subject list" })
  @RequirePlatformPermission('VIEW_CURRICULUM')
  @Get('curricula/:id')
  getCurriculum(@Param('id') curriculumId: string) {
    return this.svc.getCurriculum(curriculumId);
  }

  @ApiOperation({ summary: 'Create a new curriculum' })
  @RequirePlatformPermission('MANAGE_CURRICULUM')
  @Post('curricula')
  createCurriculum(@Body(new ZodValidationPipe(CreateCurriculumInput)) input: CreateCurriculumInputType) {
    return this.svc.createCurriculum(input);
  }

  @ApiOperation({ summary: "Update a curriculum's profile fields" })
  @RequirePlatformPermission('MANAGE_CURRICULUM')
  @Patch('curricula/:id')
  updateCurriculum(
    @Param('id') curriculumId: string,
    @Body(new ZodValidationPipe(UpdateCurriculumInput)) input: UpdateCurriculumInputType,
  ) {
    return this.svc.updateCurriculum(curriculumId, input);
  }

  @ApiOperation({ summary: "Replace a curriculum's full grade-level subject list" })
  @RequirePlatformPermission('MANAGE_CURRICULUM')
  @Put('curricula/:id/subjects')
  setCurriculumSubjects(
    @Param('id') curriculumId: string,
    @Body(new ZodValidationPipe(SetCurriculumSubjectsInput)) input: SetCurriculumSubjectsInputType,
  ) {
    return this.svc.setCurriculumSubjects(curriculumId, input);
  }

  // ── School curriculum assignment ─────────────────────────────────────────

  @ApiOperation({ summary: "Get a school's assigned curriculum, if any" })
  @RequirePlatformPermission('VIEW_SCHOOLS')
  @Get('schools/:id/curriculum')
  getSchoolCurriculum(@Param('id') schoolId: string) {
    return this.svc.getSchoolCurriculum(schoolId);
  }

  @ApiOperation({ summary: "Assign or clear a school's curriculum tag — informational only, never touches the school's own subjects/classes/terms" })
  @RequirePlatformPermission('MANAGE_SCHOOLS')
  @Post('schools/:id/curriculum')
  assignSchoolCurriculum(
    @CurrentUser() user: { id: string },
    @Param('id') schoolId: string,
    @Body(new ZodValidationPipe(AssignCurriculumInput)) input: AssignCurriculumInputType,
  ) {
    return this.svc.assignSchoolCurriculum(schoolId, input, user.id);
  }

  // ── Platform intelligence ────────────────────────────────────────────────

  @ApiOperation({ summary: 'Schools and users created over a time window, bucketed by day' })
  @RequirePlatformPermission('VIEW_PLATFORM_ANALYTICS')
  @Get('analytics/growth')
  getGrowthAnalytics(@Query('days') days?: string) {
    const parsed = Number(days);
    const window = [7, 30, 90, 365].includes(parsed) ? parsed : 30;
    return this.svc.getGrowthAnalytics(window);
  }

  @ApiOperation({ summary: 'Per-module count and percentage of active schools with it enabled, platform-wide' })
  @RequirePlatformPermission('VIEW_PLATFORM_ANALYTICS')
  @Get('analytics/modules')
  getModuleAdoption() {
    return this.svc.getModuleAdoption();
  }

  @ApiOperation({ summary: 'Schools-per-package distribution and recent subscription-change activity' })
  @RequirePlatformPermission('VIEW_PLATFORM_ANALYTICS')
  @Get('analytics/packages')
  getPackageAnalytics() {
    return this.svc.getPackageAnalytics();
  }

  @ApiOperation({ summary: 'Explainable health status per school, based only on real activity signals' })
  @RequirePlatformPermission('VIEW_PLATFORM_ANALYTICS')
  @Get('analytics/school-health')
  getSchoolHealth() {
    return this.svc.getSchoolHealth();
  }
}
