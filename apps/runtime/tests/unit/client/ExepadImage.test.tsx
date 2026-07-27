import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
// Import the SDK component source directly (the SDK has no own test runner;
// the runtime's vite transform handles the TSX).
import { ExepadImage } from '../../../../../packages/exepad-sdk/src/components/ExepadImage';

describe('ExepadImage', () => {
  it('renders an <img> for a resolved src', () => {
    const { getByRole } = render(<ExepadImage keywords="dog" src="https://x.test/a.jpg" />);
    expect((getByRole('img') as HTMLImageElement).getAttribute('src')).toBe('https://x.test/a.jpg');
  });

  it('falls back to the skeleton on load error (no broken-image glyph)', () => {
    const { queryByRole, container } = render(
      <ExepadImage keywords="team" src="https://x.test/dead.jpg" width={400} height={300} />,
    );
    const img = queryByRole('img') as HTMLImageElement;
    fireEvent.error(img);

    expect(queryByRole('img')).toBeNull();
    const skeleton = container.querySelector('[data-exepad-image="team"]') as HTMLElement;
    expect(skeleton).not.toBeNull();
    expect(skeleton.style.aspectRatio).toBe('400 / 300');
  });

  it('re-attempts when the src prop changes after a failure (A5 reset)', () => {
    const { queryByRole, rerender } = render(
      <ExepadImage keywords="row" src="https://x.test/dead.jpg" />,
    );
    fireEvent.error(queryByRole('img') as HTMLImageElement);
    expect(queryByRole('img')).toBeNull(); // stuck-skeleton if not reset

    // Same component identity, new working src — must render an <img> again.
    rerender(<ExepadImage keywords="row" src="https://x.test/good.jpg" />);
    const img = queryByRole('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://x.test/good.jpg');
  });
});
