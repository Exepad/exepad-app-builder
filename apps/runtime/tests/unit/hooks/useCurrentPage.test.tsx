/**
 * useCurrentPage Hook Tests (Unit)
 * Tests slug extraction from pathname with basePath stripping
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define mocks before any imports
let mockPathname = '/';
let mockBasePath = '/demo/test-app';
const mockGetPageBySlug = vi.fn();

// Mock react-router at the module level — intercepts the source file's import
vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: mockPathname, search: '', hash: '', state: null, key: 'default' }),
  useNavigate: () => vi.fn(),
}));

// Mock AppConfigContext
vi.mock('@/context/AppConfigContext', () => ({
  useAppConfig: () => ({
    get basePath() { return mockBasePath; },
    get getPageBySlug() { return mockGetPageBySlug; },
  }),
}));

// Dynamic import after mocks are set up
const { renderHook } = await import('@testing-library/react');
const { useCurrentPage, useCurrentPageSlug } = await import('@/hooks/useCurrentPage');

describe('useCurrentPage', () => {
  beforeEach(() => {
    mockPathname = '/demo/test-app';
    mockBasePath = '/demo/test-app';
    mockGetPageBySlug.mockReset();
  });

  it('should resolve root page (/)', () => {
    mockPathname = '/demo/test-app';
    const page = { uuid: 'p1', slug: '/' };
    mockGetPageBySlug.mockReturnValue(page);

    const { result } = renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/');
    expect(result.current).toEqual(page);
  });

  it('should resolve nested page path', () => {
    mockPathname = '/demo/test-app/about';
    const page = { uuid: 'p2', slug: '/about' };
    mockGetPageBySlug.mockReturnValue(page);

    const { result } = renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/about');
    expect(result.current).toEqual(page);
  });

  it('should resolve deeply nested page path', () => {
    mockPathname = '/demo/test-app/services/consulting';
    const page = { uuid: 'p3', slug: '/services/consulting' };
    mockGetPageBySlug.mockReturnValue(page);

    const { result } = renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/services/consulting');
    expect(result.current).toEqual(page);
  });

  it('should return undefined for non-existent page', () => {
    mockPathname = '/demo/test-app/non-existent';
    mockGetPageBySlug.mockReturnValue(undefined);

    const { result } = renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/non-existent');
    expect(result.current).toBeUndefined();
  });

  it('should handle production basePath', () => {
    mockBasePath = '/a/my-app';
    mockPathname = '/a/my-app/contact';
    mockGetPageBySlug.mockReturnValue({ slug: '/contact' });

    renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/contact');
  });

  it('should handle preview mode basePath', () => {
    mockBasePath = '/a/preview-xyz123';
    mockPathname = '/a/preview-xyz123/services';
    mockGetPageBySlug.mockReturnValue({ slug: '/services' });

    renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/services');
  });

  it('should handle root basePath', () => {
    mockBasePath = '/';
    mockPathname = '/about';
    mockGetPageBySlug.mockReturnValue({ slug: '/about' });

    renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/about');
  });

  it('should handle empty basePath', () => {
    mockBasePath = '';
    mockPathname = '/about';
    mockGetPageBySlug.mockReturnValue({ slug: '/about' });

    renderHook(() => useCurrentPage());
    expect(mockGetPageBySlug).toHaveBeenCalledWith('/about');
  });
});

describe('useCurrentPageSlug', () => {
  beforeEach(() => {
    mockPathname = '/demo/test-app';
    mockBasePath = '/demo/test-app';
    mockGetPageBySlug.mockReset();
  });

  it('should return the current page slug', () => {
    mockPathname = '/demo/test-app/about';

    const { result } = renderHook(() => useCurrentPageSlug());
    expect(result.current).toBe('/about');
  });

  it('should return root slug for base path', () => {
    mockPathname = '/demo/test-app';

    const { result } = renderHook(() => useCurrentPageSlug());
    expect(result.current).toBe('/');
  });

  it('should handle deeply nested slugs', () => {
    mockPathname = '/demo/test-app/blog/2024/my-post';

    const { result } = renderHook(() => useCurrentPageSlug());
    expect(result.current).toBe('/blog/2024/my-post');
  });
});
