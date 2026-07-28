import { Module } from '@nestjs/common';
import { SoraService } from './sora.service';

@Module({
  providers: [SoraService],
  exports: [SoraService],
})
export class SoraModule {}