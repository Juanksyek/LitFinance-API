import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PremiumGuard } from '../stripe/premium.guard';

/**
 * Ejemplo de cómo usar el PremiumGuard para proteger endpoints
 * que solo deben ser accesibles para usuarios Premium
 */
@Controller('ejemplo-premium')
@UseGuards(JwtAuthGuard) // Primero valida JWT
export class EjemploPremiumController {
  
  // Endpoint público (solo requiere autenticación)
  @Get('publico')
  async endpointPublico(@Req() req: any) {
    return {
      message: 'Este endpoint está disponible para todos los usuarios autenticados',
      userId: req.user.id,
    };
  }

  // Endpoint premium (requiere autenticación + Premium)
  @UseGuards(PremiumGuard)
  @Get('premium')
  async endpointPremium(@Req() req: any) {
    return {
      message: 'Este endpoint solo está disponible para usuarios Premium',
      userId: req.user.id,
    };
  }

  // Otro ejemplo de endpoint premium
  @UseGuards(PremiumGuard)
  @Get('feature-avanzado')
  async featureAvanzado(@Req() req: any) {
    return {
      message: 'Feature avanzado solo para Premium',
      data: {
        // Tu lógica premium aquí
      },
    };
  }
}
