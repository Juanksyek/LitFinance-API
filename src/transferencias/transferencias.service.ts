import { Injectable } from '@nestjs/common';
import { DashboardVersionService } from '../user/services/dashboard-version.service';
import { InternalTransferService, TransferEndpoint } from '../goals/services/internal-transfer.service';
import { CreateTransferenciaDto } from './dto/create-transferencia.dto';

@Injectable()
export class TransferenciasService {
  constructor(
    private readonly internalTransferService: InternalTransferService,
    private readonly dashboardVersionService: DashboardVersionService,
  ) {}

  private toTransferEndpoint(endpoint: CreateTransferenciaDto['origen']): TransferEndpoint {
    if (endpoint.type === 'subcuenta') {
      return {
        type: 'subcuenta',
        id: endpoint.id!,
      };
    }

    return {
      type: 'cuenta',
      id: endpoint.id,
      principal: endpoint.principal,
    };
  }

  async crear(userId: string, dto: CreateTransferenciaDto, idempotencyKeyHeader?: string) {
    const result = await this.internalTransferService.transferir({
      userId,
      monto: dto.monto,
      moneda: dto.moneda,
      origen: this.toTransferEndpoint(dto.origen),
      destino: this.toTransferEndpoint(dto.destino),
      motivo: dto.motivo,
      conceptoId: dto.conceptoId,
      concepto: dto.concepto,
      idempotencyKey: idempotencyKeyHeader?.trim() || dto.idempotencyKey?.trim() || undefined,
    });

    await this.dashboardVersionService.touchDashboard(userId, 'transfer.create');

    return {
      message: result.idempotent ? 'Transferencia procesada (idempotente)' : 'Transferencia procesada',
      ...result,
    };
  }
}
