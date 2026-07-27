// src/context/AppContext.tsx

import { createContext, useContext, ReactNode } from 'react';

// Define the shape of the context data
interface AppContextProps {
  basePath: string;
  currentPageSlug?: string;
  currentPageUuid?: string;
  mode?: 'preview' | 'published';
}

// Create the context with an undefined default value
const AppContext = createContext<AppContextProps | undefined>(undefined);

/**
 * The provider component that will wrap your application.
 * It takes the basePath as a prop and makes it available to all children.
 */
export const AppContextProvider = ({ 
  children, 
  basePath, 
  currentPageSlug,
  currentPageUuid,
  mode
}: { 
  children: ReactNode; 
  basePath: string; 
  currentPageSlug?: string;
  currentPageUuid?: string;
  mode?: 'preview' | 'published';
}) => {
  return (
    <AppContext.Provider value={{ basePath, currentPageSlug, currentPageUuid, mode }}>
      {children}
    </AppContext.Provider>
  );
};
/**
 * A custom hook to easily access the app context.
 * This will be used by your components (like the Navbar) to get the basePath.
 */
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    // This error is thrown if a component tries to use the context
    // without being wrapped in the provider.
    throw new Error('useAppContext must be used within an AppContextProvider');
  }
  return context;
};

