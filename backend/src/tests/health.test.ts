import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('returns a valid ISO timestamp', async () => {
    const res = await request(app).get('/api/health');
    const ts = new Date(res.body.timestamp);
    expect(ts.toString()).not.toBe('Invalid Date');
  });
});

describe('Unknown routes', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
