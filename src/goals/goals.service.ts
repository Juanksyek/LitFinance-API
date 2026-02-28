import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { randomBytes } from 'crypto';

import { Meta, MetaDocument } from './schemas/meta.schema';
import { MetaEvento, MetaEventoDocument } from './schemas/meta-evento.schema';
import { InternalTransfer, InternalTransferDocument } from './schemas/internal-transfer.schema';
import { CreateMetaDto, ListMetasQueryDto, MetaMoneyDto, ResolveMetaCompletionDto, UpdateMetaDto } from './dto/metas.dto';
import { generateUniqueId } from '../utils/generate-id';
import { Subcuenta, SubcuentaDocument } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
// SubcuentaService removed from meta creation flow; validate subcuenta existence via model
import { InternalTransferService } from './services/internal-transfer.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { CuentaHistorial, CuentaHistorialDocument } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { SubcuentaHistorial, SubcuentaHistorialDocument } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { ConversionService } from '../utils/services/conversion.service';

type MetaMoneyEndpoint =
	| { type: 'cuenta'; id?: string; principal?: boolean }
	| { type: 'subcuenta'; id: string };

@Injectable()
export class GoalsService {
	constructor(
		@InjectConnection() private readonly connection: Connection,
		@InjectModel(Meta.name) private readonly metaModel: Model<MetaDocument>,
		@InjectModel(MetaEvento.name) private readonly eventoModel: Model<MetaEventoDocument>,
		@InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
		@InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
		@InjectModel(CuentaHistorial.name) private readonly cuentaHistorialModel: Model<CuentaHistorialDocument>,
		@InjectModel(SubcuentaHistorial.name) private readonly subcuentaHistorialModel: Model<SubcuentaHistorialDocument>,
		@InjectModel(InternalTransfer.name) private readonly transferModel: Model<InternalTransferDocument>,
		private readonly transferService: InternalTransferService,
		private readonly dashboardVersionService: DashboardVersionService,
		private readonly conversionService: ConversionService,
	) {}

	async eliminarMeta(userId: string, metaId: string) {
		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');

		// buscar eventos asociados para recolectar txIds (legacy transfers)
		const eventos = await this.eventoModel.find({ userId, metaId }).lean();
		const txIds = eventos.map((e: any) => e.txId).filter(Boolean);

		const session = await this.connection.startSession();
		try {
			await session.withTransaction(async () => {
				// eliminar eventos de la meta
				await this.eventoModel.deleteMany({ userId, metaId }).session(session);

				// eliminar la propia meta
				await this.metaModel.deleteOne({ userId, metaId }).session(session);

				// eliminar entradas en cuenta-historial relacionadas por metaId o txId
				const cuentaQuery: any = { userId, $or: [] };
				cuentaQuery.$or.push({ 'metadata.metaId': metaId });
				if (txIds.length) cuentaQuery.$or.push({ 'metadata.txId': { $in: txIds } });
				await this.cuentaHistorialModel.deleteMany(cuentaQuery).session(session);

				// eliminar entradas en subcuenta-historial relacionadas por metaId o txId
				const subQuery: any = { userId, $or: [] };
				subQuery.$or.push({ 'datos.metaId': metaId });
				if (txIds.length) subQuery.$or.push({ 'datos.txId': { $in: txIds } });
				await this.subcuentaHistorialModel.deleteMany(subQuery).session(session);

				// eliminar internal transfers asociados a los txIds (legacy)
				if (txIds.length) {
					await this.transferModel.deleteMany({ userId, txId: { $in: txIds } }).session(session);
				}
			});
		} finally {
			await session.endSession();
		}

		await this.dashboardVersionService.touchDashboard(userId, 'meta.delete');
		return { message: 'Meta y su historial eliminados' };
	}

	private async resolveCuenta(userId: string, endpoint: MetaMoneyEndpoint): Promise<CuentaDocument> {
		if (endpoint.type !== 'cuenta') throw new BadRequestException('Endpoint no es cuenta');
		if (endpoint.principal || !endpoint.id) {
			const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });
			if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');
			return cuenta as any;
		}

		const cuenta = await this.cuentaModel.findOne({ id: endpoint.id, userId });
		if (!cuenta) throw new NotFoundException('Cuenta no encontrada');
		return cuenta as any;
	}

	private async resolveSubcuenta(userId: string, endpoint: MetaMoneyEndpoint): Promise<SubcuentaDocument> {
		if (endpoint.type !== 'subcuenta') throw new BadRequestException('Endpoint no es subcuenta');
		const sub = await this.subcuentaModel.findOne({ subCuentaId: endpoint.id, userId });
		if (!sub) throw new NotFoundException('Subcuenta no encontrada');
		return sub as any;
	}

	private parseIngresoOrigen(dto: MetaMoneyDto): MetaMoneyEndpoint {
		// Nuevo preferido
		if (dto.origenTipo === 'subcuenta') {
			const id = (dto.origenId ?? '').trim();
			if (!id) throw new BadRequestException('origenId requerido cuando origenTipo=subcuenta');
			return { type: 'subcuenta', id };
		}
		if (dto.origenTipo === 'cuenta') {
			const id = (dto.origenId ?? '').trim();
			return { type: 'cuenta', id: id || undefined, principal: !id };
		}

		// Legacy
		const cuentaId = (dto.origenCuentaId ?? '').trim();
		return { type: 'cuenta', id: cuentaId || undefined, principal: !cuentaId };
	}

	private parseEgresoDestino(dto: MetaMoneyDto): MetaMoneyEndpoint {
		// Nuevo preferido
		if (dto.destinoTipo === 'subcuenta') {
			const id = (dto.destinoId ?? '').trim();
			if (!id) throw new BadRequestException('destinoId requerido cuando destinoTipo=subcuenta');
			return { type: 'subcuenta', id };
		}
		if (dto.destinoTipo === 'cuenta') {
			const id = (dto.destinoId ?? '').trim();
			return { type: 'cuenta', id: id || undefined, principal: !id };
		}

		// Legacy
		const cuentaId = (dto.destinoCuentaId ?? '').trim();
		return { type: 'cuenta', id: cuentaId || undefined, principal: !cuentaId };
	}

	async crearMeta(userId: string, dto: CreateMetaDto) {
		const metaId = await generateUniqueId(this.metaModel as any, 'metaId');

		const fechaObjetivo = dto.fechaObjetivo ? new Date(dto.fechaObjetivo) : null;
		if (dto.fechaObjetivo && isNaN(fechaObjetivo!.getTime())) {
			throw new BadRequestException('fechaObjetivo inválida');
		}

		const meta = await this.metaModel.create({
			userId,
			metaId,
			nombre: dto.nombre,
			objetivo: dto.objetivo,
			moneda: dto.moneda,
			fechaObjetivo,
			prioridad: dto.prioridad ?? 0,
			estado: 'activa',
			saldo: 0,
			completedAt: undefined,
			completionPendingDecision: false,
			completionDecision: undefined,
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

		const completion = {
			isCompleted: (meta as any).estado === 'completada',
			// Si el campo no existe (metas antiguas), asumimos pendiente en estado completada
			pendingDecision:
				(meta as any).estado === 'completada' && ((meta as any).completionPendingDecision ?? true) !== false,
			// Celebración: el front quiere mostrarla siempre que la meta esté completada.
			shouldCelebrate: (meta as any).estado === 'completada',
			completedAt: (meta as any).completedAt ?? null,
			decision: (meta as any).completionDecision ?? null,
		};

		const objetivo = Number((meta as any).objetivo) || 0;

		// Legacy: meta ligada a subcuenta
		if ((meta as any).subcuentaId) {
			const sub = await this.subcuentaModel.findOne({ userId, subCuentaId: (meta as any).subcuentaId }).lean();
			if (!sub) throw new NotFoundException('Subcuenta de meta no encontrada');

			const actual = Number((sub as any).cantidad) || 0;
			const progreso = objetivo > 0 ? Math.min(1, actual / objetivo) : 0;

			return {
				...meta,
				mode: 'legacy',
				progreso,
				saldoActual: actual,
				objetivo,
				completion,
				subcuenta: {
					subCuentaId: (sub as any).subCuentaId,
					nombre: (sub as any).nombre,
					moneda: (sub as any).moneda,
					cantidad: (sub as any).cantidad,
					color: (sub as any).color,
				},
			};
		}

		// Nuevo: meta independiente
		const actual = Number((meta as any).saldo) || 0;
		const progreso = objetivo > 0 ? Math.min(1, actual / objetivo) : 0;
		return {
			...meta,
			mode: 'independent',
			progreso,
			saldoActual: actual,
			objetivo,
			completion,
		};
	}

	private async markMetaCompletedIfNeeded(
		userId: string,
		metaId: string,
		saldoActual: number,
		moneda: string,
		context: { txId?: string; objetivo: number },
		session?: any,
	) {
		const objetivoNum = Number(context.objetivo) || 0;
		if (objetivoNum <= 0) return { didComplete: false };
		if (saldoActual < objetivoNum) return { didComplete: false };

		const now = new Date();
		const updated = await this.metaModel.findOneAndUpdate(
			{ userId, metaId, estado: { $ne: 'completada' } },
			{
				$set: {
					estado: 'completada',
					completedAt: now,
					completionPendingDecision: true,
				},
				$unset: { completionDecision: 1 },
			},
			{ new: true, session },
		);
		if (!updated) return { didComplete: false };

		// evento auditoría (append-only)
		try {
			const txId = context.txId || (await generateUniqueId(this.eventoModel as any, 'txId'));
			await this.eventoModel.create(
				[
					{
						userId,
						metaId,
						txId,
						tipo: 'meta_completada',
						monto: 0,
						moneda,
						nota: null,
						payload: {
							saldoActual,
							objetivo: objetivoNum,
							moneda,
						},
					},
				],
				{ session },
			);
		} catch (e) {
			// no bloquear el flujo si falla auditoría
		}

		await this.dashboardVersionService.touchDashboard(userId, 'meta.estado.completada');
		return { didComplete: true, completedAt: now };
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
		return this.ingresoInternal(userId, metaId, dto, 'aporte');
	}

	async ingreso(userId: string, metaId: string, dto: MetaMoneyDto) {
		return this.ingresoInternal(userId, metaId, dto, 'ingreso');
	}

	private async ingresoInternal(
		userId: string,
		metaId: string,
		dto: MetaMoneyDto,
		eventoTipo: 'aporte' | 'ingreso',
	) {
		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');
		if ((meta as any).estado === 'archivada') throw new BadRequestException('La meta está archivada');

		// Idempotencia por metaId + idempotencyKey
		const idempotencyKey = (dto.idempotencyKey ?? '').trim();
		if (idempotencyKey) {
			const existing = await this.eventoModel
				.findOne({ userId, metaId, idempotencyKey })
				.lean();
			if (existing) {
				const metaNow = await this.metaModel.findOne({ userId, metaId }).lean();
				return {
					message: 'Ingreso procesado (idempotente)',
					txId: existing.txId,
					evento: existing,
					saldoMetaActual: Number((metaNow as any)?.saldo ?? 0),
				};
			}
		}

		// Legacy: meta ligada a subcuenta (usamos InternalTransferService)
		if ((meta as any).subcuentaId) {
			const origen = this.parseIngresoOrigen(dto);
			const transfer = await this.transferService.transferir({
				userId,
				monto: dto.monto,
				moneda: dto.moneda,
				origen: origen as any,
				destino: { type: 'subcuenta', id: (meta as any).subcuentaId },
				motivo: dto.nota ? `Ingreso meta: ${dto.nota}` : 'Ingreso a meta',
				conceptoId: dto.conceptoId ?? undefined,
				concepto: dto.concepto ?? undefined,
				idempotencyKey: dto.idempotencyKey,
			});

			let evento: any;
			try {
				evento = await this.eventoModel.create({
					userId,
					metaId,
					txId: transfer.txId,
					tipo: eventoTipo,
					monto: transfer.montoOrigen,
					moneda: transfer.monedaOrigen,
					montoDestino: transfer.montoDestino,
					monedaDestino: transfer.monedaDestino,
					tasaConversion: transfer.tasaConversion,
					fechaConversion: transfer.fechaConversion,
					origenTipo: origen.type,
					origenId: origen.type === 'cuenta' ? ((origen as any).id ?? null) : (origen as any).id,
					destinoTipo: 'subcuenta',
					destinoId: (meta as any).subcuentaId,
					nota: dto.nota ?? null,
					idempotencyKey: idempotencyKey || undefined,
					saldoOrigenDespues: transfer.saldoOrigenDespues,
					saldoDestinoDespues: transfer.saldoDestinoDespues,
				});
			} catch (e: any) {
				if (idempotencyKey && (e?.code === 11000 || String(e?.message ?? '').includes('E11000'))) {
					const existing = await this.eventoModel.findOne({ userId, metaId, idempotencyKey }).lean();
					if (existing) {
						evento = existing;
					}
				} else {
					throw e;
				}
			}

					// Verificar si la meta alcanzó el objetivo (legacy: saldo en subcuenta)
						try {
							await this.markMetaCompletedIfNeeded(
								userId,
								metaId,
								Number(transfer.saldoDestinoDespues),
								String((meta as any).moneda),
								{ txId: transfer.txId, objetivo: Number((meta as any).objetivo) },
							);
						} catch (e) {
							// ignore
						}




				await this.dashboardVersionService.touchDashboard(userId, `meta.${eventoTipo}`);
			return {
				message: transfer.idempotent ? 'Ingreso procesado (idempotente)' : 'Ingreso procesado',
				txId: transfer.txId,
				evento,
				saldos: {
					saldoOrigenDespues: transfer.saldoOrigenDespues,
					saldoDestinoDespues: transfer.saldoDestinoDespues,
				},
			};
		}

		// Nuevo: meta independiente
		const origen = this.parseIngresoOrigen(dto);
		const origenCuenta = origen.type === 'cuenta' ? await this.resolveCuenta(userId, origen) : null;
		const origenSub = origen.type === 'subcuenta' ? await this.resolveSubcuenta(userId, origen) : null;
		const monedaOrigen = (origenCuenta as any)?.moneda ?? (origenSub as any)?.moneda;
		if (!monedaOrigen) throw new BadRequestException('No se pudo resolver moneda de origen');
		if (dto.moneda && dto.moneda !== monedaOrigen) {
			throw new BadRequestException('La moneda debe coincidir con la moneda del origen');
		}

		const montoOrigen = dto.monto;
		const monedaMeta = String((meta as any).moneda);
		let montoMeta = montoOrigen;
		let tasaConversion: number | null = null;
		let fechaConversion: Date | null = null;
		if (monedaOrigen !== monedaMeta) {
			const conv = await this.conversionService.convertir(montoOrigen, monedaOrigen, monedaMeta);
			montoMeta = conv.montoConvertido;
			tasaConversion = conv.tasaConversion;
			fechaConversion = conv.fechaConversion;
		}

		const saldoOrigen = origenCuenta ? (origenCuenta as any).cantidad : (origenSub as any).cantidad;
		if (Number(saldoOrigen) < montoOrigen) throw new BadRequestException('Fondos insuficientes en el origen');

		const session = await this.connection.startSession();
		try {
			const result = await session.withTransaction(async () => {
				// Aplicar updates
				if (origenCuenta) {
					await this.cuentaModel.updateOne(
						{ id: (origenCuenta as any).id, userId },
						{ $inc: { cantidad: -montoOrigen } },
						{ session },
					);
				} else {
					await this.subcuentaModel.updateOne(
						{ subCuentaId: (origenSub as any).subCuentaId, userId },
						{ $inc: { cantidad: -montoOrigen } },
						{ session },
					);
				}

				await this.metaModel.updateOne(
					{ metaId, userId },
					{ $inc: { saldo: +montoMeta } },
					{ session },
				);

				// Releer saldos
				const origenAfter = origenCuenta
					? await this.cuentaModel.findOne({ id: (origenCuenta as any).id, userId }).session(session)
					: await this.subcuentaModel.findOne({ subCuentaId: (origenSub as any).subCuentaId, userId }).session(session);

				const metaAfter = await this.metaModel.findOne({ metaId, userId }).session(session);
				if (!origenAfter || !metaAfter) throw new BadRequestException('No se pudieron leer saldos finales');

				const saldoOrigenDespues = Number((origenAfter as any).cantidad);
				const saldoMetaDespues = Number((metaAfter as any).saldo);

				const txId = await generateUniqueId(this.eventoModel as any, 'txId');
				const now = new Date();
				const desc = (dto.nota ? `Ingreso meta: ${dto.nota}` : 'Ingreso a meta').slice(0, 180);

				// Historial cuenta/subcuenta (origen)
				if (origenCuenta) {
					await this.cuentaHistorialModel.create(
						[
							{
								id: randomBytes(6).toString('hex'),
								cuentaId: (origenCuenta as any).id,
								userId,
								monto: -montoOrigen,
								tipo: 'ajuste_subcuenta',
								descripcion: desc,
								fecha: now,
								conceptoId: dto.conceptoId ?? undefined,
								concepto: dto.concepto ?? undefined,
								metadata: {
									kind: 'meta',
									txId,
									side: 'origen',
									metaId,
									metaEventoTipo: eventoTipo,
									moneda: monedaOrigen,
									monedaMeta,
									tasaConversion,
									fechaConversion,
								},
							},
						],
						{ session },
					);
				} else {
					await this.subcuentaHistorialModel.create(
						[
							{
								userId,
								tipo: 'transferencia',
								descripcion: desc,
								subcuentaId: (origenSub as any)._id,
								conceptoId: dto.conceptoId ?? undefined,
								concepto: dto.concepto ?? undefined,
								datos: {
									kind: 'meta',
									txId,
									side: 'origen',
									metaId,
									metaEventoTipo: eventoTipo,
									subCuentaId: (origenSub as any).subCuentaId,
									monto: -montoOrigen,
									moneda: monedaOrigen,
									monedaMeta,
									tasaConversion,
									fechaConversion,
								},
							},
						],
						{ session },
					);
				}

				const evento = await this.eventoModel.create(
					[
						{
							userId,
							metaId,
							txId,
							tipo: eventoTipo,
							monto: montoOrigen,
							moneda: monedaOrigen,
							montoDestino: montoMeta,
							monedaDestino: monedaMeta,
							tasaConversion: tasaConversion ?? undefined,
							fechaConversion: fechaConversion ?? undefined,
							origenTipo: origen.type,
							origenId: origen.type === 'cuenta' ? ((origen as any).id ?? null) : (origen as any).id,
							destinoTipo: 'meta',
							destinoId: metaId,
							nota: dto.nota ?? null,
							idempotencyKey: idempotencyKey || undefined,
							saldoMetaDespues,
							saldoOrigenDespues,
						},
					],
					{ session },
				);

										// Dentro de la transacción, marcar completada si aplica (una sola vez)
										await this.markMetaCompletedIfNeeded(
											userId,
											metaId,
											saldoMetaDespues,
											monedaMeta,
											{ txId, objetivo: Number((meta as any).objetivo) },
											session,
										);

				return {
					txId,
					evento: (evento as any)?.[0] ?? evento,
					saldoMetaDespues,
					saldoOrigenDespues,
				};
			});

			await this.dashboardVersionService.touchDashboard(userId, `meta.${eventoTipo}`);
			return {
				message: 'Ingreso procesado',
				txId: (result as any).txId,
				evento: (result as any).evento,
				saldos: {
					saldoOrigenDespues: (result as any).saldoOrigenDespues,
					saldoMetaDespues: (result as any).saldoMetaDespues,
				},
			};
		} catch (e: any) {
			if (idempotencyKey && (e?.code === 11000 || String(e?.message ?? '').includes('E11000'))) {
				const existing = await this.eventoModel.findOne({ userId, metaId, idempotencyKey }).lean();
				if (existing) {
					const metaNow = await this.metaModel.findOne({ userId, metaId }).lean();
					return {
						message: 'Ingreso procesado (idempotente)',
						txId: existing.txId,
						evento: existing,
						saldoMetaActual: Number((metaNow as any)?.saldo ?? 0),
					};
				}
			}
			throw e;
		} finally {
			await session.endSession();
		}
	}

	async retiro(userId: string, metaId: string, dto: MetaMoneyDto) {
		return this.egresoInternal(userId, metaId, dto, 'retiro');
	}

	async egreso(userId: string, metaId: string, dto: MetaMoneyDto) {
		return this.egresoInternal(userId, metaId, dto, 'egreso');
	}

	private async egresoInternal(
		userId: string,
		metaId: string,
		dto: MetaMoneyDto,
		eventoTipo: 'retiro' | 'egreso',
	) {
		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');
		if ((meta as any).estado === 'archivada') throw new BadRequestException('La meta está archivada');

		// Idempotencia por metaId + idempotencyKey
		const idempotencyKey = (dto.idempotencyKey ?? '').trim();
		if (idempotencyKey) {
			const existing = await this.eventoModel
				.findOne({ userId, metaId, idempotencyKey })
				.lean();
			if (existing) {
				const metaNow = await this.metaModel.findOne({ userId, metaId }).lean();
				return {
					message: 'Egreso procesado (idempotente)',
					txId: existing.txId,
					evento: existing,
					saldoMetaActual: Number((metaNow as any)?.saldo ?? 0),
				};
			}
		}

		const destino = this.parseEgresoDestino(dto);

		// Legacy: meta ligada a subcuenta (usamos InternalTransferService)
		if ((meta as any).subcuentaId) {
			const transfer = await this.transferService.transferir({
				userId,
				monto: dto.monto,
				moneda: dto.moneda,
				origen: { type: 'subcuenta', id: (meta as any).subcuentaId },
				destino: destino as any,
				motivo: dto.nota ? `Egreso meta: ${dto.nota}` : 'Egreso desde meta',
				conceptoId: dto.conceptoId ?? undefined,
				concepto: dto.concepto ?? undefined,
				idempotencyKey: dto.idempotencyKey,
			});

			let evento: any;
			try {
				evento = await this.eventoModel.create({
					userId,
					metaId,
					txId: transfer.txId,
					tipo: eventoTipo,
					monto: transfer.montoOrigen,
					moneda: transfer.monedaOrigen,
					montoDestino: transfer.montoDestino,
					monedaDestino: transfer.monedaDestino,
					tasaConversion: transfer.tasaConversion,
					fechaConversion: transfer.fechaConversion,
					origenTipo: 'subcuenta',
					origenId: (meta as any).subcuentaId,
					destinoTipo: destino.type,
					destinoId: destino.type === 'cuenta' ? ((destino as any).id ?? null) : (destino as any).id,
					nota: dto.nota ?? null,
					idempotencyKey: idempotencyKey || undefined,
					saldoOrigenDespues: transfer.saldoOrigenDespues,
					saldoDestinoDespues: transfer.saldoDestinoDespues,
				});
			} catch (e: any) {
				if (idempotencyKey && (e?.code === 11000 || String(e?.message ?? '').includes('E11000'))) {
					const existing = await this.eventoModel.findOne({ userId, metaId, idempotencyKey }).lean();
					if (existing) {
						evento = existing;
					}
				} else {
					throw e;
				}
			}

				// No auto-revert / no auto-complete en egreso: completada se marca al alcanzar objetivo.

				await this.dashboardVersionService.touchDashboard(userId, `meta.${eventoTipo}`);
			return {
				message: transfer.idempotent ? 'Egreso procesado (idempotente)' : 'Egreso procesado',
				txId: transfer.txId,
				evento,
				saldos: {
					saldoOrigenDespues: transfer.saldoOrigenDespues,
					saldoDestinoDespues: transfer.saldoDestinoDespues,
				},
			};
		}

		// Nuevo: meta independiente
		const monedaMeta = String((meta as any).moneda);
		if (dto.moneda && dto.moneda !== monedaMeta) {
			throw new BadRequestException('La moneda debe coincidir con la moneda de la meta');
		}

		const montoMeta = dto.monto;
		const saldoMeta = Number((meta as any).saldo ?? 0);
		if (saldoMeta < montoMeta) throw new BadRequestException('Fondos insuficientes en la meta');

		const destinoCuenta = destino.type === 'cuenta' ? await this.resolveCuenta(userId, destino) : null;
		const destinoSub = destino.type === 'subcuenta' ? await this.resolveSubcuenta(userId, destino) : null;
		const monedaDestino = (destinoCuenta as any)?.moneda ?? (destinoSub as any)?.moneda;
		if (!monedaDestino) throw new BadRequestException('No se pudo resolver moneda del destino');

		let montoDestino = montoMeta;
		let tasaConversion: number | null = null;
		let fechaConversion: Date | null = null;
		if (monedaDestino !== monedaMeta) {
			const conv = await this.conversionService.convertir(montoMeta, monedaMeta, monedaDestino);
			montoDestino = conv.montoConvertido;
			tasaConversion = conv.tasaConversion;
			fechaConversion = conv.fechaConversion;
		}

		const session = await this.connection.startSession();
		try {
			const result = await session.withTransaction(async () => {
				await this.metaModel.updateOne(
					{ metaId, userId },
					{ $inc: { saldo: -montoMeta } },
					{ session },
				);

				if (destinoCuenta) {
					await this.cuentaModel.updateOne(
						{ id: (destinoCuenta as any).id, userId },
						{ $inc: { cantidad: +montoDestino } },
						{ session },
					);
				} else {
					await this.subcuentaModel.updateOne(
						{ subCuentaId: (destinoSub as any).subCuentaId, userId },
						{ $inc: { cantidad: +montoDestino } },
						{ session },
					);
				}

				const metaAfter = await this.metaModel.findOne({ metaId, userId }).session(session);
				const destinoAfter = destinoCuenta
					? await this.cuentaModel.findOne({ id: (destinoCuenta as any).id, userId }).session(session)
					: await this.subcuentaModel.findOne({ subCuentaId: (destinoSub as any).subCuentaId, userId }).session(session);

				if (!metaAfter || !destinoAfter) throw new BadRequestException('No se pudieron leer saldos finales');

				const saldoMetaDespues = Number((metaAfter as any).saldo);
				const saldoDestinoDespues = Number((destinoAfter as any).cantidad);

				// No completion logic aquí (egreso). La completitud se marca al alcanzar el objetivo.

				const txId = await generateUniqueId(this.eventoModel as any, 'txId');
				const now = new Date();
				const desc = (dto.nota ? `Egreso meta: ${dto.nota}` : 'Egreso desde meta').slice(0, 180);

				// Historial destino
				if (destinoCuenta) {
					await this.cuentaHistorialModel.create(
						[
							{
								id: randomBytes(6).toString('hex'),
								cuentaId: (destinoCuenta as any).id,
								userId,
								monto: +montoDestino,
								tipo: 'ajuste_subcuenta',
								descripcion: desc,
								fecha: now,
								conceptoId: dto.conceptoId ?? undefined,
								concepto: dto.concepto ?? undefined,
								metadata: {
									kind: 'meta',
									txId,
									side: 'destino',
									metaId,
									metaEventoTipo: eventoTipo,
									monedaDestino,
									monedaMeta,
									tasaConversion,
									fechaConversion,
								},
							},
						],
						{ session },
					);
				} else {
					await this.subcuentaHistorialModel.create(
						[
							{
								userId,
								tipo: 'transferencia',
								descripcion: desc,
								subcuentaId: (destinoSub as any)._id,
								conceptoId: dto.conceptoId ?? undefined,
								concepto: dto.concepto ?? undefined,
								datos: {
									kind: 'meta',
									txId,
									side: 'destino',
									metaId,
									metaEventoTipo: eventoTipo,
									subCuentaId: (destinoSub as any).subCuentaId,
									monto: +montoDestino,
									moneda: monedaDestino,
									monedaMeta,
									tasaConversion,
									fechaConversion,
								},
							},
						],
						{ session },
					);
				}

				const evento = await this.eventoModel.create(
					[
						{
							userId,
							metaId,
							txId,
							tipo: eventoTipo,
							monto: montoMeta,
							moneda: monedaMeta,
							montoDestino,
							monedaDestino,
							tasaConversion: tasaConversion ?? undefined,
							fechaConversion: fechaConversion ?? undefined,
							origenTipo: 'meta',
							origenId: metaId,
							destinoTipo: destino.type,
							destinoId: destino.type === 'cuenta' ? ((destino as any).id ?? null) : (destino as any).id,
							nota: dto.nota ?? null,
							idempotencyKey: idempotencyKey || undefined,
							saldoMetaDespues,
							saldoDestinoDespues,
						},
					],
					{ session },
				);

				return {
					txId,
					evento: (evento as any)?.[0] ?? evento,
					saldoMetaDespues,
					saldoDestinoDespues,
				};
			});

			await this.dashboardVersionService.touchDashboard(userId, `meta.${eventoTipo}`);
			return {
				message: 'Egreso procesado',
				txId: (result as any).txId,
				evento: (result as any).evento,
				saldos: {
					saldoMetaDespues: (result as any).saldoMetaDespues,
					saldoDestinoDespues: (result as any).saldoDestinoDespues,
				},
			};
		} catch (e: any) {
			if (idempotencyKey && (e?.code === 11000 || String(e?.message ?? '').includes('E11000'))) {
				const existing = await this.eventoModel.findOne({ userId, metaId, idempotencyKey }).lean();
				if (existing) {
					const metaNow = await this.metaModel.findOne({ userId, metaId }).lean();
					return {
						message: 'Egreso procesado (idempotente)',
						txId: existing.txId,
						evento: existing,
						saldoMetaActual: Number((metaNow as any)?.saldo ?? 0),
					};
				}
			}
			throw e;
		} finally {
			await session.endSession();
		}
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

	private async transferLegacySubcuentaToPrincipalWithinSession(params: {
		userId: string;
		subCuentaId: string;
		amount: number;
		motivo: string;
		session: any;
	}): Promise<{ txId: string; movedAmount: number; monedaOrigen: string; montoDestino: number; monedaDestino: string }> {
		const { userId, subCuentaId, amount, motivo, session } = params;
		const sub = await this.subcuentaModel.findOne({ userId, subCuentaId }).session(session);
		if (!sub) throw new NotFoundException('Subcuenta de meta no encontrada');
		const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true }).session(session);
		if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

		const monedaOrigen = String((sub as any).moneda);
		const monedaDestino = String((cuenta as any).moneda);
		const saldoOrigen = Number((sub as any).cantidad ?? 0);
		if (saldoOrigen < amount) throw new BadRequestException('Fondos insuficientes en la meta');

		let montoDestino = amount;
		let tasaConversion: number | null = null;
		let fechaConversion: Date | null = null;
		if (monedaDestino !== monedaOrigen) {
			const conv = await this.conversionService.convertir(amount, monedaOrigen, monedaDestino);
			montoDestino = conv.montoConvertido;
			tasaConversion = conv.tasaConversion;
			fechaConversion = conv.fechaConversion;
		}

		await this.subcuentaModel.updateOne(
			{ userId, subCuentaId },
			{ $inc: { cantidad: -amount } },
			{ session },
		);
		await this.cuentaModel.updateOne(
			{ userId, id: (cuenta as any).id },
			{ $inc: { cantidad: +montoDestino } },
			{ session },
		);

		const subAfter = await this.subcuentaModel.findOne({ userId, subCuentaId }).session(session);
		const cuentaAfter = await this.cuentaModel.findOne({ userId, id: (cuenta as any).id }).session(session);
		if (!subAfter || !cuentaAfter) throw new BadRequestException('No se pudieron leer saldos finales');

		const txId = await generateUniqueId(this.transferModel as any, 'txId');
		const now = new Date();
		const desc = (motivo || 'Transferencia a principal').slice(0, 180);

		await this.cuentaHistorialModel.create(
			[
				{
					id: randomBytes(6).toString('hex'),
					cuentaId: (cuenta as any).id,
					userId,
					monto: +montoDestino,
					tipo: 'ajuste_subcuenta',
					descripcion: desc,
					fecha: now,
					metadata: {
						kind: 'meta',
						txId,
						side: 'destino',
						subCuentaId,
						monedaOrigen,
						monedaDestino,
						tasaConversion,
						fechaConversion,
					},
				},
			],
			{ session },
		);
		await this.subcuentaHistorialModel.create(
			[
				{
					userId,
					tipo: 'transferencia',
					descripcion: desc,
					subcuentaId: (subAfter as any)._id,
					datos: {
						kind: 'meta',
						txId,
						side: 'origen',
						subCuentaId,
						monto: -amount,
						moneda: monedaOrigen,
					},
				},
			],
			{ session },
		);

		await this.transferModel.create(
			[
				{
					userId,
					txId,
					idempotencyKey: undefined,
					montoOrigen: amount,
					monedaOrigen,
					montoDestino,
					monedaDestino,
					tasaConversion: tasaConversion ?? undefined,
					fechaConversion: fechaConversion ?? undefined,
					origenTipo: 'subcuenta',
					origenId: subCuentaId,
					destinoTipo: 'cuenta',
					destinoId: (cuenta as any).id || 'principal',
					motivo: motivo ?? null,
					conceptoId: null,
					concepto: null,
					saldoOrigenDespues: Number((subAfter as any).cantidad),
					saldoDestinoDespues: Number((cuentaAfter as any).cantidad),
				},
			],
			{ session },
		);

		return { txId, movedAmount: amount, monedaOrigen, montoDestino, monedaDestino };
	}

	private async transferIndependentMetaToPrincipalWithinSession(params: {
		userId: string;
		metaId: string;
		amount: number;
		motivo: string;
		session: any;
	}): Promise<{ txId: string; movedAmount: number; monedaOrigen: string; montoDestino: number; monedaDestino: string }> {
		const { userId, metaId, amount, motivo, session } = params;
		const meta = await this.metaModel.findOne({ userId, metaId }).session(session);
		if (!meta) throw new NotFoundException('Meta no encontrada');
		const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true }).session(session);
		if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

		const monedaOrigen = String((meta as any).moneda);
		const monedaDestino = String((cuenta as any).moneda);
		const saldoOrigen = Number((meta as any).saldo ?? 0);
		if (saldoOrigen < amount) throw new BadRequestException('Fondos insuficientes en la meta');

		let montoDestino = amount;
		let tasaConversion: number | null = null;
		let fechaConversion: Date | null = null;
		if (monedaDestino !== monedaOrigen) {
			const conv = await this.conversionService.convertir(amount, monedaOrigen, monedaDestino);
			montoDestino = conv.montoConvertido;
			tasaConversion = conv.tasaConversion;
			fechaConversion = conv.fechaConversion;
		}

		await this.metaModel.updateOne(
			{ userId, metaId },
			{ $inc: { saldo: -amount } },
			{ session },
		);
		await this.cuentaModel.updateOne(
			{ userId, id: (cuenta as any).id },
			{ $inc: { cantidad: +montoDestino } },
			{ session },
		);

		const cuentaAfter = await this.cuentaModel.findOne({ userId, id: (cuenta as any).id }).session(session);
		if (!cuentaAfter) throw new BadRequestException('No se pudo leer saldo final de cuenta');

		const txId = await generateUniqueId(this.eventoModel as any, 'txId');
		const now = new Date();
		const desc = (motivo || 'Transferencia a principal').slice(0, 180);
		await this.cuentaHistorialModel.create(
			[
				{
					id: randomBytes(6).toString('hex'),
					cuentaId: (cuenta as any).id,
					userId,
					monto: +montoDestino,
					tipo: 'ajuste_subcuenta',
					descripcion: desc,
					fecha: now,
					metadata: {
						kind: 'meta',
						txId,
						side: 'destino',
						metaId,
						monedaOrigen,
						monedaDestino,
						tasaConversion,
						fechaConversion,
					},
				},
			],
			{ session },
		);

		return { txId, movedAmount: amount, monedaOrigen, montoDestino, monedaDestino };
	}

	async resolveCompletion(userId: string, metaId: string, dto: ResolveMetaCompletionDto) {
		const meta = await this.metaModel.findOne({ userId, metaId }).lean();
		if (!meta) throw new NotFoundException('Meta no encontrada');
		if ((meta as any).estado !== 'completada') {
			throw new BadRequestException('La meta no está completada');
		}

		// Si ya fue resuelta (idempotente)
		if ((meta as any).completionPendingDecision === false && (meta as any).completionDecision) {
			return {
				message: 'Decisión ya resuelta',
				decision: (meta as any).completionDecision,
				idempotent: true,
			};
		}

		if (dto.moneyAction === 'mark_used' && !(dto.motivo ?? '').trim()) {
			throw new BadRequestException('motivo requerido cuando moneyAction=mark_used');
		}

		const session = await this.connection.startSession();
		try {
			const result = await session.withTransaction(async () => {
				const metaTx = await this.metaModel.findOne({ userId, metaId }).session(session);
				if (!metaTx) throw new NotFoundException('Meta no encontrada');
				if ((metaTx as any).estado !== 'completada') throw new BadRequestException('La meta no está completada');

				// idempotencia dentro de la transacción
				if ((metaTx as any).completionPendingDecision === false && (metaTx as any).completionDecision) {
					return {
						message: 'Decisión ya resuelta',
						decision: (metaTx as any).completionDecision,
						idempotent: true,
					};
				}

				const pending = ((metaTx as any).completionPendingDecision ?? true) !== false;
				if (!pending) {
					return {
						message: 'Decisión ya resuelta',
						decision: (metaTx as any).completionDecision ?? null,
						idempotent: true,
					};
				}

				const now = new Date();
				const moneyAction = dto.moneyAction;
				const metaAction = dto.metaAction;

				// Resolver saldo actual (legacy vs independent)
				let saldoDisponible = Number((metaTx as any).saldo ?? 0);
				if ((metaTx as any).subcuentaId) {
					const sub = await this.subcuentaModel
						.findOne({ userId, subCuentaId: String((metaTx as any).subcuentaId) })
						.session(session);
					if (!sub) throw new NotFoundException('Subcuenta de meta no encontrada');
					saldoDisponible = Number((sub as any).cantidad ?? 0);
				}

				const amount = Math.min(
					saldoDisponible,
					dto.amount != null && Number.isFinite(dto.amount) ? Number(dto.amount) : saldoDisponible,
				);
				if ((moneyAction === 'transfer_to_main' || (moneyAction === 'mark_used' && dto.moveToMain)) && amount <= 0) {
					throw new BadRequestException('No hay fondos para mover');
				}

				const decision: any = {
					moneyAction,
					metaAction,
					decidedAt: now,
					motivo: dto.motivo ? dto.motivo.trim() : undefined,
				};

				let moveTx: any = null;
				if (moneyAction === 'transfer_to_main') {
					if ((metaTx as any).subcuentaId) {
						moveTx = await this.transferLegacySubcuentaToPrincipalWithinSession({
							userId,
							subCuentaId: String((metaTx as any).subcuentaId),
							amount,
							motivo: 'Transferencia a principal (meta completada)',
							session,
						});
					} else {
						moveTx = await this.transferIndependentMetaToPrincipalWithinSession({
							userId,
							metaId,
							amount,
							motivo: 'Transferencia a principal (meta completada)',
							session,
						});
					}

					decision.movedAmount = amount;
					decision.txId = moveTx.txId;
					await this.eventoModel.create(
						[
							{
								userId,
								metaId,
								txId: moveTx.txId,
								tipo: 'transferencia_a_principal',
								monto: amount,
								moneda: moveTx.monedaOrigen,
								montoDestino: moveTx.montoDestino,
								monedaDestino: moveTx.monedaDestino,
								payload: { moneyAction, amount },
							},
						],
						{ session },
					);
				}

				if (moneyAction === 'mark_used') {
					decision.movedAmount = dto.amount ?? saldoDisponible;
					if (dto.moveToMain) {
						// reuse moveTx if already moved
						if (!moveTx) {
							if ((metaTx as any).subcuentaId) {
								moveTx = await this.transferLegacySubcuentaToPrincipalWithinSession({
									userId,
									subCuentaId: String((metaTx as any).subcuentaId),
									amount,
									motivo: 'Transferencia a principal (meta completada - usado)',
									session,
								});
							} else {
								moveTx = await this.transferIndependentMetaToPrincipalWithinSession({
									userId,
									metaId,
									amount,
									motivo: 'Transferencia a principal (meta completada - usado)',
									session,
								});
							}
						}
						decision.txId = moveTx.txId;
					}

					await this.eventoModel.create(
						[
							{
								userId,
								metaId,
								txId: moveTx?.txId ?? (await generateUniqueId(this.eventoModel as any, 'txId')),
								tipo: 'retiro_uso',
								monto: 0,
								moneda: String((metaTx as any).moneda),
								payload: {
									motivo: dto.motivo?.trim(),
									amount: dto.amount ?? saldoDisponible,
									moveToMain: !!dto.moveToMain,
								},
							},
						],
						{ session },
					);
				}

				// Acciones sobre la meta
				let duplicatedMeta: any = null;
				if (metaAction === 'archive') {
					await this.metaModel.updateOne({ userId, metaId }, { $set: { estado: 'archivada' } }, { session });
					await this.eventoModel.create(
						[
							{ userId, metaId, txId: moveTx?.txId ?? (await generateUniqueId(this.eventoModel as any, 'txId')), tipo: 'meta_archivada', monto: 0, moneda: String((metaTx as any).moneda) },
						],
						{ session },
					);
				}
				if (metaAction === 'reset') {
					const set: any = { estado: 'activa' };
					if (dto.resetObjetivo != null) set.objetivo = dto.resetObjetivo;
					if (dto.resetFechaObjetivo !== undefined) {
						if (!dto.resetFechaObjetivo) {
							set.fechaObjetivo = null;
						} else {
							const d = new Date(dto.resetFechaObjetivo);
							if (isNaN(d.getTime())) throw new BadRequestException('resetFechaObjetivo inválida');
							set.fechaObjetivo = d;
						}
					}
					await this.metaModel.updateOne(
						{ userId, metaId },
						{ $set: { ...set, completionPendingDecision: false }, $unset: { completedAt: 1, completionDecision: 1 } },
						{ session },
					);
					await this.eventoModel.create(
						[
							{ userId, metaId, txId: moveTx?.txId ?? (await generateUniqueId(this.eventoModel as any, 'txId')), tipo: 'meta_reiniciada', monto: 0, moneda: String((metaTx as any).moneda), payload: { resetObjetivo: dto.resetObjetivo, resetFechaObjetivo: dto.resetFechaObjetivo } },
						],
						{ session },
					);
				}
				if (metaAction === 'duplicate') {
					const newMetaId = await generateUniqueId(this.metaModel as any, 'metaId');
					duplicatedMeta = await this.metaModel.create(
						[
							{
								userId,
								metaId: newMetaId,
								nombre: String((metaTx as any).nombre),
								objetivo: Number((metaTx as any).objetivo),
								moneda: String((metaTx as any).moneda),
								fechaObjetivo: (metaTx as any).fechaObjetivo ?? null,
								prioridad: (metaTx as any).prioridad ?? 0,
								estado: 'activa',
								saldo: 0,
								color: (metaTx as any).color ?? null,
								icono: (metaTx as any).icono ?? null,
								completionPendingDecision: false,
							},
						],
						{ session },
					);
					decision.duplicatedMetaId = newMetaId;
					await this.eventoModel.create(
						[
							{ userId, metaId, txId: moveTx?.txId ?? (await generateUniqueId(this.eventoModel as any, 'txId')), tipo: 'meta_duplicada', monto: 0, moneda: String((metaTx as any).moneda), payload: { duplicatedMetaId: newMetaId } },
						],
						{ session },
					);
				}

				// Registrar decisión (append-only)
				await this.eventoModel.create(
					[
						{
							userId,
							metaId,
							txId: moveTx?.txId ?? (await generateUniqueId(this.eventoModel as any, 'txId')),
							tipo: 'decision_completada',
							monto: 0,
							moneda: String((metaTx as any).moneda),
							payload: decision,
						},
					],
					{ session },
				);

				// Guardar estado en Meta si no fue reset
				if (metaAction !== 'reset') {
					await this.metaModel.updateOne(
						{ userId, metaId },
						{ $set: { completionPendingDecision: false, completionDecision: decision } },
						{ session },
					);
				}

				return {
					message: 'Decisión registrada',
					decision,
					duplicatedMeta: duplicatedMeta ? (duplicatedMeta as any)?.[0] ?? duplicatedMeta : null,
					idempotent: false,
				};
			});

			// invalidar snapshot/dashboard para que el front refleje cambios
			try {
				await this.dashboardVersionService.touchDashboard(userId, 'meta.completion.resolve');
			} catch (e) {
				// ignore
			}

			return result;
		} catch (e: any) {
			// si hubo carrera y ya se resolvió, devolver la decisión guardada
			const metaNow = await this.metaModel.findOne({ userId, metaId }).lean();
			if (metaNow && (metaNow as any).completionPendingDecision === false && (metaNow as any).completionDecision) {
				return { message: 'Decisión ya resuelta', decision: (metaNow as any).completionDecision, idempotent: true };
			}
			throw e;
		} finally {
			await session.endSession();
		}
	}
}
