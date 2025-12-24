import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlanConfigController } from './plan-config.controller';
import { PlanConfigService } from './plan-config.service';
import { PlanConfig, PlanConfigSchema } from './schemas/plan-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlanConfig.name, schema: PlanConfigSchema },
    ]),
  ],
  controllers: [PlanConfigController],
  providers: [PlanConfigService],
  exports: [PlanConfigService],
})
export class PlanConfigModule {}
