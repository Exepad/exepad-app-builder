/**
 * use-toast Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast, reducer, toast } from '@/app_runtime/runtime/hooks/use-toast';

describe('use-toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('reducer', () => {
    describe('ADD_TOAST', () => {
      it('should add a toast to the state', () => {
        const initialState = { toasts: [] };
        const newToast = { id: '1', title: 'Test Toast' };
        
        const result = reducer(initialState, {
          type: 'ADD_TOAST',
          toast: newToast,
        });
        
        expect(result.toasts).toHaveLength(1);
        expect(result.toasts[0]).toEqual(newToast);
      });

      it('should prepend new toast to existing toasts', () => {
        const existingToast = { id: '1', title: 'Existing' };
        const initialState = { toasts: [existingToast] };
        const newToast = { id: '2', title: 'New Toast' };
        
        const result = reducer(initialState, {
          type: 'ADD_TOAST',
          toast: newToast,
        });
        
        expect(result.toasts[0]).toEqual(newToast);
      });

      it('should respect TOAST_LIMIT', () => {
        // TOAST_LIMIT is 1
        const existingToast = { id: '1', title: 'Existing' };
        const initialState = { toasts: [existingToast] };
        const newToast = { id: '2', title: 'New Toast' };
        
        const result = reducer(initialState, {
          type: 'ADD_TOAST',
          toast: newToast,
        });
        
        expect(result.toasts).toHaveLength(1);
        expect(result.toasts[0]).toEqual(newToast);
      });
    });

    describe('UPDATE_TOAST', () => {
      it('should update a specific toast', () => {
        const toast1 = { id: '1', title: 'Original' };
        const initialState = { toasts: [toast1] };
        
        const result = reducer(initialState, {
          type: 'UPDATE_TOAST',
          toast: { id: '1', title: 'Updated' },
        });
        
        expect(result.toasts[0].title).toBe('Updated');
      });

      it('should not update other toasts', () => {
        const toast1 = { id: '1', title: 'Toast 1' };
        const toast2 = { id: '2', title: 'Toast 2' };
        const initialState = { toasts: [toast1, toast2] };
        
        const result = reducer(initialState, {
          type: 'UPDATE_TOAST',
          toast: { id: '1', title: 'Updated' },
        });
        
        expect(result.toasts[1].title).toBe('Toast 2');
      });
    });

    describe('DISMISS_TOAST', () => {
      it('should set open to false for specific toast', () => {
        const toast1 = { id: '1', title: 'Toast', open: true };
        const initialState = { toasts: [toast1] };
        
        const result = reducer(initialState, {
          type: 'DISMISS_TOAST',
          toastId: '1',
        });
        
        expect(result.toasts[0].open).toBe(false);
      });

      it('should dismiss all toasts when no toastId provided', () => {
        const toast1 = { id: '1', title: 'Toast 1', open: true };
        const toast2 = { id: '2', title: 'Toast 2', open: true };
        const initialState = { toasts: [toast1, toast2] };
        
        const result = reducer(initialState, {
          type: 'DISMISS_TOAST',
        });
        
        expect(result.toasts.every(t => t.open === false)).toBe(true);
      });
    });

    describe('REMOVE_TOAST', () => {
      it('should remove a specific toast', () => {
        const toast1 = { id: '1', title: 'Toast 1' };
        const toast2 = { id: '2', title: 'Toast 2' };
        const initialState = { toasts: [toast1, toast2] };
        
        const result = reducer(initialState, {
          type: 'REMOVE_TOAST',
          toastId: '1',
        });
        
        expect(result.toasts).toHaveLength(1);
        expect(result.toasts[0].id).toBe('2');
      });

      it('should remove all toasts when no toastId provided', () => {
        const toast1 = { id: '1', title: 'Toast 1' };
        const toast2 = { id: '2', title: 'Toast 2' };
        const initialState = { toasts: [toast1, toast2] };
        
        const result = reducer(initialState, {
          type: 'REMOVE_TOAST',
        });
        
        expect(result.toasts).toHaveLength(0);
      });
    });
  });

  describe('useToast hook', () => {
    it('should return toasts array', () => {
      const { result } = renderHook(() => useToast());
      
      expect(result.current.toasts).toBeDefined();
      expect(Array.isArray(result.current.toasts)).toBe(true);
    });

    it('should return toast function', () => {
      const { result } = renderHook(() => useToast());
      
      expect(typeof result.current.toast).toBe('function');
    });

    it('should return dismiss function', () => {
      const { result } = renderHook(() => useToast());
      
      expect(typeof result.current.dismiss).toBe('function');
    });
  });

  describe('toast function', () => {
    it('should create toast and return control object', () => {
      const { result } = renderHook(() => useToast());
      
      let toastResult: { id: string; dismiss: () => void; update: Function };
      
      act(() => {
        toastResult = result.current.toast({
          title: 'Test Toast',
          description: 'Test description',
        });
      });
      
      expect(toastResult!.id).toBeDefined();
      expect(typeof toastResult!.dismiss).toBe('function');
      expect(typeof toastResult!.update).toBe('function');
    });

    it('should add toast to state', () => {
      const { result } = renderHook(() => useToast());
      
      act(() => {
        result.current.toast({
          title: 'Test Toast',
        });
      });
      
      expect(result.current.toasts.length).toBeGreaterThan(0);
    });

    it('should generate unique IDs for toasts', () => {
      const { result } = renderHook(() => useToast());
      
      let id1: string, id2: string;
      
      act(() => {
        const toast1 = result.current.toast({ title: 'Toast 1' });
        id1 = toast1.id;
      });
      
      act(() => {
        const toast2 = result.current.toast({ title: 'Toast 2' });
        id2 = toast2.id;
      });
      
      expect(id1!).not.toBe(id2!);
    });
  });

  describe('dismiss', () => {
    it('should dismiss specific toast', () => {
      const { result } = renderHook(() => useToast());
      
      let toastId: string;
      
      act(() => {
        const toastResult = result.current.toast({ title: 'Test' });
        toastId = toastResult.id;
      });
      
      act(() => {
        result.current.dismiss(toastId);
      });
      
      const dismissedToast = result.current.toasts.find(t => t.id === toastId);
      expect(dismissedToast?.open).toBe(false);
    });
  });

  describe('update', () => {
    it('should update toast properties', () => {
      const { result } = renderHook(() => useToast());
      
      let toastControl: { update: Function; id: string };
      
      act(() => {
        toastControl = result.current.toast({ title: 'Original' });
      });
      
      act(() => {
        toastControl!.update({ title: 'Updated', id: toastControl.id });
      });
      
      const updatedToast = result.current.toasts.find(t => t.id === toastControl.id);
      expect(updatedToast?.title).toBe('Updated');
    });
  });

  describe('standalone toast function', () => {
    it('should work as standalone function', () => {
      let toastResult: { id: string };
      
      act(() => {
        toastResult = toast({ title: 'Standalone Toast' });
      });
      
      expect(toastResult!.id).toBeDefined();
    });
  });
});
