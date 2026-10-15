import { Module } from '@nestjs/common';
import { NyxModule } from '../nyx/nyx.module';
import { HeartbitRunnerService } from './heartbit-runner.service';
import { HeartbitStateModule } from './heartbit-state.module';

@Module({
  imports: [HeartbitStateModule, NyxModule],
  providers: [HeartbitRunnerService],
})
export class HeartbitRunnerModule {}
