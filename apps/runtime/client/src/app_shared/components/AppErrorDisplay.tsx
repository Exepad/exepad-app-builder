/**
 * App Error Display Components
 * Unified error UI that adapts to different error types
 */

import React from 'react';
import { Link } from 'react-router';

export type ErrorType = 'config-missing' | 'page-404' | 'runtime-error' | 'network-error' | 'validation-error';

export interface UnifiedErrorProps {
  type: ErrorType;
  title?: string;
  message?: string;
  details?: string;
  appId?: string;
  pageSlug?: string;
  appType?: 'demo' | 'example' | 'production' | 'preview';
  homeUrl?: string;
  showRetry?: boolean;
  onRetry?: () => void;
}

/**
 * Unified Error Display
 * Handles all error types with consistent UX
 */
export function UnifiedErrorDisplay({
  type,
  title,
  message,
  details,
  appId,
  pageSlug,
  appType = 'production',
  homeUrl = '/',
  showRetry = false,
  onRetry,
}: UnifiedErrorProps) {
  // Default titles and messages based on error type
  const defaults = getErrorDefaults(type, { appId, pageSlug, appType });
  const finalTitle = title || defaults.title;
  const finalMessage = message || defaults.message;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
        {/* Error Icon */}
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            {getErrorIcon(type)}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{finalTitle}</h1>
          <p className="text-lg text-gray-600 mt-2">{finalMessage}</p>
        </div>

        {/* Details */}
        {details && (
          <div className="mb-6 p-4 bg-gray-100 rounded-lg">
            <p className="text-sm font-mono text-gray-700 break-all">{details}</p>
          </div>
        )}

        {/* Context information */}
        {(appId || pageSlug) && (
          <div className="mb-6 text-sm text-gray-600 space-y-1">
            {appId && <p><span className="font-semibold">App ID:</span> {appId}</p>}
            {pageSlug && <p><span className="font-semibold">Page:</span> {pageSlug}</p>}
            {appType && <p><span className="font-semibold">Type:</span> {appType}</p>}
          </div>
        )}

        {/* Helpful suggestions */}
        {getSuggestions(type, appType).length > 0 && (
          <div className="mb-6 space-y-2 text-sm text-gray-600">
            <p className="font-semibold">What you can try:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              {getSuggestions(type, appType).map((suggestion, idx) => (
                <li key={idx}>{suggestion}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          {showRetry && onRetry && (
            <button
              onClick={onRetry}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Try Again
            </button>
          )}
          <Link to={homeUrl} className={showRetry ? "flex-1" : "w-full"}>
            <button className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Go Home
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// Helper functions

function getErrorDefaults(
  type: ErrorType,
  context: { appId?: string; pageSlug?: string; appType?: string }
): { title: string; message: string } {
  switch (type) {
    case 'config-missing':
      return {
        title: 'Application Not Found',
        message: `Could not load the configuration for ${context.appType || 'app'}: "${context.appId || 'unknown'}"`,
      };
    case 'page-404':
      return {
        title: '404 - Page Not Found',
        message: `The page "${context.pageSlug || 'unknown'}" does not exist in this ${context.appType || 'app'}.`,
      };
    case 'network-error':
      return {
        title: 'Connection Error',
        message: 'Unable to connect to the server. Please check your internet connection.',
      };
    case 'validation-error':
      return {
        title: 'Configuration Error',
        message: 'The application configuration is invalid or corrupted.',
      };
    case 'runtime-error':
    default:
      return {
        title: 'Something went wrong',
        message: 'An unexpected error occurred while loading the application.',
      };
  }
}

function getErrorIcon(type: ErrorType) {
  const iconClass = "w-8 h-8 text-red-600";

  switch (type) {
    case 'page-404':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'network-error':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
  }
}

function getSuggestions(type: ErrorType, appType?: string): string[] {
  switch (type) {
    case 'config-missing':
      if (appType === 'example' || appType === 'demo') {
        return [
          `Check that the JSON file exists in public/${appType}/`,
          'Verify the file path and app ID are correct',
          'Ensure the JSON file is valid and properly formatted',
        ];
      }
      return [
        'Verify the application exists and is deployed',
        'Check that the app ID is correct',
        'Contact your administrator if the problem persists',
      ];
    case 'page-404':
      return [
        'Check the URL for typos',
        'Verify the page exists in the application',
        'Return to the home page and navigate from there',
      ];
    case 'network-error':
      return [
        'Check your internet connection',
        'Verify the server is running',
        'Try refreshing the page',
        'Check if there are any firewall or proxy issues',
      ];
    case 'validation-error':
      return [
        'Contact your administrator',
        'Check the application logs for details',
        'Try redeploying the application',
      ];
    case 'runtime-error':
    default:
      return [
        'Try refreshing the page',
        'Clear your browser cache',
        'Return to the home page',
      ];
  }
}

// Backwards compatibility exports
interface ConfigErrorProps {
  appId: string;
  message: string;
  details?: string;
}

export function ConfigErrorDisplay({ appId, message, details }: ConfigErrorProps) {
  return (
    <UnifiedErrorDisplay
      type="config-missing"
      message={message}
      details={details}
      appId={appId}
    />
  );
}

interface NotFoundErrorProps {
  pageSlug: string;
  appType?: 'demo' | 'example' | 'production' | 'preview';
}

export function NotFoundErrorDisplay({ pageSlug, appType = 'production' }: NotFoundErrorProps) {
  return (
    <UnifiedErrorDisplay
      type="page-404"
      pageSlug={pageSlug}
      appType={appType}
    />
  );
}
