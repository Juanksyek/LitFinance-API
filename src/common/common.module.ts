import { Global, Module } from '@nestjs/common';
import { MobileClientContextGuard } from './guards/mobile-client-context.guard';
import { SearchProtectionService } from './services/search-protection.service';

@Global()
@Module({
  providers: [SearchProtectionService, MobileClientContextGuard],
  exports: [SearchProtectionService, MobileClientContextGuard],
})
export class CommonModule {}
