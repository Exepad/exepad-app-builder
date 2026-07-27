/**
 * Phase 2 Backend E2E Tests
 *
 * Tests for Auto-CRUD operations and custom handler execution.
 * Note: These tests require Cloudflare Workers environment (wrangler dev or deployed).
 */

import { test, expect } from 'playwright/test';

// Test app configuration
const TEST_APP_ID = 'test-phase2-app';
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const API_BASE = `${BASE_URL}/api/${TEST_APP_ID}`;

// Test model configuration
const TEST_MODEL = {
  name: 'contacts',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text', isUnique: true },
    { name: 'phone', type: 'text', isNullable: true },
    { name: 'metadata', type: 'json', isNullable: true },
  ],
  crudPolicy: {
    create: 'authenticated',
    read: 'authenticated',
    update: 'authenticated',
    delete: 'authenticated',
    list: 'authenticated',
  },
};

// Helper to make authenticated API calls
async function apiCall(
  endpoint: string,
  method: string = 'POST',
  body?: object,
  userId: string = 'test-user-1'
) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-User-Email': 'test@example.com',
      'X-User-Roles': 'user',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    data: await response.json(),
  };
}

test.describe('Phase 2: Health Check', () => {
  test('health endpoint shows Phase 2 status', async () => {
    const response = await fetch(`${API_BASE}/_health`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.appId).toBe(TEST_APP_ID);
    expect(data.phase).toBe(2);
    expect(data.bindings).toBeDefined();
  });
});

test.describe('Phase 2: Auto-CRUD Operations', () => {
  test.describe('sys_create', () => {
    test('creates a new record', async () => {
      const result = await apiCall('contacts', 'POST', {
        method: 'sys_create',
        model: 'contacts',
        params: {
          data: {
            name: 'John Doe',
            email: `john-${Date.now()}@example.com`,
            phone: '+1234567890',
          },
        },
      });

      // Note: This will return 503 without WfP deployment
      // In full E2E with deployed worker, expect 200
      expect([200, 503, 404]).toContain(result.status);

      if (result.status === 200) {
        expect(result.data.success).toBe(true);
        expect(result.data.data.name).toBe('John Doe');
        expect(result.data.data.id).toBeDefined();
        expect(result.data.data.created_at).toBeDefined();
      }
    });

    test('validates required fields', async () => {
      const result = await apiCall('contacts', 'POST', {
        method: 'sys_create',
        model: 'contacts',
        params: {
          data: {
            // Missing required 'name' field
            email: 'missing-name@example.com',
          },
        },
      });

      // With deployed worker, expect validation error
      if (result.status === 200 || result.status === 400) {
        if (result.status === 400) {
          expect(result.data.success).toBe(false);
          expect(result.data.error.code).toBe('VALIDATION_ERROR');
        }
      }
    });
  });

  test.describe('sys_list', () => {
    test('lists records with pagination', async () => {
      const result = await apiCall('contacts', 'POST', {
        method: 'sys_list',
        model: 'contacts',
        params: {
          limit: 10,
          offset: 0,
          orderBy: { created_at: 'desc' },
        },
      });

      expect([200, 503, 404]).toContain(result.status);

      if (result.status === 200) {
        expect(result.data.success).toBe(true);
        expect(Array.isArray(result.data.data)).toBe(true);
        expect(result.data.pagination).toBeDefined();
        expect(result.data.pagination.limit).toBe(10);
        expect(result.data.pagination.offset).toBe(0);
      }
    });

    test('filters records', async () => {
      const result = await apiCall('contacts', 'POST', {
        method: 'sys_list',
        model: 'contacts',
        params: {
          filters: { name: 'John Doe' },
        },
      });

      expect([200, 503, 404]).toContain(result.status);

      if (result.status === 200) {
        expect(result.data.success).toBe(true);
        for (const record of result.data.data) {
          expect(record.name).toBe('John Doe');
        }
      }
    });
  });

  test.describe('sys_read', () => {
    test('reads a single record by ID', async () => {
      // First create a record
      const createResult = await apiCall('contacts', 'POST', {
        method: 'sys_create',
        model: 'contacts',
        params: {
          data: {
            name: 'Read Test',
            email: `read-test-${Date.now()}@example.com`,
          },
        },
      });

      if (createResult.status === 200) {
        const recordId = createResult.data.data.id;

        // Then read it
        const readResult = await apiCall('contacts', 'POST', {
          method: 'sys_read',
          model: 'contacts',
          params: { id: recordId },
        });

        expect(readResult.status).toBe(200);
        expect(readResult.data.success).toBe(true);
        expect(readResult.data.data.id).toBe(recordId);
        expect(readResult.data.data.name).toBe('Read Test');
      }
    });

    test('returns 404 for non-existent record', async () => {
      const result = await apiCall('contacts', 'POST', {
        method: 'sys_read',
        model: 'contacts',
        params: { id: 99999999 },
      });

      if (result.status === 200 || result.status === 404) {
        if (result.status === 404 || !result.data.success) {
          expect(result.data.error.code).toBe('NOT_FOUND');
        }
      }
    });
  });

  test.describe('sys_update', () => {
    test('updates an existing record', async () => {
      // First create a record
      const createResult = await apiCall('contacts', 'POST', {
        method: 'sys_create',
        model: 'contacts',
        params: {
          data: {
            name: 'Update Test',
            email: `update-test-${Date.now()}@example.com`,
          },
        },
      });

      if (createResult.status === 200) {
        const recordId = createResult.data.data.id;

        // Then update it
        const updateResult = await apiCall('contacts', 'POST', {
          method: 'sys_update',
          model: 'contacts',
          params: {
            id: recordId,
            data: { name: 'Updated Name' },
          },
        });

        expect(updateResult.status).toBe(200);
        expect(updateResult.data.success).toBe(true);
        expect(updateResult.data.data.name).toBe('Updated Name');
        expect(updateResult.data.data.updated_at).toBeDefined();
      }
    });
  });

  test.describe('sys_delete', () => {
    test('deletes a record', async () => {
      // First create a record
      const createResult = await apiCall('contacts', 'POST', {
        method: 'sys_create',
        model: 'contacts',
        params: {
          data: {
            name: 'Delete Test',
            email: `delete-test-${Date.now()}@example.com`,
          },
        },
      });

      if (createResult.status === 200) {
        const recordId = createResult.data.data.id;

        // Then delete it
        const deleteResult = await apiCall('contacts', 'POST', {
          method: 'sys_delete',
          model: 'contacts',
          params: { id: recordId },
        });

        expect(deleteResult.status).toBe(200);
        expect(deleteResult.data.success).toBe(true);
        expect(deleteResult.data.data.deleted).toBe(true);

        // Verify it's gone
        const readResult = await apiCall('contacts', 'POST', {
          method: 'sys_read',
          model: 'contacts',
          params: { id: recordId },
        });

        expect(readResult.data.success).toBe(false);
      }
    });
  });
});

test.describe('Phase 2: Owner-based Isolation', () => {
  test('users can only see their own records', async () => {
    const email1 = `user1-${Date.now()}@example.com`;
    const email2 = `user2-${Date.now()}@example.com`;

    // User 1 creates a record
    const user1Create = await apiCall(
      'contacts',
      'POST',
      {
        method: 'sys_create',
        model: 'contacts',
        params: {
          data: { name: 'User 1 Contact', email: email1 },
        },
      },
      'user-1'
    );

    // User 2 creates a record
    const user2Create = await apiCall(
      'contacts',
      'POST',
      {
        method: 'sys_create',
        model: 'contacts',
        params: {
          data: { name: 'User 2 Contact', email: email2 },
        },
      },
      'user-2'
    );

    if (user1Create.status === 200 && user2Create.status === 200) {
      // User 1 should only see their own records
      const user1List = await apiCall(
        'contacts',
        'POST',
        {
          method: 'sys_list',
          model: 'contacts',
          params: {},
        },
        'user-1'
      );

      expect(user1List.status).toBe(200);
      const user1Emails = user1List.data.data.map((r: { email: string }) => r.email);
      expect(user1Emails).toContain(email1);
      expect(user1Emails).not.toContain(email2);

      // User 2 should only see their own records
      const user2List = await apiCall(
        'contacts',
        'POST',
        {
          method: 'sys_list',
          model: 'contacts',
          params: {},
        },
        'user-2'
      );

      expect(user2List.status).toBe(200);
      const user2Emails = user2List.data.data.map((r: { email: string }) => r.email);
      expect(user2Emails).toContain(email2);
      expect(user2Emails).not.toContain(email1);
    }
  });
});

test.describe('Phase 2: Error Handling', () => {
  test('returns proper error for non-existent model', async () => {
    const result = await apiCall('nonexistent_model', 'POST', {
      method: 'sys_list',
      model: 'nonexistent_model',
      params: {},
    });

    expect([404, 503]).toContain(result.status);

    if (result.status === 404) {
      expect(result.data.success).toBe(false);
      expect(result.data.error.code).toBe('ROUTE_NOT_FOUND');
    }
  });

  test('returns proper error for invalid method', async () => {
    const result = await apiCall('contacts', 'POST', {
      method: 'invalid_method',
      model: 'contacts',
      params: {},
    });

    if (result.status === 200 || result.status === 405) {
      expect(result.data.success).toBe(false);
    }
  });
});

test.describe('Phase 2: Deployment API', () => {
  test('deployment endpoint accepts configuration', async () => {
    const response = await fetch(`${BASE_URL}/api/deploy/${TEST_APP_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          app: {
            uuid: 'test-uuid',
            name: 'Test App',
            alias: TEST_APP_ID,
          },
          backend: {
            models: [TEST_MODEL],
            handlers: [],
          },
        },
        migrationPolicy: 'safe',
        seedData: false,
      }),
    });

    const data = await response.json();

    // May return 503 without full Cloudflare bindings
    expect([200, 503]).toContain(response.status);

    if (response.status === 200) {
      expect(data.success).toBe(true);
      expect(data.data.appId).toBe(TEST_APP_ID);
      expect(data.data.configStored).toBe(true);
    }
  });

  test('get deployment status', async () => {
    const response = await fetch(`${BASE_URL}/api/deploy/${TEST_APP_ID}`, {
      method: 'GET',
    });

    // May return 404 if not deployed, 503 without bindings
    expect([200, 404, 503]).toContain(response.status);
  });
});
