import { Controller, Get } from '@nestjs/common';
import { HeartbitStoreService } from './heartbit-store.service';

@Controller('heartbit')
export class HeartbitController {
  constructor(private readonly store: HeartbitStoreService) {}

  @Get('status')
  status() {
    return this.store.status();
  }
}
