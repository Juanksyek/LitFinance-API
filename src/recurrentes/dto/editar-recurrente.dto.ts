import { PartialType } from '@nestjs/mapped-types';
import { CrearRecurrenteDto } from './crear-recurrente.dto';

export class EditarRecurrenteDto extends PartialType(CrearRecurrenteDto) {}
