import type { components } from './_generated/schema';
import type { Transport } from './transport';

export type Destinations = components['schemas']['DestinationsResponse'];
export type Entity = components['schemas']['EntityData'];
export type EntityChildren = components['schemas']['EntityChildrenResponse'];
export type EntityLive = components['schemas']['EntityLiveDataResponse'];
export type EntitySchedule = components['schemas']['EntityScheduleResponse'];

export class RawClient {
  constructor(private readonly transport: Transport) {}

  getDestinations(): Promise<Destinations> {
    return this.transport.get<Destinations>('/destinations');
  }

  getEntity(entityId: string): Promise<Entity> {
    return this.transport.get<Entity>(`/entity/${encodeURIComponent(entityId)}`);
  }

  getEntityChildren(entityId: string): Promise<EntityChildren> {
    return this.transport.get<EntityChildren>(`/entity/${encodeURIComponent(entityId)}/children`);
  }

  getEntityLive(entityId: string): Promise<EntityLive> {
    return this.transport.get<EntityLive>(`/entity/${encodeURIComponent(entityId)}/live`);
  }

  getEntitySchedule(entityId: string): Promise<EntitySchedule> {
    return this.transport.get<EntitySchedule>(`/entity/${encodeURIComponent(entityId)}/schedule`);
  }

  getEntityScheduleMonth(entityId: string, year: number, month: number): Promise<EntitySchedule> {
    const paddedMonth = String(month).padStart(2, '0');
    return this.transport.get<EntitySchedule>(
      `/entity/${encodeURIComponent(entityId)}/schedule/${String(year)}/${paddedMonth}`,
    );
  }
}
