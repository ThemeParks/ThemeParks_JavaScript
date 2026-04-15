import { describe, it, expect } from 'vitest';
import type { EntityLive } from '../../src/raw';
import { currentWaitTime, narrowQueues } from '../../src/ergonomic/live';

const sample: EntityLive = {
  id: 'abc',
  name: 'X',
  liveData: [
    {
      id: 'r1',
      name: 'Ride 1',
      entityType: 'ATTRACTION',
      status: 'OPERATING',
      lastUpdated: '2026-04-14T12:00:00Z',
      queue: {
        STANDBY: { waitTime: 30 },
      },
    },
    {
      id: 'r2',
      name: 'Ride 2',
      entityType: 'ATTRACTION',
      status: 'OPERATING',
      lastUpdated: '2026-04-14T12:00:00Z',
      queue: {
        STANDBY: { waitTime: null },
      },
    },
  ],
} as unknown as EntityLive;

describe('live helpers', () => {
  it('currentWaitTime returns STANDBY wait time when set', () => {
    expect(currentWaitTime(sample.liveData![0]!)).toBe(30);
  });

  it('currentWaitTime returns null when STANDBY waitTime is null', () => {
    expect(currentWaitTime(sample.liveData![1]!)).toBeNull();
  });

  it('narrowQueues yields typed queue objects', () => {
    const first = sample.liveData![0]!;
    const queues = [...narrowQueues(first.queue ?? {})];
    expect(queues).toEqual([{ type: 'STANDBY', waitTime: 30 }]);
  });
});
