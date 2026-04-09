import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PlataformaRecurrente } from './schemas/plataforma-recurrente.schema';
import { Model } from 'mongoose';
import { CrearPlataformaDto } from './dto/crear-plataforma.dto';
import { EditarPlataformaDto } from './dto/editar-plataforma.dto';
import { generateUniqueId } from 'src/utils/generate-id';

@Injectable()
export class PlataformasRecurrentesService {
  constructor(
    @InjectModel(PlataformaRecurrente.name)
    private readonly plataformaModel: Model<PlataformaRecurrente>,
  ) {}

  async insertarPlataformasRecurrentes(plataformas: any[], user: any) {
    if (user.rol !== 'admin') {
      throw new ForbiddenException('Solo los administradores pueden insertar plataformas');
    }
  
    const plataformasValidas = plataformas.filter((p) => {
      const nombreValido = typeof p?.nombre === 'string' && p.nombre.trim() !== '';
      return nombreValido;
    });
  
    let procesadas = 0;
  
    for (const plataforma of plataformasValidas) {
      const nombre = plataforma.nombre.trim();
      const existente = await this.plataformaModel.findOne({ nombre });
  
      if (!existente) {
        const plataformaId = await generateUniqueId(this.plataformaModel, 'plataformaId');
  
        await this.plataformaModel.create({
          plataformaId,
          nombre,
          categoria: plataforma.categoria || null,
          color: plataforma.color || null,
        });
      } else {
        await this.plataformaModel.updateOne(
          { nombre },
          {
            categoria: plataforma.categoria ?? existente.categoria,
            color: plataforma.color ?? existente.color,
          }
        );
      }
  
      procesadas++;
    }
  
    return {
      mensaje: `${procesadas} plataforma(s) procesadas correctamente.`,
    };
  }

  async crear(dto: CrearPlataformaDto) {
    const plataformaId = await generateUniqueId(this.plataformaModel, 'plataformaId');
    return await this.plataformaModel.create({ ...dto, plataformaId });
  }

  async listar(search?: string) {
    const filtro: any = {};
  
    if (search) {
      const regex = new RegExp(search, 'i');
      filtro.$or = [
        { nombre: { $regex: regex } },
        { categoria: { $regex: regex } },
      ];
    }
  
    return this.plataformaModel.find(filtro).sort({ nombre: 1 }).exec();
  }

  async editar(id: string, dto: EditarPlataformaDto) {
    return this.plataformaModel.findOneAndUpdate({ plataformaId: id }, dto, { new: true });
  }

  async eliminar(id: string) {
    return this.plataformaModel.deleteOne({ plataformaId: id });
  }
}
