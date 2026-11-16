import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { ShallowIndexService } from './shallow-index.service';

@Module({
  imports:[ConnectorsModule],
  providers:[ShallowIndexService],
  exports:[ShallowIndexService],
})
export class IndexModule {}
