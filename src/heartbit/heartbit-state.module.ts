import { Module } from '@nestjs/common';
import { HeartbitController } from './heartbit.controller';
import { HeartbitStoreService } from './heartbit-store.service';

@Module({
  controllers: [HeartbitController],
  providers: [HeartbitStoreService],
  exports: [HeartbitStoreService],
})
export class HeartbitStateModule {}
