import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Model } from 'mongoose';
import { TooManyRequestsException } from '../common/exceptions/too-many-requests.exception';
import { UpdateProfileDto } from '../user/dto/update-profile.dto';
import { UserService } from '../user/user.service';
import { CreateTransactionDto } from '../transactions/dto/create-transaction.dto';
import { UpdateTransactionDto } from '../transactions/dto/update-transaction.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateSubcuentaDto } from '../subcuenta/dto/create-subcuenta.dto/create-subcuenta.dto';
import { DeleteSubcuentaDto } from '../subcuenta/dto/delete-subcuenta.dto/delete-subcuenta.dto';
import { UpdateSubcuentaDto } from '../subcuenta/dto/update-subcuenta.dto/update-subcuenta.dto';
import { SubcuentaService } from '../subcuenta/subcuenta.service';
import { CrearRecurrenteDto } from '../recurrentes/dto/crear-recurrente.dto';
import { EditarRecurrenteDto } from '../recurrentes/dto/editar-recurrente.dto';
import { RecurrentesService } from '../recurrentes/recurrentes.service';
import {
  MobileSyncOperationDto,
} from './dto/mobile-sync-push.dto';
import {
  MobileSyncOperation,
  MobileSyncOperationDocument,
  MobileSyncResultStatus,
} from './schemas/mobile-sync-operation.schema';

type OperationResult = {
  operationId: string;
  status: MobileSyncResultStatus;
  retryable: boolean;
  code?: string;
  message?: string;
  data?: unknown;
};

@Injectable()
export class MobilePushService {
  constructor(
    @InjectModel(MobileSyncOperation.name)
    private readonly syncOperationModel: Model<MobileSyncOperationDocument>,
    private readonly userService: UserService,
    private readonly transactionsService: TransactionsService,
    private readonly subcuentaService: SubcuentaService,
    private readonly recurrentesService: RecurrentesService,
  ) {}

  async processBatch(params: {
    userId: string;
    deviceId: string;
    operations: MobileSyncOperationDto[];
  }) {
    const results: OperationResult[] = [];

    for (const operation of params.operations) {
      const result = await this.processOperation({
        userId: params.userId,
        deviceId: params.deviceId,
        operation,
      });
      results.push(result);
    }

    return {
      serverTime: new Date().toISOString(),
      results,
    };
  }

  private async processOperation(params: {
    userId: string;
    deviceId: string;
    operation: MobileSyncOperationDto;
  }): Promise<OperationResult> {
    const { userId, deviceId, operation } = params;

    const existing = await this.syncOperationModel
      .findOne({
        userId,
        deviceId,
        operationId: operation.operationId,
      })
      .lean();

    if (existing?.responsePayload) {
      return existing.responsePayload as OperationResult;
    }

    let result: OperationResult;

    try {
      const data = await this.executeOperation(userId, operation);
      result = {
        operationId: operation.operationId,
        status: 'success',
        retryable: false,
        data,
      };
    } catch (error: any) {
      result = this.mapErrorToResult(operation.operationId, error);
    }

    try {
      await this.syncOperationModel.create({
        userId,
        deviceId,
        operationId: operation.operationId,
        type: operation.type,
        requestPayload: {
          payload: operation.payload,
          resourceId: operation.resourceId ?? null,
        },
        responsePayload: result,
        status: result.status,
        clientCreatedAt: new Date(operation.createdAt),
        processedAt: new Date(),
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicate = await this.syncOperationModel
          .findOne({
            userId,
            deviceId,
            operationId: operation.operationId,
          })
          .lean();

        if (duplicate?.responsePayload) {
          return duplicate.responsePayload as OperationResult;
        }
      }

      throw error;
    }

    return result;
  }

  private async executeOperation(
    userId: string,
    operation: MobileSyncOperationDto,
  ): Promise<unknown> {
    switch (operation.type) {
      case 'UPDATE_PROFILE':
        return this.handleUpdateProfile(userId, operation.payload);
      case 'CREATE_TRANSACTION':
        return this.handleCreateTransaction(userId, operation.payload);
      case 'UPDATE_TRANSACTION':
        return this.handleUpdateTransaction(userId, operation);
      case 'DELETE_TRANSACTION':
        return this.handleDeleteTransaction(userId, operation);
      case 'CREATE_SUBCUENTA':
        return this.handleCreateSubcuenta(userId, operation.payload);
      case 'UPDATE_SUBCUENTA':
        return this.handleUpdateSubcuenta(userId, operation);
      case 'DELETE_SUBCUENTA':
        return this.handleDeleteSubcuenta(userId, operation);
      case 'CREATE_RECORRENTE':
        return this.handleCreateRecurrente(userId, operation.payload);
      case 'UPDATE_RECORRENTE':
        return this.handleUpdateRecurrente(userId, operation);
      case 'DELETE_RECORRENTE':
        return this.handleDeleteRecurrente(userId, operation);
      default:
        throw new BadRequestException({
          code: 'UNSUPPORTED_SYNC_OPERATION',
          message: `Operación no soportada: ${operation.type}`,
        });
    }
  }

  private async handleUpdateProfile(
    userId: string,
    payload: Record<string, unknown>,
  ) {
    const dto = await this.validatePayload(UpdateProfileDto, payload);
    return this.userService.updateProfile(userId, dto);
  }

  private async handleCreateTransaction(
    userId: string,
    payload: Record<string, unknown>,
  ) {
    const dto = await this.validatePayload(CreateTransactionDto, payload);
    return this.transactionsService.crear(dto, userId);
  }

  private async handleUpdateTransaction(
    userId: string,
    operation: MobileSyncOperationDto,
  ) {
    const targetId = this.requireResourceId(operation, 'transactionId');
    const dto = await this.validatePayload(UpdateTransactionDto, operation.payload);
    return this.transactionsService.editar(targetId, dto, userId);
  }

  private async handleDeleteTransaction(
    userId: string,
    operation: MobileSyncOperationDto,
  ) {
    const targetId = this.requireResourceId(operation, 'transactionId');
    return this.transactionsService.eliminar(targetId, userId);
  }

  private async handleCreateSubcuenta(
    userId: string,
    payload: Record<string, unknown>,
  ) {
    const dto = await this.validatePayload(CreateSubcuentaDto, {
      ...payload,
      userId,
    });
    return this.subcuentaService.crear(dto, userId);
  }

  private async handleUpdateSubcuenta(
    userId: string,
    operation: MobileSyncOperationDto,
  ) {
    const targetId = this.requireResourceId(operation, 'subCuentaId');
    await this.subcuentaService.buscarPorSubCuentaId(targetId, userId);
    const dto = await this.validatePayload(UpdateSubcuentaDto, operation.payload);
    return this.subcuentaService.actualizar(targetId, dto);
  }

  private async handleDeleteSubcuenta(
    userId: string,
    operation: MobileSyncOperationDto,
  ) {
    const targetId = this.requireResourceId(operation, 'subCuentaId');
    const dto = await this.validatePayload(DeleteSubcuentaDto, operation.payload);
    return this.subcuentaService.eliminarConDecision(targetId, userId, dto);
  }

  private async handleCreateRecurrente(
    userId: string,
    payload: Record<string, unknown>,
  ) {
    const dto = await this.validatePayload(CrearRecurrenteDto, {
      ...payload,
      userId,
    });
    return this.recurrentesService.crear(dto, userId);
  }

  private async handleUpdateRecurrente(
    userId: string,
    operation: MobileSyncOperationDto,
  ) {
    const targetId = this.requireResourceId(operation, 'recurrenteId');
    const existing = await this.recurrentesService.obtenerPorId(targetId);
    if (String((existing as any).userId) !== userId) {
      throw new ForbiddenException('El recurrente no pertenece al usuario');
    }

    const dto = await this.validatePayload(EditarRecurrenteDto, {
      ...operation.payload,
      frecuenciaTipo:
        (operation.payload.frecuenciaTipo as string | undefined) ??
        (existing as any).frecuenciaTipo,
      frecuenciaValor:
        (operation.payload.frecuenciaValor as string | undefined) ??
        (existing as any).frecuenciaValor,
    });
    return this.recurrentesService.editar(targetId, dto);
  }

  private async handleDeleteRecurrente(
    userId: string,
    operation: MobileSyncOperationDto,
  ) {
    const targetId = this.requireResourceId(operation, 'recurrenteId');
    const existing = await this.recurrentesService.obtenerPorId(targetId);
    if (String((existing as any).userId) !== userId) {
      throw new ForbiddenException('El recurrente no pertenece al usuario');
    }

    return this.recurrentesService.eliminar(targetId);
  }

  private requireResourceId(
    operation: MobileSyncOperationDto,
    fieldName: string,
  ) {
    const value = String(operation.resourceId ?? '').trim();
    if (!value) {
      throw new BadRequestException({
        code: 'MISSING_RESOURCE_ID',
        message: `${fieldName} es requerido para la operación ${operation.type}`,
      });
    }
    return value;
  }

  private async validatePayload<T extends object>(
    cls: new () => T,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const instance = plainToInstance(cls, payload);
    const errors = await validate(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      const message = errors
        .flatMap((error) => Object.values(error.constraints ?? {}))
        .filter(Boolean)
        .join(', ');

      throw new BadRequestException({
        code: 'INVALID_OPERATION_PAYLOAD',
        message: message || 'Payload inválido',
      });
    }

    return instance;
  }

  private mapErrorToResult(
    operationId: string,
    error: unknown,
  ): OperationResult {
    const err = error as any;
    const payload = err?.response;
    const code = payload?.code ?? payload?.error?.code ?? err?.code;
    const message =
      payload?.message ??
      payload?.error?.message ??
      err?.message ??
      'Operation failed';

    if (err instanceof ConflictException) {
      return {
        operationId,
        status: 'conflict',
        retryable: false,
        code: code || 'CONFLICT',
        message,
      };
    }

    if (
      err instanceof BadRequestException ||
      err instanceof NotFoundException ||
      err instanceof ForbiddenException
    ) {
      return {
        operationId,
        status: 'rejected',
        retryable: false,
        code: code || 'REJECTED',
        message,
      };
    }

    if (
      err instanceof TooManyRequestsException ||
      err instanceof InternalServerErrorException
    ) {
      return {
        operationId,
        status: 'retryable',
        retryable: true,
        code: code || 'RETRYABLE_ERROR',
        message,
      };
    }

    return {
      operationId,
      status: 'failed',
      retryable: false,
      code: code || 'FAILED',
      message,
    };
  }
}
