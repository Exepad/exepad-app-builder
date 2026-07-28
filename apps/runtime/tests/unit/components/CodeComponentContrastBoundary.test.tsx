import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeComponentContrastBoundary } from '@/app_runtime/runtime/components/custom/code/CodeComponentContrastBoundary';

describe('CodeComponentContrastBoundary', () => {
  it('corrects low-contrast rendered text after mount', async () => {
    render(
      <CodeComponentContrastBoundary>
        <div style={{ backgroundColor: '#A8C6C3' }}>
          <p style={{ color: '#ffffff' }}>Unreadable copy</p>
        </div>
      </CodeComponentContrastBoundary>
    );

    const text = screen.getByText('Unreadable copy');

    await waitFor(() => {
      expect(text).toHaveStyle({ color: '#000000' });
    });
    expect(text.dataset.contrastCorrected).toBe('true');
  });

  it('leaves compliant text untouched', async () => {
    render(
      <CodeComponentContrastBoundary>
        <div style={{ backgroundColor: '#ffffff' }}>
          <p style={{ color: '#111827' }}>Readable copy</p>
        </div>
      </CodeComponentContrastBoundary>
    );

    const text = screen.getByText('Readable copy');

    await waitFor(() => {
      expect(text.dataset.contrastCorrected).toBeUndefined();
    });
    expect(text).toHaveStyle({ color: '#111827' });
  });

  it('skips decorative transparent text', async () => {
    render(
      <CodeComponentContrastBoundary>
        <div style={{ backgroundColor: '#ffffff' }}>
          <p className="text-transparent bg-clip-text" style={{ color: 'transparent' }}>
            Decorative text
          </p>
        </div>
      </CodeComponentContrastBoundary>
    );

    const text = screen.getByText('Decorative text');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(text.dataset.contrastCorrected).toBeUndefined();
  });

  it('does NOT force light hero text to black over an absolute <img> backdrop', async () => {
    // Hero pattern: <section relative> contains an absolute-fill image backdrop
    // and a content layer with white text. The corrector would otherwise read
    // the solid page background and flip the white text to black (mr5czdwj).
    render(
      <CodeComponentContrastBoundary>
        <div style={{ backgroundColor: '#ffffff' }}>
          <section style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <img src="hero.webp" alt="hero" style={{ width: '100%', height: '100%' }} />
            </div>
            <div style={{ position: 'relative' }}>
              <h1 style={{ color: '#ffffff' }}>Warmth in Every Crumb</h1>
            </div>
          </section>
        </div>
      </CodeComponentContrastBoundary>
    );

    const heading = screen.getByText('Warmth in Every Crumb');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(heading.dataset.contrastCorrected).toBeUndefined();
    expect(heading).toHaveStyle({ color: '#ffffff' });
  });

  it('does NOT correct text over a CSS background-image ancestor', async () => {
    render(
      <CodeComponentContrastBoundary>
        <div style={{ backgroundColor: '#ffffff' }}>
          <div style={{ backgroundImage: 'url(bg.jpg)' }}>
            <p style={{ color: '#ffffff' }}>Over a photo</p>
          </div>
        </div>
      </CodeComponentContrastBoundary>
    );

    const text = screen.getByText('Over a photo');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(text.dataset.contrastCorrected).toBeUndefined();
    expect(text).toHaveStyle({ color: '#ffffff' });
  });

  it('does NOT force white hero text to black when the IMAGE is a DIRECT absolute child', async () => {
    // Real mr5czdwj /our-story shape: <ExepadImage> renders an <img> that
    // itself carries `absolute inset-0` as a direct child of the hero <section>
    // (no wrapper div). querySelector("img") does not match the element itself,
    // so this shape regressed to black until the guard also checked `matches`.
    render(
      <CodeComponentContrastBoundary>
        <div style={{ backgroundColor: '#ffffff' }}>
          <section style={{ position: 'relative' }}>
            <img
              src="hands.webp"
              alt="kneading"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            <div style={{ position: 'relative' }}>
              <h1 style={{ color: '#ffffff' }}>Three Generations of Baking</h1>
              <p style={{ color: '#ffffff' }}>A legacy of flour, water, and time.</p>
            </div>
          </section>
        </div>
      </CodeComponentContrastBoundary>
    );

    const heading = screen.getByText('Three Generations of Baking');
    const sub = screen.getByText('A legacy of flour, water, and time.');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(heading.dataset.contrastCorrected).toBeUndefined();
    expect(heading).toHaveStyle({ color: '#ffffff' });
    expect(sub).toHaveStyle({ color: '#ffffff' });
  });

  it('does NOT force white hero text to black when the hero section has BOTH an opaque bg AND an image backdrop child', async () => {
    // 5dnxdcpo MainHeader regression: the hero <section> carries an opaque theme
    // bg (`bg-surface` #FFFBEB) AND hosts an absolute-inset <ExepadImage> backdrop
    // as a sibling of the z-10 text. The image paints over the opaque bg and under
    // the text, so the text IS over the image — but the opaque-bg early-return used
    // to fire at the section before the image-fill child was inspected, flipping the
    // white h1 to black. The image-fill check must win at the same element.
    render(
      <CodeComponentContrastBoundary>
        <section style={{ position: 'relative', backgroundColor: '#FFFBEB' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <img
              data-exepad-image="lifestyle product collage"
              src="hero.webp"
              alt="hero"
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <h1 style={{ color: '#ffffff' }}>Find the Products That Define You.</h1>
            <p style={{ color: '#ffffff' }}>Take our quick personality quiz.</p>
          </div>
        </section>
      </CodeComponentContrastBoundary>
    );

    const heading = screen.getByText('Find the Products That Define You.');
    const sub = screen.getByText('Take our quick personality quiz.');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(heading.dataset.contrastCorrected).toBeUndefined();
    expect(heading).toHaveStyle({ color: '#ffffff' });
    expect(sub).toHaveStyle({ color: '#ffffff' });
  });

  it('STILL corrects white text on an element with its own opaque bg over an image', async () => {
    // Real mr5czdwj home "Our Story" CTA: an outline button keeps its own
    // opaque `bg-background` fill (cream) while sitting over the hero image.
    // White text on the cream fill is invisible; because the button has its own
    // opaque background, the corrector must run (not be skipped by the
    // over-image guard) and flip the text to dark.
    render(
      <CodeComponentContrastBoundary>
        <section style={{ position: 'relative' }}>
          <img
            src="hero.webp"
            alt="hero"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <div style={{ position: 'relative' }}>
            <button style={{ backgroundColor: '#fffbeb', color: '#ffffff' }}>Our Story</button>
          </div>
        </section>
      </CodeComponentContrastBoundary>
    );

    const button = screen.getByText('Our Story');
    await waitFor(() => {
      expect(button.dataset.contrastCorrected).toBe('true');
    });
    expect(button).toHaveStyle({ color: '#000000' });
  });

  it('still corrects low-contrast text on a SOLID background (no image)', async () => {
    // Guard must not over-trigger: a plain solid-bg mismatch still gets fixed.
    render(
      <CodeComponentContrastBoundary>
        <section style={{ position: 'relative', backgroundColor: '#A8C6C3' }}>
          <p style={{ color: '#ffffff' }}>Solid bg copy</p>
        </section>
      </CodeComponentContrastBoundary>
    );

    const text = screen.getByText('Solid bg copy');
    await waitFor(() => {
      expect(text.dataset.contrastCorrected).toBe('true');
    });
    expect(text).toHaveStyle({ color: '#000000' });
  });

  it('adds hover correction for derivable hover backgrounds', async () => {
    render(
      <CodeComponentContrastBoundary>
        <button className="hover:bg-[#A8C6C3]" style={{ backgroundColor: '#111827', color: '#ffffff' }}>
          Hover me
        </button>
      </CodeComponentContrastBoundary>
    );

    const button = screen.getByText('Hover me');

    await waitFor(() => {
      expect(button.dataset.contrastHoverId).toBeTruthy();
    });
    expect(document.head.textContent).toContain('[data-contrast-hover-id=');
    expect(document.head.textContent).toContain('#000000');
  });
});
