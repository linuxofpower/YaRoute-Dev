import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NyxBootstrapService } from '../nyx/bootstrap.service';
import { NyxCliRegistryService } from '../nyx/cli-registry.service';
import {
  HeartbitAuthoritySnapshot,
  HeartbitStoreService,
} from './heartbit-store.service';

const HOUR_MS = 60 * 60 * 1000;

export function heartbitSlot(now = new Date()): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

function envMs(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

@Injectable()
export class HeartbitRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbitRunnerService.name);
  private readonly pollMs = envMs('NYX_HEARTBIT_POLL_MS', 60_000, 5_000, 300_000);
  private readonly leaseMs = envMs('NYX_HEARTBIT_LEASE_MS', 15 * 60_000, 60_000, 60 * 60_000);
  private stopping = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly store: HeartbitStoreService,
    private readonly bootstrap: NyxBootstrapService,
    private readonly cliRegistry: NyxCliRegistryService,
  ) {}

  onModuleInit() {
    this.store.requireDurable();
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.loopPromise) {
      await Promise.race([
        this.loopPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
  }

  async tick(now = new Date()) {
    const slot = heartbitSlot(now);
    const observed = await this.store.observeSlot(slot);
    if (observed.missedRecorded > 0) {
      this.logger.warn(
        'Recorded ' + observed.missedRecorded +
        ' missed HeartBit boundary/boundaries before ' + slot.toISOString(),
      );
    }

    const claim = await this.store.claimSlot(slot, this.leaseMs);
    if (!claim.claimed) return;

    let authority: Partial<HeartbitAuthoritySnapshot> | undefined;
    try {
      const locator = await this.bootstrap.locate();
      authority = {
        canonical: {
          head: locator.canonical.head,
          body: locator.canonical.body,
          footer: locator.canonical.footer,
        },
      };

      const current = await this.cliRegistry.current(locator);
      authority.cli = {
        version: current.cli.version,
        sha256: current.hash,
      };

      const completed = await this.store.completeSlot(
        slot,
        authority as HeartbitAuthoritySnapshot,
      );
      this.logger.log(
        'HeartBit cycle ' + completed.cycle + ' verified for ' + slot.toISOString() +
        ' (' + authority.canonical?.head + ' / ' + authority.canonical?.body +
        ' / ' + authority.canonical?.footer + ')',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.failSlot(slot, message, authority);
      this.logger.error(
        'HeartBit pulse failed for ' + slot.toISOString() + ' attempt ' +
        claim.attempts + ': ' + message,
      );
    }
  }

  private async runLoop() {
    while (!this.stopping) {
      try {
        await this.tick();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('HeartBit control-loop error: ' + message);
      }

      if (!this.stopping) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.pollMs));
      }
    }
  }
}
