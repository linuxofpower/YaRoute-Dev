import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ShallowIndexService } from './shallow-index.service';

/** Short-lived Heroku one-off. Never spawn this from the web process. */
async function main() {
  if (process.argv.slice(2).length || process.env.NYX_TENANT_SHALLOW_INDEX_ENABLED !== 'true') {
    throw new Error('INDEX_ONCE_DISABLED_OR_INVALID_ARGUMENTS');
  }
  const app=await NestFactory.createApplicationContext(AppModule,{logger:['error','warn']});
  try {
    const result=await app.get(ShallowIndexService).runOnce();
    // No provider filenames, metadata, credentials or raw errors in logs.
    process.stdout.write(JSON.stringify({
      schema:'nyx.indexer-once.v1',...result,execution:'ON_DEMAND',
      workModeAllowed:false,providerWritesAllowed:false,
    })+'\n');
    if (result.status==='RETRY_PENDING'||result.status==='BLOCKED_TRUNCATED') {
      process.exitCode=2;
    }
  } finally { await app.close(); }
}
main().catch(()=>{
  process.stderr.write('INDEX_ONCE_FAILED_CLOSED\n');
  process.exitCode=3;
});
