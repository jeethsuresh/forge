import type { CaddyLogEntry } from "@/lib/caddy-logs";
import { toCaddyLogEntryFromValue } from "@/lib/caddy-logs";

export interface BufferedCaddyLogEntry extends CaddyLogEntry {
  seq: number;
  receivedAt: string;
}

const MAX_ENTRIES = 5000;

type BufferListener = () => void;

class CaddyLogBuffer {
  private entries: BufferedCaddyLogEntry[] = [];
  private nextSeq = 1;
  private listeners = new Set<BufferListener>();

  ingest(values: unknown[]): BufferedCaddyLogEntry[] {
    const added: BufferedCaddyLogEntry[] = [];
    for (const value of values) {
      const entry = toCaddyLogEntryFromValue(value);
      const buffered: BufferedCaddyLogEntry = {
        ...entry,
        seq: this.nextSeq,
        receivedAt: new Date().toISOString(),
      };
      this.nextSeq += 1;
      this.entries.push(buffered);
      added.push(buffered);
    }

    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    if (added.length > 0) {
      this.notify();
    }
    return added;
  }

  getTail(limit: number): BufferedCaddyLogEntry[] {
    if (limit <= 0) return [];
    return this.entries.slice(-limit);
  }

  getAfter(
    afterSeq: number,
    limit = 500,
  ): { entries: BufferedCaddyLogEntry[]; tailSeq: number } {
    const entries = this.entries
      .filter((entry) => entry.seq > afterSeq)
      .slice(0, limit);
    const tailSeq = this.getTailSeq();
    return { entries, tailSeq };
  }

  getTailSeq(): number {
    if (this.entries.length === 0) return 0;
    return this.entries[this.entries.length - 1]!.seq;
  }

  subscribe(listener: BufferListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  waitForEntriesAfter(afterSeq: number, timeoutMs: number): Promise<void> {
    if (this.getTailSeq() > afterSeq) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };

      const unsubscribe = this.subscribe(() => {
        if (this.getTailSeq() > afterSeq) {
          finish();
        }
      });

      const timer = setTimeout(finish, timeoutMs);
    });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

declare global {
  var __forgeCaddyLogBuffer: CaddyLogBuffer | undefined;
}

export function getCaddyLogBuffer(): CaddyLogBuffer {
  if (!globalThis.__forgeCaddyLogBuffer) {
    globalThis.__forgeCaddyLogBuffer = new CaddyLogBuffer();
  }
  return globalThis.__forgeCaddyLogBuffer;
}
