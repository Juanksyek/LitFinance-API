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
	ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GoalsService } from './goals.service';
import { CreateMetaDto, ListMetasQueryDto, MetaMoneyDto, UpdateMetaDto } from './dto/metas.dto';
import { SubcuentaService } from '../subcuenta/subcuenta.service';
import { PlanConfigService } from '../plan-config/plan-config.service';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('metas')
export class GoalsController {
	constructor(
		private readonly goalsService: GoalsService,
		private readonly subcuentaService: SubcuentaService,
		private readonly planConfigService: PlanConfigService,
	) {}

	@Post()
	async crear(@Req() req, @Body() dto: CreateMetaDto) {
		const userId = req.user.id;
		const crearSubcuenta = dto.crearSubcuenta !== false;
		const hasSubcuentaId = !!(dto.subcuentaId ?? '').trim();

		// Si la creación de meta crea subcuenta, debe respetar límites de plan
		if (crearSubcuenta || !hasSubcuentaId) {
			const userPlanType = req.user.planType ?? (req.user.isPremium ? 'premium_plan' : 'free_plan');
			const subcuentasActuales = await this.subcuentaService.contarSubcuentas(userId);
			const validation = await this.planConfigService.canPerformAction(
				userId,
				userPlanType,
				'subcuenta',
				subcuentasActuales,
			);
			if (!validation.allowed) {
				throw new ForbiddenException(validation.message || 'No puedes crear más subcuentas con tu plan actual');
			}
		}

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

	@Post(':metaId/retiro')
	retiro(@Req() req, @Param('metaId') metaId: string, @Body() dto: MetaMoneyDto) {
		return this.goalsService.retiro(req.user.id, metaId, dto);
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
}
