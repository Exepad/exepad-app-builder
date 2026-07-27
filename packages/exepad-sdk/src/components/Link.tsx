/**
 * Link — Client-side navigation anchor for Code Focus apps.
 *
 * Renders ``<a href>`` with the basePath-prefixed URL so crawlers, modifier
 * clicks (Ctrl/Cmd/middle — "Open in new tab"), and "Copy link" all produce
 * a working absolute URL. Left-click is intercepted and routed through
 * ``navigate()`` so SPA transitions skip a full page load.
 *
 * Pass ``to`` as an app-internal path (leading slash, relative to the app
 * root): ``to="/contact"``, not ``to="contact"``. The component prepends the
 * app's basePath (e.g. ``/a/preview-ynkeso1w``).
 */

import { React } from '../core';
import { navigate, resolveAppPath } from '../platform/useNavigation';

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Target path — absolute within the app (leading slash). */
  to: string;
}

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const href = resolveAppPath(to);
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
