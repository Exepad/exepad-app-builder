import { Hono } from 'hono';
import type { Env } from '../../types/env';
import { users } from './users';
import { database } from './database';
import { files } from './files';
import { settings } from './settings';
import { source } from './source';
import { exportRoutes } from './export';

export const admin = new Hono<{ Bindings: Env }>();

admin.route('/:appId/users', users);
admin.route('/:appId/database', database);
admin.route('/:appId/files', files);
admin.route('/:appId/settings', settings);
admin.route('/:appId/source', source);
admin.route('/:appId/export', exportRoutes);
