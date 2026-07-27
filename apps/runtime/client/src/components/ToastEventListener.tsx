
/**
 * ToastEventListener
 * 
 * Bridges the gap between the action system's custom events and the toast UI.
 * Listens for 'exepad:toast' events dispatched by actionExecutor and triggers
 * actual toast notifications via the useToast hook.
 */

import { useEffect } from 'react';
import { toast } from '@/runtime/hooks/use-toast';

interface ToastEventDetail {
  message: string;
  type?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive';
  duration?: number;
}

export function ToastEventListener() {
  useEffect(() => {
    const handleShowToast = (event: Event) => {
      const customEvent = event as CustomEvent<ToastEventDetail>;
      const { message, type = 'default', duration = 5000 } = customEvent.detail;
      
      // Map action types to toast variants
      const variantMap: Record<string, 'default' | 'destructive'> = {
        default: 'default',
        success: 'default',
        info: 'default',
        warning: 'default',
        error: 'destructive',
        destructive: 'destructive',
      };
      
      // Map types to title prefixes for better UX
      const titleMap: Record<string, string> = {
        default: '',
        success: '✓ Success',
        info: 'ℹ Info',
        warning: '⚠ Warning',
        error: '✗ Error',
        destructive: '✗ Error',
      };
      
      const variant = variantMap[type] || 'default';
      const title = titleMap[type] || '';
      
      toast({
        title: title || undefined,
        description: message,
        variant,
        duration,
      });
    };
    
    window.addEventListener('exepad:toast', handleShowToast);
    
    return () => {
      window.removeEventListener('exepad:toast', handleShowToast);
    };
  }, []);
  
  // This component doesn't render anything - it just sets up the event listener
  return null;
}

export default ToastEventListener;
