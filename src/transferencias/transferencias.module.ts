import { Module } from '@nestjs/common';
import { GoalsModule } from '../goals/goals.module';
import { UserModule } from '../user/user.module';
import { TransferenciasController } from './transferencias.controller';
import { TransferenciasService } from './transferencias.service';

@Module({
  imports: [GoalsModule, UserModule],
  controllers: [TransferenciasController],
  providers: [TransferenciasService],
})
export class TransferenciasModule {}
