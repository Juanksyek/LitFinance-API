import { PartialType } from '@nestjs/mapped-types';
import { CreateSubcuentaDto } from '../create-subcuenta.dto/create-subcuenta.dto';

export class UpdateSubcuentaDto extends PartialType(CreateSubcuentaDto) {}