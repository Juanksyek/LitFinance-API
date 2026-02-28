import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UseGuards,
	UsePipes,
	ValidationPipe,
	Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GoalsService } from './goals.service';
import { CreateMetaDto, ListMetasQueryDto, MetaMoneyDto, ResolveMetaCompletionDto, UpdateMetaDto } from './dto/metas.dto';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('metas')
export class GoalsController {
	constructor(
		private readonly goalsService: GoalsService,
	) {}

	@Post()
	async crear(@Req() req, @Body() dto: CreateMetaDto) {
		const userId = req.user.id;
		return this.goalsService.crearMeta(userId, dto);
	}

	@Get()
	listar(@Req() req, @Query() q: ListMetasQueryDto) {
		return this.goalsService.listarMetas(req.user.id, q);
	}

	@Get(':metaId')
	obtener(@Req() req, @Param('metaId') metaId: string) {
		return this.goalsService.obtenerMeta(req.user.id, metaId);
	}

	@Patch(':metaId')
	actualizar(@Req() req, @Param('metaId') metaId: string, @Body() dto: UpdateMetaDto) {
		return this.goalsService.actualizarMeta(req.user.id, metaId, dto);
	}

	@Patch(':metaId/pausar')
	pausar(@Req() req, @Param('metaId') metaId: string) {
		return this.goalsService.pausar(req.user.id, metaId);
	}

	@Patch(':metaId/reanudar')
	reanudar(@Req() req, @Param('metaId') metaId: string) {
		return this.goalsService.reanudar(req.user.id, metaId);
	}

	@Patch(':metaId/archivar')
	archivar(@Req() req, @Param('metaId') metaId: string) {
		return this.goalsService.archivar(req.user.id, metaId);
	}

	@Post(':metaId/aporte')
	aporte(@Req() req, @Param('metaId') metaId: string, @Body() dto: MetaMoneyDto) {
		return this.goalsService.aporte(req.user.id, metaId, dto);
	}

	// Nuevo (preferido): ingreso a meta (desde cuenta principal o subcuenta)
	@Post(':metaId/ingreso')
	ingreso(@Req() req, @Param('metaId') metaId: string, @Body() dto: MetaMoneyDto) {
		return this.goalsService.ingreso(req.user.id, metaId, dto);
	}

	@Post(':metaId/retiro')
	retiro(@Req() req, @Param('metaId') metaId: string, @Body() dto: MetaMoneyDto) {
		return this.goalsService.retiro(req.user.id, metaId, dto);
	}

	// Nuevo (preferido): egreso desde meta (a cuenta principal o subcuenta)
	@Post(':metaId/egreso')
	egreso(@Req() req, @Param('metaId') metaId: string, @Body() dto: MetaMoneyDto) {
		return this.goalsService.egreso(req.user.id, metaId, dto);
	}

	@Get(':metaId/historial')
	historial(
		@Req() req,
		@Param('metaId') metaId: string,
		@Query('page') page = '1',
		@Query('limit') limit = '20',
	) {
		return this.goalsService.historial(req.user.id, metaId, Number(page), Number(limit));
	}

	@Post(':metaId/completion/resolve')
	resolveCompletion(@Req() req, @Param('metaId') metaId: string, @Body() dto: ResolveMetaCompletionDto) {
		return this.goalsService.resolveCompletion(req.user.id, metaId, dto);
	}

	@Delete(':metaId')
	eliminar(@Req() req, @Param('metaId') metaId: string) {
		return this.goalsService.eliminarMeta(req.user.id, metaId);
	}
}
