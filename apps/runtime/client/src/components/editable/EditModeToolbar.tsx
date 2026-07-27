
import React from 'react';
import { useEditMode } from '@/context/EditModeContext';

export function EditModeToolbar() {
  const {
    isEditMode,
    saveChanges,
    hasUnsavedChanges
  } = useEditMode();

  // Hide toolbar completely - save commands come through websocket
  return null;
}

export default EditModeToolbar;
