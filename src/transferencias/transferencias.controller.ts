import { Body, Controller, Headers, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TransferenciasService } from './transferencias.service';
import { CreateTransferenciaDto } from './dto/create-transferencia.dto';

@UseGuards(JwtAuthGuard)
@Controller('transferencias')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class TransferenciasController {
  constructor(private readonly transferenciasService: TransferenciasService) {}

  @Post()
  async crear(
    @Req() req,
    @Body() dto: CreateTransferenciaDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    return this.transferenciasService.crear(req.user.id, dto, idempotencyKeyHeader);
  }
}
