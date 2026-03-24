import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SharedCategoriesService } from '../services/shared-categories.service';
import { CreateSharedCategoryDto, UpdateSharedCategoryDto } from '../dto/shared-category.dto';

@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('shared/spaces/:spaceId/categories')
export class SharedCategoriesController {
  constructor(private readonly categoriesService: SharedCategoriesService) {}

  /** POST /shared/spaces/:spaceId/categories — Crear categoría */
  @Post()
  create(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Body() dto: CreateSharedCategoryDto,
  ) {
    return this.categoriesService.create(spaceId, dto, req.user.id);
  }

  /** GET /shared/spaces/:spaceId/categories — Listar categorías */
  @Get()
  list(@Req() req, @Param('spaceId') spaceId: string) {
    return this.categoriesService.list(spaceId);
  }

  /** PATCH /shared/spaces/:spaceId/categories/:categoryId — Actualizar */
  @Patch(':categoryId')
  update(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateSharedCategoryDto,
  ) {
    return this.categoriesService.update(spaceId, categoryId, dto, req.user.id);
  }

  /** DELETE /shared/spaces/:spaceId/categories/:categoryId — Archivar */
  @Delete(':categoryId')
  archive(
    @Req() req,
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categoriesService.archive(spaceId, categoryId, req.user.id);
  }
}
