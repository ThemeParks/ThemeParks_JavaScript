import type { components } from '../_generated/schema';

export type LiveDataEntry = components['schemas']['EntityLiveData'];

type QueueMap = NonNullable<components['schemas']['LiveQueue']>;

export type LiveQueue =
  | ({ type: 'STANDBY' } & NonNullable<QueueMap['STANDBY']>)
  | ({ type: 'SINGLE_RIDER' } & NonNullable<QueueMap['SINGLE_RIDER']>)
  | ({ type: 'RETURN_TIME' } & NonNullable<QueueMap['RETURN_TIME']>)
  | ({ type: 'PAID_RETURN_TIME' } & NonNullable<QueueMap['PAID_RETURN_TIME']>)
  | ({ type: 'BOARDING_GROUP' } & NonNullable<QueueMap['BOARDING_GROUP']>)
  | ({ type: 'PAID_STANDBY' } & NonNullable<QueueMap['PAID_STANDBY']>);

export function* narrowQueues(queue: Record<string, unknown>): Iterable<LiveQueue> {
  for (const [type, payload] of Object.entries(queue)) {
    if (payload && typeof payload === 'object') {
      yield { type: type as LiveQueue['type'], ...(payload as object) } as LiveQueue;
    }
  }
}

export function currentWaitTime(entry: LiveDataEntry): number | null {
  const standby = entry.queue?.STANDBY;
  if (!standby) return null;
  return standby.waitTime ?? null;
}
