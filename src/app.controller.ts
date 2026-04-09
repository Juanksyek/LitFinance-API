import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): object {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => +(bytes / 1024 / 1024).toFixed(2);

    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'LitFinance API',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: {
        rssMB: toMB(mem.rss),
        heapTotalMB: toMB(mem.heapTotal),
        heapUsedMB: toMB(mem.heapUsed),
        externalMB: toMB(mem.external),
        arrayBuffersMB: toMB(mem.arrayBuffers),
      },
    };
  }
}
