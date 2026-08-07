import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  UploadDocumentInput, type UploadDocumentInput as UploadDocumentInputType,
  RetagDocumentInput, type RetagDocumentInput as RetagDocumentInputType,
  DocumentQuery, type DocumentQuery as DocumentQueryType,
} from '@school-manager/types';
import { DocumentsService } from './documents.service';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('documents')
@UseGuards(AuthGuard, FeatureGuard)
@RequireModule('document_library')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@AccessToken() token: string, @Query(new ZodValidationPipe(DocumentQuery)) query: DocumentQueryType) {
    return this.documents.list(token, query);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @AccessToken() token: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadDocumentInput)) metadata: UploadDocumentInputType,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.documents.upload(token, file, metadata);
  }

  @Get(':id/download-url')
  getDownloadUrl(@AccessToken() token: string, @Param('id') id: string) {
    return this.documents.issueDownloadUrl(token, id);
  }

  // Aggregated-only — see document_download_counts()'s own migration
  // comment. Never exposes per-user download identity.
  @Get('download-counts')
  downloadCounts(@AccessToken() token: string, @Query('ids') ids: string) {
    const documentIds = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.documents.downloadCounts(token, documentIds);
  }

  @Patch(':id')
  retag(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RetagDocumentInput)) input: RetagDocumentInputType,
  ) {
    return this.documents.retag(token, id, input);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.documents.remove(token, id);
  }
}
