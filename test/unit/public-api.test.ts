import { describe, it, expect } from 'vitest';
import {
  ApiError,
  InMemoryLruCache,
  NetworkError,
  RateLimitError,
  ThemeParks,
  ThemeParksError,
  TimeoutError,
  currentWaitTime,
  narrowQueues,
  parseApiDateTime,
} from '../../src';

describe('public API surface', () => {
  it('exports the documented symbols', () => {
    expect(typeof ThemeParks).toBe('function');
    expect(typeof currentWaitTime).toBe('function');
    expect(typeof narrowQueues).toBe('function');
    expect(typeof parseApiDateTime).toBe('function');
    expect(typeof InMemoryLruCache).toBe('function');
    expect(typeof ApiError).toBe('function');
    expect(typeof NetworkError).toBe('function');
    expect(typeof RateLimitError).toBe('function');
    expect(typeof TimeoutError).toBe('function');
    expect(typeof ThemeParksError).toBe('function');
  });
});
