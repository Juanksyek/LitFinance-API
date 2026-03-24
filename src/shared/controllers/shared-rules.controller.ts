import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedRulesService } from '../services/shared-rules.service';
import { CreateSplitRuleDto, UpdateSplitRuleDto } from '../dto/shared-split-rule.dto';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('shared/spaces/:spaceId/rules')
export class SharedRulesController {
  constructor(private readonly rulesService: SharedRulesService) {}

  /** POST /shared/spaces/:spaceId/rules — Crear regla de split */
  @Post()
  create(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Body() dto: CreateSplitRuleDto,
  ) {
    return this.rulesService.create(spaceId, dto, req.user.id);
  }

  /** GET /shared/spaces/:spaceId/rules — Listar reglas */
  @Get()
  list(@Req() req, @Param('spaceId') spaceId: string) {
    return this.rulesService.list(spaceId);
  }

  /** PATCH /shared/spaces/:spaceId/rules/:ruleId — Actualizar regla */
  @Patch(':ruleId')
  update(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateSplitRuleDto,
  ) {
    return this.rulesService.update(spaceId, ruleId, dto, req.user.id);
  }

  /** DELETE /shared/spaces/:spaceId/rules/:ruleId — Archivar regla */
  @Delete(':ruleId')
  archive(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.rulesService.archive(spaceId, ruleId, req.user.id);
  }
}
