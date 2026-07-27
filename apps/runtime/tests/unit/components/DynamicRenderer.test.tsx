import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Registry mock
//
// DynamicRenderer resolves the concrete React component for a given
// `componentType` through `../registry`. We replace that module with a fully
// controllable surface so each test can decide whether a component:
//   - is present synchronously (getComponentSync hit → no loading flicker),
//   - resolves asynchronously (getComponent),
//   - is missing (resolves null → ComponentFallback), or
//   - throws while rendering (error-boundary integration).
// The mocked component reads `data-testid` off the config props so we can assert
// that exactly the right props flow through `finalProps`.
// ---------------------------------------------------------------------------

// A passthrough renderer for any registered code component. It echoes a few of
// the props DynamicRenderer forwards so we can assert prop plumbing + children.
const PassthroughComponent: React.FC<any> = ({ uuid, label, children }) => (
  <div data-testid="rendered-component" data-uuid={uuid ?? ''}>
    <span data-testid="rendered-label">{label ?? ''}</span>
    {children}
  </div>
);

// A component that throws synchronously during render — drives the error boundary.
const ThrowingComponent: React.FC<any> = () => {
  throw new Error('boom: component blew up during render');
};

const getComponentSyncMock = vi.fn();
const getComponentMock = vi.fn();

vi.mock('@/registry', () => ({
  getComponent: (...args: any[]) => getComponentMock(...args),
  getComponentSync: (...args: any[]) => getComponentSyncMock(...args),
}));

// Keep the editable path inert: published/read-only rendering is what we exercise.
// `isEditableComponent` → false means DynamicRenderer never routes through the
// lazy editable wrapper or Suspense, so the plain code path is under test.
vi.mock('@/components/editable/editableRegistry', () => ({
  isEditableComponent: () => false,
  getEditableComponent: () => null,
}));

// Replace ComponentWrapper with a thin passthrough so the wrapper's own
// store/selection machinery doesn't pull in unrelated behavior. We keep a
// data attribute so we can still assert it wraps the tree when a uuid exists.
vi.mock('@/components/editable/ComponentWrapper', () => ({
  ComponentWrapper: ({ componentId, children }: any) => (
    <div data-testid="component-wrapper" data-component-id={componentId}>
      {children}
    </div>
  ),
}));

// EditModeContext / ConfigUpdateContext ship default context values, so the
// real `useContext` hooks work without providers. We still mock them to make
// the published (non-preview, non-edit) defaults explicit and stable.
vi.mock('@/context/EditModeContext', () => ({
  useEditMode: () => ({ isEditMode: false, isPreview: false }),
}));

vi.mock('@/context/ConfigUpdateContext', () => ({
  useConfigUpdate: () => ({ subscribeToComponent: () => () => {} }),
}));

// Import AFTER the mocks are registered.
import {
  DynamicRenderer,
  DynamicRendererList,
  ComponentFallback,
} from '@/components/DynamicRenderer';

// A minimal valid component config. `componentType` matches the registry key
// pattern; the rest are arbitrary props the code component would consume.
function makeComponent(overrides: Record<string, unknown> = {}) {
  return {
    componentType: 'CodeComponentProps',
    uuid: 'cmp-1',
    label: 'hello',
    ...overrides,
  } as any;
}

describe('DynamicRenderer', () => {
  beforeEach(() => {
    getComponentSyncMock.mockReset();
    getComponentMock.mockReset();
    // Default: component is available synchronously from cache → no async load,
    // no loading-null flicker. Individual tests override as needed.
    getComponentSyncMock.mockReturnValue(PassthroughComponent);
    getComponentMock.mockResolvedValue(PassthroughComponent);
    // Silence the boundary's componentDidCatch error logging noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('basic rendering + prop plumbing', () => {
    it('renders the resolved component and forwards uuid + config props', () => {
      render(<DynamicRenderer component={makeComponent({ label: 'Greetings' })} />);

      const el = screen.getByTestId('rendered-component');
      expect(el).toBeInTheDocument();
      // uuid is passed through to the component (and not stripped).
      expect(el).toHaveAttribute('data-uuid', 'cmp-1');
      expect(screen.getByTestId('rendered-label')).toHaveTextContent('Greetings');
    });

    it('wraps the rendered tree in ComponentWrapper when a uuid is present', () => {
      render(<DynamicRenderer component={makeComponent({ uuid: 'uuid-xyz' })} />);

      const wrapper = screen.getByTestId('component-wrapper');
      expect(wrapper).toHaveAttribute('data-component-id', 'uuid-xyz');
      // The component renders INSIDE the wrapper.
      expect(wrapper).toContainElement(screen.getByTestId('rendered-component'));
    });

    it('renders without a wrapper when the component has no uuid', () => {
      render(<DynamicRenderer component={makeComponent({ uuid: undefined })} />);

      expect(screen.queryByTestId('component-wrapper')).not.toBeInTheDocument();
      expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
    });

    it('passes React children through when config has no children prop', () => {
      render(
        <DynamicRenderer component={makeComponent()}>
          <span data-testid="react-child">child node</span>
        </DynamicRenderer>
      );

      expect(screen.getByTestId('react-child')).toHaveTextContent('child node');
    });

    it('does NOT inject React children when the config already provides a children prop', () => {
      // hasConfigChildren short-circuits useReactChildren so the JSX child is dropped.
      render(
        <DynamicRenderer component={makeComponent({ children: 'config-owned' })}>
          <span data-testid="react-child">should-not-appear</span>
        </DynamicRenderer>
      );

      expect(screen.queryByTestId('react-child')).not.toBeInTheDocument();
      expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
    });
  });

  describe('showWhen / visibility gating', () => {
    it('renders when showWhen is true', () => {
      render(<DynamicRenderer component={makeComponent({ showWhen: true })} />);
      expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
    });

    it('hides (renders nothing) when showWhen is false', () => {
      const { container } = render(
        <DynamicRenderer component={makeComponent({ showWhen: false })} />
      );
      expect(screen.queryByTestId('rendered-component')).not.toBeInTheDocument();
      // null render → wrapper not mounted either.
      expect(container).toBeEmptyDOMElement();
    });

    it('renders when showWhen is undefined (default-visible)', () => {
      render(<DynamicRenderer component={makeComponent()} />);
      expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
    });

    it('falls back to visibilityCondition when showWhen is absent', () => {
      const { container } = render(
        <DynamicRenderer component={makeComponent({ visibilityCondition: false })} />
      );
      expect(screen.queryByTestId('rendered-component')).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    });

    it('renders when visibilityCondition is true', () => {
      render(
        <DynamicRenderer component={makeComponent({ visibilityCondition: true })} />
      );
      expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
    });

    it('prefers showWhen over visibilityCondition (showWhen:false wins)', () => {
      // condition = showWhen ?? visibilityCondition → showWhen:false short-circuits.
      const { container } = render(
        <DynamicRenderer
          component={makeComponent({ showWhen: false, visibilityCondition: true })}
        />
      );
      expect(screen.queryByTestId('rendered-component')).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    });

    it('coerces truthy/falsy non-boolean showWhen values via Boolean()', () => {
      // Falsy values hide.
      const { container, rerender } = render(
        <DynamicRenderer component={makeComponent({ showWhen: 0 as any })} />
      );
      expect(container).toBeEmptyDOMElement();

      // Empty string is falsy → hidden.
      rerender(<DynamicRenderer component={makeComponent({ showWhen: '' as any })} />);
      expect(screen.queryByTestId('rendered-component')).not.toBeInTheDocument();

      // Truthy non-boolean (non-empty string) → visible.
      rerender(
        <DynamicRenderer component={makeComponent({ showWhen: 'yes' as any })} />
      );
      expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
    });

    it('treats null showWhen (no visibilityCondition) as nullish → default-visible', () => {
      // condition = (null ?? undefined): `??` is nullish-coalescing, so null
      // falls through to visibilityCondition (undefined) → undefined → the
      // undefined-guard fires → render (visible). A bare null does NOT hide.
      render(
        <DynamicRenderer component={makeComponent({ showWhen: null as any })} />
      );
      expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
    });

    it('hides when null showWhen falls through to a falsy visibilityCondition', () => {
      // null ?? false → false (defined) → Boolean(false) → hidden.
      const { container } = render(
        <DynamicRenderer
          component={makeComponent({
            showWhen: null as any,
            visibilityCondition: false,
          })}
        />
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('missing / invalid component config', () => {
    it('renders ComponentFallback when componentType is missing', () => {
      render(<DynamicRenderer component={{ uuid: 'no-type' } as any} />);

      expect(screen.getByText(/Component not found: undefined/i)).toBeInTheDocument();
      expect(
        screen.getByText(/not registered or failed to load/i)
      ).toBeInTheDocument();
    });

    it('renders ComponentFallback when the registry cannot resolve the component', async () => {
      // No sync cache hit + async resolve returns null → error path → fallback.
      getComponentSyncMock.mockReturnValue(null);
      getComponentMock.mockResolvedValue(null);

      render(
        <DynamicRenderer component={makeComponent({ componentType: 'GhostProps' })} />
      );

      await waitFor(() => {
        expect(
          screen.getByText(/Component not found: GhostProps/i)
        ).toBeInTheDocument();
      });
    });

    it('renders ComponentFallback when the async loader throws', async () => {
      getComponentSyncMock.mockReturnValue(null);
      getComponentMock.mockRejectedValue(new Error('network down'));

      render(
        <DynamicRenderer component={makeComponent({ componentType: 'BrokenProps' })} />
      );

      await waitFor(() => {
        expect(
          screen.getByText(/Component not found: BrokenProps/i)
        ).toBeInTheDocument();
      });
    });

    it('passes the config `classes` through to the fallback container', () => {
      render(
        <DynamicRenderer
          component={{ uuid: 'x', classes: 'my-custom-class' } as any}
        />
      );
      const fallback = screen
        .getByText(/Component not found: undefined/i)
        .closest('div');
      expect(fallback?.className).toContain('my-custom-class');
    });
  });

  describe('async loading', () => {
    it('renders nothing while the component is loading, then the component', async () => {
      let resolveLoad!: (c: React.ComponentType<any>) => void;
      getComponentSyncMock.mockReturnValue(null); // force async path
      getComponentMock.mockReturnValue(
        new Promise((res) => {
          resolveLoad = res;
        })
      );

      const { container } = render(
        <DynamicRenderer component={makeComponent({ componentType: 'AsyncProps' })} />
      );

      // While loading: returns null (no fixed-size placeholder to avoid CLS).
      expect(container).toBeEmptyDOMElement();

      resolveLoad(PassthroughComponent);

      await waitFor(() => {
        expect(screen.getByTestId('rendered-component')).toBeInTheDocument();
      });
    });
  });

  describe('error-boundary integration', () => {
    it('catches a throwing child and shows the boundary fallback instead of crashing', () => {
      getComponentSyncMock.mockReturnValue(ThrowingComponent);

      render(
        <DynamicRenderer component={makeComponent({ componentType: 'CodeComponentProps' })} />
      );

      // Boundary fallback names the componentType; the throw did not propagate.
      expect(
        screen.getByText(/Component Error: CodeComponentProps/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      // The throwing component itself rendered nothing.
      expect(screen.queryByTestId('rendered-component')).not.toBeInTheDocument();
    });
  });
});

describe('ComponentFallback', () => {
  it('shows the component type and a default explanation', () => {
    render(<ComponentFallback componentType="WidgetProps" />);
    expect(screen.getByText(/Component not found: WidgetProps/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not registered or failed to load/i)
    ).toBeInTheDocument();
  });

  it('appends extra classes when provided', () => {
    const { container } = render(
      <ComponentFallback componentType="WidgetProps" classes="extra-cls" />
    );
    expect((container.firstChild as HTMLElement).className).toContain('extra-cls');
  });

  it('does not break when classes is omitted (no literal "undefined" class)', () => {
    const { container } = render(<ComponentFallback componentType="WidgetProps" />);
    expect((container.firstChild as HTMLElement).className).not.toContain('undefined');
  });
});

describe('DynamicRendererList', () => {
  beforeEach(() => {
    getComponentSyncMock.mockReset();
    getComponentMock.mockReset();
    getComponentSyncMock.mockReturnValue(PassthroughComponent);
    getComponentMock.mockResolvedValue(PassthroughComponent);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for an empty array', () => {
    const { container } = render(<DynamicRendererList components={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when components is not an array', () => {
    const { container } = render(
      <DynamicRendererList components={null as any} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a single component WITHOUT a surrounding wrapper div', () => {
    const { container } = render(
      <DynamicRendererList components={[makeComponent({ uuid: 'solo' })]} />
    );
    // No extra <div> list-wrapper: the only child is the ComponentWrapper itself.
    expect(container.firstChild).toBe(screen.getByTestId('component-wrapper'));
  });

  it('wraps multiple components in a div and renders each', () => {
    render(
      <DynamicRendererList
        components={[
          makeComponent({ uuid: 'a', label: 'A' }),
          makeComponent({ uuid: 'b', label: 'B' }),
        ]}
      />
    );
    expect(screen.getAllByTestId('rendered-component')).toHaveLength(2);
    const labels = screen.getAllByTestId('rendered-label').map((n) => n.textContent);
    expect(labels).toEqual(['A', 'B']);
  });

  it('applies articleSpacing classes when provided', () => {
    const { container } = render(
      <DynamicRendererList
        components={[makeComponent({ uuid: 'a' })]}
        articleSpacing="lg"
      />
    );
    // articleSpacing forces the list-wrapper div even for a single component.
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.className).toContain('space-y-8');
  });
});

// ---------------------------------------------------------------------------
// ComponentErrorBoundary — dev-vs-prod stack leak
//
// SECURITY: in production the boundary must NOT render the raw error message /
// stack trace into the DOM (it would leak internals to end users). The gate is
// `import.meta.env.MODE === 'development'`, which `vi.stubEnv('MODE', …)`
// controls. The default vitest MODE is 'test', i.e. NOT development → prod-like.
// ---------------------------------------------------------------------------
import { ComponentErrorBoundary } from '@/components/ComponentErrorBoundary';

const Boom: React.FC = () => {
  throw new Error('sensitive-stack-detail-do-not-leak');
};

describe('ComponentErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders children unchanged when nothing throws', () => {
    render(
      <ComponentErrorBoundary componentType="OkProps">
        <span data-testid="ok-child">all good</span>
      </ComponentErrorBoundary>
    );
    expect(screen.getByTestId('ok-child')).toHaveTextContent('all good');
  });

  it('catches a throw and shows the fallback naming the component type', () => {
    render(
      <ComponentErrorBoundary componentType="BadProps">
        <Boom />
      </ComponentErrorBoundary>
    );
    expect(screen.getByText(/Component Error: BadProps/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('does NOT leak the raw error message or stack in production-like mode', () => {
    // Default MODE is 'test' (not 'development') → prod branch.
    render(
      <ComponentErrorBoundary componentType="BadProps">
        <Boom />
      </ComponentErrorBoundary>
    );

    // The fallback is shown...
    expect(screen.getByText(/Component Error: BadProps/i)).toBeInTheDocument();
    // ...but the sensitive message / stack is NOT in the DOM, and there is no
    // collapsible "Error Details" block.
    expect(
      screen.queryByText(/sensitive-stack-detail-do-not-leak/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Error Details/i)).not.toBeInTheDocument();
  });

  it('explicitly does not leak when MODE is production', () => {
    vi.stubEnv('MODE', 'production');
    render(
      <ComponentErrorBoundary componentType="BadProps">
        <Boom />
      </ComponentErrorBoundary>
    );
    expect(
      screen.queryByText(/sensitive-stack-detail-do-not-leak/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Error Details/i)).not.toBeInTheDocument();
  });

  it('DOES surface the error message + stack in development mode', () => {
    vi.stubEnv('MODE', 'development');
    render(
      <ComponentErrorBoundary componentType="BadProps">
        <Boom />
      </ComponentErrorBoundary>
    );
    // Dev shows the Error Details disclosure with the message inside the <pre>.
    expect(screen.getByText(/Error Details/i)).toBeInTheDocument();
    expect(
      screen.getByText(/sensitive-stack-detail-do-not-leak/)
    ).toBeInTheDocument();
  });

  it('logs the error (with component id) via componentDidCatch', () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    render(
      <ComponentErrorBoundary componentType="BadProps" componentId="cid-42">
        <Boom />
      </ComponentErrorBoundary>
    );
    expect(errSpy).toHaveBeenCalled();
    const loggedFirstArgs = errSpy.mock.calls.map((c) => String(c[0]));
    expect(
      loggedFirstArgs.some(
        (m) => m.includes('[ComponentErrorBoundary]') && m.includes('cid-42')
      )
    ).toBe(true);
  });

  it('clears the error state when Retry is pressed (recovers if children no longer throw)', () => {
    // A child that throws once, then renders fine after the boundary resets.
    let shouldThrow = true;
    const Flaky: React.FC = () => {
      if (shouldThrow) throw new Error('first-render-throw');
      return <span data-testid="recovered">recovered</span>;
    };

    render(
      <ComponentErrorBoundary componentType="FlakyProps">
        <Flaky />
      </ComponentErrorBoundary>
    );

    expect(screen.getByText(/Component Error: FlakyProps/i)).toBeInTheDocument();

    // Stop throwing, then click Retry → boundary resets hasError → re-renders child.
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(screen.getByTestId('recovered')).toHaveTextContent('recovered');
    expect(screen.queryByText(/Component Error: FlakyProps/i)).not.toBeInTheDocument();
  });
});
