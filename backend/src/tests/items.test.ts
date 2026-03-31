import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { seedItems } from './seed';

const app = createApp();

beforeEach(async () => {
  await seedItems();
});

describe('GET /api/items?name=', () => {
  it('returns matching items for a valid search', async () => {
    const res = await request(app).get('/api/items?name=Tritanium');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].typeName).toMatch(/tritanium/i);
  });

  it('is case-insensitive', async () => {
    const res = await request(app).get('/api/items?name=tritanium');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('does partial matching', async () => {
    const res = await request(app).get('/api/items?name=Test');
    expect(res.status).toBe(200);
    // Should find "Test LP Output", "Test Required", "Test Mfg Output", "Test Material"
    expect(res.body.length).toBe(4);
  });

  it('returns at most 20 results', async () => {
    const res = await request(app).get('/api/items?name=Test');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(20);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is too short (1 char)', async () => {
    const res = await request(app).get('/api/items?name=T');
    expect(res.status).toBe(400);
  });

  it('returns empty array for no matches', async () => {
    const res = await request(app).get('/api/items?name=ZZZNOMATCH');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('response includes expected fields', async () => {
    const res = await request(app).get('/api/items?name=Tritanium');
    expect(res.status).toBe(200);
    const item = res.body[0];
    expect(item).toHaveProperty('typeId');
    expect(item).toHaveProperty('typeName');
    expect(item).toHaveProperty('volume');
  });
});

describe('GET /api/items/:typeId', () => {
  it('returns the correct item by typeId', async () => {
    const res = await request(app).get('/api/items/34');
    expect(res.status).toBe(200);
    expect(res.body.typeId).toBe(34);
    expect(res.body.typeName).toBe('Tritanium');
  });

  it('returns 404 for unknown typeId', async () => {
    const res = await request(app).get('/api/items/9999999');
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric typeId', async () => {
    const res = await request(app).get('/api/items/abc');
    expect(res.status).toBe(400);
  });
});
