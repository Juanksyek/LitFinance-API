import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BlocsService } from './blocs.service';
import { CreateBlocDto } from './dto/create-bloc.dto';
import { CreateBlocItemDto } from './dto/create-bloc-item.dto';
import { UpdateBlocItemDto } from './dto/update-bloc-item.dto';
import { LiquidarBlocDto, LiquidarBlocPreviewDto } from './dto/liquidar-bloc.dto';
import { PatchBlocItemsDto } from './dto/patch-bloc-items.dto';
import { UpdateBlocDto } from './dto/update-bloc.dto';

@UseGuards(JwtAuthGuard)
@Controller('blocs')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class BlocsController {
  constructor(private readonly blocsService: BlocsService) {}

  @Post()
  async crearBloc(@Req() req, @Body() dto: CreateBlocDto) {
    return this.blocsService.crearBloc(dto, req.user.id);
  }

  @Get()
  async listar(@Req() req) {
    return this.blocsService.listarBlocs(req.user.id);
  }

  @Get(':blocId')
  async obtener(@Req() req, @Param('blocId') blocId: string) {
    return this.blocsService.obtenerBloc(blocId, req.user.id);
  }

  @Patch(':blocId')
  async actualizarBloc(@Req() req, @Param('blocId') blocId: string, @Body() dto: UpdateBlocDto) {
    return this.blocsService.actualizarBloc(blocId, dto, req.user.id);
  }

  @Post(':blocId/items')
  async crearItems(@Req() req, @Param('blocId') blocId: string, @Body() body: any) {
    return this.blocsService.crearItems(blocId, body, req.user.id);
  }

  // Batch: upsert + delete múltiples items (ideal para autosave)
  @Patch(':blocId/items')
  async patchItems(@Req() req, @Param('blocId') blocId: string, @Body() dto: PatchBlocItemsDto) {
    return this.blocsService.patchItems(blocId, dto, req.user.id);
  }

  @Patch(':blocId/items/:itemId')
  async actualizarItem(
    @Req() req,
    @Param('blocId') blocId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateBlocItemDto,
  ) {
    return this.blocsService.actualizarItem(blocId, itemId, dto, req.user.id);
  }

  @Post(':blocId/liquidar/preview')
  async previewLiquidacion(
    @Req() req,
    @Param('blocId') blocId: string,
    @Body() dto: LiquidarBlocPreviewDto,
  ) {
    return this.blocsService.previewLiquidacion(blocId, dto, req.user.id);
  }

  @Post(':blocId/liquidar')
  async liquidar(
    @Req() req,
    @Param('blocId') blocId: string,
    @Body() dto: LiquidarBlocDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    return this.blocsService.liquidar(blocId, dto, req.user.id, idempotencyKeyHeader);
  }

  @Get(':blocId/liquidaciones')
  async listarLiquidaciones(@Req() req, @Param('blocId') blocId: string) {
    return this.blocsService.listarLiquidaciones(blocId, req.user.id);
  }
}
