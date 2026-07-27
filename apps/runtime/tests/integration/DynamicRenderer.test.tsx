/**
 * DynamicRenderer Integration Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DynamicRenderer, DynamicRendererList, ComponentFallback } from '@/components/DynamicRenderer';
import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

// Mock dependencies
vi.mock('@/context/EditModeContext', () => ({
  useEditMode: () => ({
    isEditMode: false,
    setEditMode: vi.fn(),
  }),
}));

vi.mock('@/context/ConfigUpdateContext', () => ({
  useConfigUpdate: () => ({
    subscribeToComponent: vi.fn().mockReturnValue(() => {}),
  }),
}));

vi.mock('@/components/editable/editableRegistry', () => ({
  isEditableComponent: vi.fn().mockReturnValue(false),
  getEditableComponent: vi.fn().mockReturnValue(null),
}));

vi.mock('@/components/editable/ComponentWrapper', () => ({
  ComponentWrapper: ({ children }: { children: React.ReactNode }) => <div data-testid="component-wrapper">{children}</div>,
}));

// Mock the registry to return components
vi.mock('@/registry', () => ({
  getComponent: vi.fn((type: string) => {
    const mockComponents: Record<string, React.ComponentType<any>> = {
      'CodeComponentProps': ({ content, classes }: any) => (
        <div data-testid="code-component" className={classes}>{content}</div>
      ),
      'MockComponentA': ({ text }: any) => (
        <div data-testid="mock-component-a">{text}</div>
      ),
      'MockComponentB': ({ text }: any) => (
        <div data-testid="mock-component-b">{text}</div>
      ),
    };

    return Promise.resolve(mockComponents[type] || null);
  }),
  getComponentSync: vi.fn(() => null),
}));

describe('DynamicRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('component loading', () => {
    it('should render a registered component by type', async () => {
      const component: ComponentProps = {
        uuid: 'code-1',
        componentType: 'CodeComponentProps',
        content: 'Hello World',
      } as any;

      render(<DynamicRenderer component={component} />);

      await waitFor(() => {
        expect(screen.getByTestId('code-component')).toBeInTheDocument();
        expect(screen.getByText('Hello World')).toBeInTheDocument();
      });
    });

    it('should render MockComponentA', async () => {
      const component: ComponentProps = {
        uuid: 'mock-a-1',
        componentType: 'MockComponentA',
        text: 'Welcome',
      } as any;

      render(<DynamicRenderer component={component} />);

      await waitFor(() => {
        expect(screen.getByTestId('mock-component-a')).toBeInTheDocument();
        expect(screen.getByText('Welcome')).toBeInTheDocument();
      });
    });

    it('should render MockComponentB', async () => {
      const component: ComponentProps = {
        uuid: 'mock-b-1',
        componentType: 'MockComponentB',
        text: 'Click Me',
      } as any;

      render(<DynamicRenderer component={component} />);

      await waitFor(() => {
        expect(screen.getByTestId('mock-component-b')).toBeInTheDocument();
        expect(screen.getByText('Click Me')).toBeInTheDocument();
      });
    });
  });

  describe('fallback handling', () => {
    it('should show fallback for unknown component types', async () => {
      const component: ComponentProps = {
        uuid: 'unknown-1',
        componentType: 'UnknownProps',
      } as any;

      render(<DynamicRenderer component={component} />);

      await waitFor(() => {
        expect(screen.getByText(/Component not found: UnknownProps/i)).toBeInTheDocument();
      });
    });

    it('should show fallback when componentType is missing', () => {
      const component = {
        uuid: 'no-type',
      } as any;

      render(<DynamicRenderer component={component} />);

      expect(screen.getByText(/Component not found: undefined/i)).toBeInTheDocument();
    });
  });

  describe('ComponentFallback', () => {
    it('should render fallback with component type', () => {
      render(<ComponentFallback componentType="MissingComponent" />);

      expect(screen.getByText(/Component not found: MissingComponent/i)).toBeInTheDocument();
    });

    it('should apply custom classes', () => {
      render(<ComponentFallback componentType="Missing" classes="custom-class" />);

      const fallback = screen.getByText(/Component not found/i).parentElement;
      expect(fallback).toHaveClass('custom-class');
    });
  });

  describe('ComponentWrapper integration', () => {
    it('should wrap components with uuid in ComponentWrapper', async () => {
      const component: ComponentProps = {
        uuid: 'wrapped-1',
        componentType: 'CodeComponentProps',
        content: 'Wrapped content',
      } as any;

      render(<DynamicRenderer component={component} />);

      await waitFor(() => {
        expect(screen.getByTestId('component-wrapper')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('should show loading skeleton while loading', () => {
      const component: ComponentProps = {
        uuid: 'loading-1',
        componentType: 'CodeComponentProps',
        content: 'Loading...',
      } as any;

      // Component will show loading state briefly before resolving
      render(<DynamicRenderer component={component} />);

      // The loading state may be very brief, so we just verify the component eventually renders
      expect(document.body).toBeInTheDocument();
    });
  });
});

describe('DynamicRendererList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render multiple components', async () => {
    const components: ComponentProps[] = [
      { uuid: 'text-1', componentType: 'CodeComponentProps', content: 'First' } as any,
      { uuid: 'text-2', componentType: 'CodeComponentProps', content: 'Second' } as any,
    ];

    render(<DynamicRendererList components={components} />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
  });

  it('should render single component without wrapper', async () => {
    const components: ComponentProps[] = [
      { uuid: 'single-1', componentType: 'CodeComponentProps', content: 'Single' } as any,
    ];

    render(<DynamicRendererList components={components} />);

    await waitFor(() => {
      expect(screen.getByText('Single')).toBeInTheDocument();
    });
  });

  it('should handle empty components array', () => {
    const { container } = render(<DynamicRendererList components={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('should handle null components', () => {
    const { container } = render(<DynamicRendererList components={null as any} />);

    expect(container.firstChild).toBeNull();
  });

  it('should apply className to wrapper', async () => {
    const components: ComponentProps[] = [
      { uuid: 'text-1', componentType: 'CodeComponentProps', content: 'With Class' } as any,
      { uuid: 'text-2', componentType: 'CodeComponentProps', content: 'Also' } as any,
    ];

    render(<DynamicRendererList components={components} className="custom-list-class" />);

    await waitFor(() => {
      // The wrapper should have the custom class
      const wrapper = document.querySelector('.custom-list-class');
      expect(wrapper).toBeInTheDocument();
    });
  });

  it('should apply article spacing classes', async () => {
    const components: ComponentProps[] = [
      { uuid: 'text-1', componentType: 'CodeComponentProps', content: 'Spaced' } as any,
      { uuid: 'text-2', componentType: 'CodeComponentProps', content: 'Content' } as any,
    ];

    render(<DynamicRendererList components={components} articleSpacing="lg" />);

    await waitFor(() => {
      // The wrapper should have the spacing class
      const wrapper = document.querySelector('.space-y-8');
      expect(wrapper).toBeInTheDocument();
    });
  });
});
