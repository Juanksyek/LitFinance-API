import { PartialType } from '@nestjs/mapped-types';
import { CrearPlataformaDto } from './crear-plataforma.dto';

export class EditarPlataformaDto extends PartialType(CrearPlataformaDto) {}