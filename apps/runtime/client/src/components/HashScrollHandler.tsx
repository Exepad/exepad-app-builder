import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * Handles scrolling to hash anchors on navigation and initial load.
 * This component solves the issue where anchor links (#section-id) don't scroll
 * to the correct section in SPAs with page transitions or async content.
 */
export function HashScrollHandler() {
  const { pathname } = useLocation();
  const observerRef = useRef<MutationObserver | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToHash = (hash: string) => {
    const id = hash.substring(1);
    const element = document.getElementById(id);

    if (element) {
      // Element found immediately
      // Small delay to ensure layout is stable (e.g. after transition)
      setTimeout(() => {
        element.scrollIntoView({ 
          behavior: 'smooth',
          block: 'start'
        });
      }, 100);
      return true;
    }
    return false;
  };

  const observeAndScroll = (hash: string) => {
    // cleanup previous observers
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Try immediately
    if (scrollToHash(hash)) return;

    // If not found, observe DOM changes
    const observer = new MutationObserver((mutations, obs) => {
      if (scrollToHash(hash)) {
        obs.disconnect();
        observerRef.current = null;
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id']
    });

    observerRef.current = observer;

    // Stop observing after 3 seconds to save resources
    timeoutRef.current = setTimeout(() => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    }, 3000);
  };

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      observeAndScroll(hash);
    }
    
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [pathname]); // Re-run when pathname changes

  // Also listen for hash changes within the same page
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash) {
        observeAndScroll(hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return null;
}
