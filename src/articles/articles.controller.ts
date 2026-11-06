import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { ArticlePublishingService } from './article-publishing.service';
import { ArticlesService } from './articles.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles.query.dto';
import { RevisionDto } from './dto/revision.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

type AuthenticatedRequest = {
  user: { sub: string; role: AccountRole };
};

/** Articles in the back office: ADMIN only in the MVP. */
@ApiTags('articles')
@ApiBearerAuth('jwt')
@Controller('articles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN)
export class ArticlesController {
  constructor(
    private readonly service: ArticlesService,
    private readonly publishing: ArticlePublishingService,
  ) {}

  @Get()
  list(@Query() q: ListArticlesQueryDto) {
    return this.service.list(q);
  }

  @Post()
  create(@Body() dto: CreateArticleDto, @Req() req: AuthenticatedRequest) {
    return this.service.create(dto, req.user.sub);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Patch(':id/draft')
  saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveDraftDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.saveDraft(id, dto, req.user.sub);
  }

  /** First publish, republish, or "Update": the draft at `baseRevision` goes live. */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.publishing.publish(id, dto.baseRevision, req.user.sub);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.publishing.unpublish(id, req.user.sub);
  }

  /** Throws away the draft's changes: the draft becomes the published version again. */
  @Post(':id/discard-draft')
  @HttpCode(HttpStatus.OK)
  discardDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.publishing.discardDraft(id, dto.baseRevision, req.user.sub);
  }

  /** Permanent; refused (409) while the article is published. */
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.publishing.delete(id);
  }
}
