import type { components } from '../_generated/schema';
import type { Entity, EntityChildren, EntityLive, EntitySchedule, RawClient } from '../raw';

export type EntityChild = components['schemas']['EntityChild'];

type ScheduleEntry = NonNullable<EntitySchedule['schedule']>[number];

export interface ScheduleApi {
  upcoming(): Promise<EntitySchedule>;
  month(year: number, month: number): Promise<EntitySchedule>;
  range(start: Date, end: Date): Promise<ScheduleEntry[]>;
}

export class EntityHandle {
  readonly schedule: ScheduleApi;

  constructor(
    private readonly raw: RawClient,
    readonly id: string,
  ) {
    this.schedule = {
      upcoming: () => this.raw.getEntitySchedule(this.id),
      month: (year, month) => this.raw.getEntityScheduleMonth(this.id, year, month),
      range: (start, end) => this.scheduleRange(start, end),
    };
  }

  get(): Promise<Entity> {
    return this.raw.getEntity(this.id);
  }

  children(): Promise<EntityChildren> {
    return this.raw.getEntityChildren(this.id);
  }

  live(): Promise<EntityLive> {
    return this.raw.getEntityLive(this.id);
  }

  async *walk(): AsyncIterable<EntityChild> {
    const res = await this.raw.getEntityChildren(this.id);
    for (const child of res.children ?? []) {
      yield child;
    }
  }

  private async scheduleRange(start: Date, end: Date): Promise<ScheduleEntry[]> {
    if (end < start) return [];
    const months = monthsBetween(start, end);
    const responses = await Promise.all(
      months.map(([y, m]) => this.raw.getEntityScheduleMonth(this.id, y, m)),
    );
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const all = responses.flatMap((r) => r.schedule ?? []);
    return all
      .filter((e) => {
        const d = e.date ?? '';
        return d >= startStr && d <= endStr;
      })
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }
}

function monthsBetween(start: Date, end: Date): Array<[number, number]> {
  const months: Array<[number, number]> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= stop) {
    months.push([cursor.getUTCFullYear(), cursor.getUTCMonth() + 1]);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
