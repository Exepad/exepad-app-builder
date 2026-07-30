import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useBrokenImageFallback } from '@/hooks/useBrokenImageFallback';

function Harness() {
  useBrokenImageFallback();
  return (
    <div>
      <img data-testid="content" src="https://images.unsplash.com/photo-dead" alt="x" />
      <img data-testid="optout" data-no-fallback src="https://images.unsplash.com/photo-2" alt="y" />
    </div>
  );
}

/** Fire a capture-phase 'error' on an element (img error does not bubble). */
function fireImgError(el: Element) {
  el.dispatchEvent(new Event('error', { bubbles: false }));
}

describe('useBrokenImageFallback', () => {
  it('swaps a broken content <img> to a neutral data: placeholder', () => {
    const { getByTestId } = render(<Harness />);
    const img = getByTestId('content') as HTMLImageElement;
    expect(img.src).toContain('images.unsplash.com');

    fireImgError(img);

    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('respects data-no-fallback opt-out', () => {
    const { getByTestId } = render(<Harness />);
    const img = getByTestId('optout') as HTMLImageElement;

    fireImgError(img);

    expect(img.src).toContain('images.unsplash.com');
    expect(img.src.startsWith('data:')).toBe(false);
  });

  it('is loop-safe: an error on the data: fallback is ignored', () => {
    const { getByTestId } = render(<Harness />);
    const img = getByTestId('content') as HTMLImageElement;

    fireImgError(img);
    const afterFirst = img.src;
    // Simulate the fallback itself erroring — must not re-process.
    fireImgError(img);

    expect(img.src).toBe(afterFirst);
  });

  it('ignores non-img error events', () => {
    const { container } = render(<Harness />);
    const div = container.querySelector('div')!;
    // Should not throw / mutate anything.
    expect(() => fireImgError(div)).not.toThrow();
  });
});
