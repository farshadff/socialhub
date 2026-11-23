import { describe, expect, it } from 'vitest';
import access from './access';

const user = (role: 'admin' | 'operator') => ({
  id: 1,
  name: 'Sara Moradi',
  username: 'sara',
  email: '',
  access: role,
});

describe('access', () => {
  it('lets an admin use admin-only routes', () => {
    expect(access({ currentUser: user('admin') }).canAdmin).toBe(true);
  });

  it('keeps an operator out of admin-only routes', () => {
    expect(access({ currentUser: user('operator') }).canAdmin).toBe(false);
  });

  it('is false without a signed-in user', () => {
    expect(access({ currentUser: undefined }).canAdmin).toBe(false);
    expect(access(undefined).canAdmin).toBe(false);
  });
});
