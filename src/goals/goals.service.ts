import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Meta, MetaDocument } from './schemas/meta.schema';
import { MetaEvento, MetaEventoDocument } from './schemas/meta-evento.schema';
import { CreateMetaDto, ListMetasQueryDto, MetaMoneyDto, UpdateMetaDto } from './dto/metas.dto';
import { generateUniqueId } from '../utils/generate-id';
import { Subcuenta, SubcuentaDocument } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { SubcuentaService } from '../subcuenta/subcuenta.service';
import { InternalTransferService } from './services/internal-transfer.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

@Injectable()
export class GoalsService {
	constructor(
		@InjectModel(Meta.name) private readonly metaModel: Model<MetaDocument>,
		@InjectModel(MetaEvento.name) private readonly eventoModel: Model<MetaEventoDocument>,
		@InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
		@InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
		private readonly subcuentaService: SubcuentaService,
		private readonly transferService: InternalTransferService,
		private readonly dashboardVersionService: DashboardVersionService,
	) {}

	async crearMeta(userId: string, dto: CreateMetaDto) {
		const crearSubcuenta = dto.crearSubcuenta !== false;

		let subcuentaId = (dto.subcuentaId ?? '').trim();

		if (crearSubcuenta || !subcuentaId) {
			const cuentaPrincipal = await this.cuentaModel.findOne({ userId, isPrincipal: true });
			if (!cuentaPrincipal) throw new NotFoundException('Cuenta principal no encontrada');

			const creada = await this.subcuentaService.crear(
				{
					nombre: dto.nombre,
					cantidad: 0,
					moneda: dto.moneda,
					color: dto.color,
					afectaCuenta: false,
					usarSaldoCuentaPrincipal: false,
					cuentaPrincipalId: cuentaPrincipal.id,
					descripcionHistorialCuenta: 'Subcuenta contenedor para meta',
				} as any,
				userId,
			);

			subcuentaId = creada.subCuentaId;
		} else {
			const sub = await this.subcuentaModel.findOne({ subCuentaId: subcuentaId, userId }).lean();
			if (!sub) throw new NotFoundException('Subcuenta no encontrada');
			if (String(sub.moneda) !== String(dto.moneda)) {
				throw new BadRequestException('La moneda de la meta debe coincidir con la moneda de la subcuenta');
			}
		}

		const metaId = await generateUniqueId(this.metaModel as any, 'metaId');

		const fechaObjetivo = dto.fechaObjetivo ? new Date(dto.fechaObjetivo) : null;
		if (dto.fechaObjetivo && isNaN(fechaObjetivo!.getTime())) {
			throw new BadRequestException('fechaObjetivo inválida');
		}

		const meta = await this.metaModel.create({
			userId,
			metaId,
			subcuentaId,
			nombre: dto.nombre,
			objetivo: dto.objetivo,
			moneda: dto.moneda,
			fechaObjetivo,
			prioridad: dto.prioridad ?? 0,
			estado: 'activa',
			color: dto.color ?? null,
			icono: dto.icono ? dto.icono.normalize('NFC') : null,
		});

		await this.dashboardVersionService.touchDashboard(userId, 'meta.create');

		return {
			message: 'Meta creada correctamente',
			meta,
		};
	}

	async listarMetas(userId: string, q: ListMetasQueryDto) {
		const page = Math.max(1, Number(q.page ?? 1));
		const limit = Math.min(100, Math.max(1, Number(q.limit ?? 10)));
		const search = (q.search ?? '').trim();

		const query: any = { userId };
		if (q.estado) query.estado = q.estado;
		if (search) query.nombre = { $regex: search, $options: 'i' };

		const [total, data] = await Promise.all([
			this.metaModel.countDocuments(query),
			this.metaModel
				.find(query)
				.sort({ updatedAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean(),
		]);

		return { total, page, limit, data };
	}

	async obtenerMeta(userId: string, metaId: string) {
		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');

		const sub = await this.subcuentaModel.findOne({ userId, subCuentaId: meta.subcuentaId }).lean();
		if (!sub) throw new NotFoundException('Subcuenta de meta no encontrada');

		const objetivo = Number((meta as any).objetivo) || 0;
		const actual = Number((sub as any).cantidad) || 0;
		const progreso = objetivo > 0 ? Math.min(1, actual / objetivo) : 0;

		return {
			...meta,
			progreso,
			saldoActual: actual,
			objetivo,
			subcuenta: {
				subCuentaId: (sub as any).subCuentaId,
				nombre: (sub as any).nombre,
				moneda: (sub as any).moneda,
				cantidad: (sub as any).cantidad,
				color: (sub as any).color,
			},
		};
	}

	async actualizarMeta(userId: string, metaId: string, dto: UpdateMetaDto) {
		const set: any = {};
		if (dto.nombre != null) set.nombre = dto.nombre;
		if (dto.objetivo != null) set.objetivo = dto.objetivo;
		if (dto.prioridad != null) set.prioridad = dto.prioridad;
		if (dto.color != null) set.color = dto.color;
		if (dto.icono != null) set.icono = dto.icono ? dto.icono.normalize('NFC') : null;

		if (dto.fechaObjetivo !== undefined) {
			if (!dto.fechaObjetivo) {
				set.fechaObjetivo = null;
			} else {
				const d = new Date(dto.fechaObjetivo);
				if (isNaN(d.getTime())) throw new BadRequestException('fechaObjetivo inválida');
				set.fechaObjetivo = d;
			}
		}

		const meta = await this.metaModel.findOneAndUpdate({ userId, metaId }, { $set: set }, { new: true });
		if (!meta) throw new NotFoundException('Meta no encontrada');

		await this.dashboardVersionService.touchDashboard(userId, 'meta.update');

		return { message: 'Meta actualizada', meta };
	}

	private async setEstado(userId: string, metaId: string, estado: 'activa' | 'pausada' | 'archivada' | 'completada') {
		const meta = await this.metaModel.findOneAndUpdate({ userId, metaId }, { $set: { estado } }, { new: true });
		if (!meta) throw new NotFoundException('Meta no encontrada');
		await this.dashboardVersionService.touchDashboard(userId, `meta.estado.${estado}`);
		return { message: 'Estado actualizado', meta };
	}

	pausar(userId: string, metaId: string) {
		return this.setEstado(userId, metaId, 'pausada');
	}

	reanudar(userId: string, metaId: string) {
		return this.setEstado(userId, metaId, 'activa');
	}

	archivar(userId: string, metaId: string) {
		return this.setEstado(userId, metaId, 'archivada');
	}

	async aporte(userId: string, metaId: string, dto: MetaMoneyDto) {
		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');
		if ((meta as any).estado === 'archivada') throw new BadRequestException('La meta está archivada');

		const origenCuentaId = (dto.origenCuentaId ?? '').trim();

		const transfer = await this.transferService.transferir({
			userId,
			monto: dto.monto,
			moneda: dto.moneda,
			origen: { type: 'cuenta', id: origenCuentaId || undefined, principal: !origenCuentaId },
			destino: { type: 'subcuenta', id: (meta as any).subcuentaId },
			motivo: dto.nota ? `Aporte meta: ${dto.nota}` : 'Aporte a meta',
			idempotencyKey: dto.idempotencyKey,
		});

		const evento = await this.eventoModel.create({
			userId,
			metaId,
			txId: transfer.txId,
			tipo: 'aporte',
			monto: transfer.montoOrigen,
			moneda: transfer.monedaOrigen,
			montoDestino: transfer.montoDestino,
			monedaDestino: transfer.monedaDestino,
			tasaConversion: transfer.tasaConversion,
			fechaConversion: transfer.fechaConversion,
			origenTipo: 'cuenta',
			origenId: origenCuentaId || null,
			destinoTipo: 'subcuenta',
			destinoId: (meta as any).subcuentaId,
			nota: dto.nota ?? null,
			idempotencyKey: dto.idempotencyKey ?? null,
		});

		await this.dashboardVersionService.touchDashboard(userId, 'meta.aporte');

		return {
			message: transfer.idempotent ? 'Aporte procesado (idempotente)' : 'Aporte procesado',
			txId: transfer.txId,
			evento,
			saldos: {
				saldoOrigenDespues: transfer.saldoOrigenDespues,
				saldoDestinoDespues: transfer.saldoDestinoDespues,
			},
		};
	}

	async retiro(userId: string, metaId: string, dto: MetaMoneyDto) {
		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');

		const destinoCuentaId = (dto.destinoCuentaId ?? '').trim();

		const transfer = await this.transferService.transferir({
			userId,
			monto: dto.monto,
			moneda: dto.moneda,
			origen: { type: 'subcuenta', id: (meta as any).subcuentaId },
			destino: { type: 'cuenta', id: destinoCuentaId || undefined, principal: !destinoCuentaId },
			motivo: dto.nota ? `Retiro meta: ${dto.nota}` : 'Retiro de meta',
			idempotencyKey: dto.idempotencyKey,
		});

		const evento = await this.eventoModel.create({
			userId,
			metaId,
			txId: transfer.txId,
			tipo: 'retiro',
			monto: transfer.montoOrigen,
			moneda: transfer.monedaOrigen,
			montoDestino: transfer.montoDestino,
			monedaDestino: transfer.monedaDestino,
			tasaConversion: transfer.tasaConversion,
			fechaConversion: transfer.fechaConversion,
			origenTipo: 'subcuenta',
			origenId: (meta as any).subcuentaId,
			destinoTipo: 'cuenta',
			destinoId: destinoCuentaId || null,
			nota: dto.nota ?? null,
			idempotencyKey: dto.idempotencyKey ?? null,
		});

		await this.dashboardVersionService.touchDashboard(userId, 'meta.retiro');

		return {
			message: transfer.idempotent ? 'Retiro procesado (idempotente)' : 'Retiro procesado',
			txId: transfer.txId,
			evento,
			saldos: {
				saldoOrigenDespues: transfer.saldoOrigenDespues,
				saldoDestinoDespues: transfer.saldoDestinoDespues,
			},
		};
	}

	async historial(userId: string, metaId: string, page = 1, limit = 20) {
		const p = Math.max(1, Number(page));
		const l = Math.min(100, Math.max(1, Number(limit)));

		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');

		const q = { userId, metaId };
		const [total, data] = await Promise.all([
			this.eventoModel.countDocuments(q),
			this.eventoModel
				.find(q)
				.sort({ createdAt: -1 })
				.skip((p - 1) * l)
				.limit(l)
				.lean(),
		]);

		return { total, page: p, limit: l, data };
	}
}
