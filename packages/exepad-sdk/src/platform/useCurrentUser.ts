import { getPlatform } from '../helpers/bridge';
import type { CurrentUser } from './types';

const anonymousUser: CurrentUser = {
  id: null,
  email: null,
  name: null,
  roles: [],
  isAuthenticated: false,
};

export function useCurrentUser(): CurrentUser {
  const platform = getPlatform();
  if (platform) {
    return platform.useCurrentUser();
  }
  return anonymousUser;
}
