import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { onHealthChange, checkServerHealth } from '../lib/serverHealth';

/**
 * Server Status Indicator Component
 * Shows a banner when the backend server is not running
 */
export function ServerStatusIndicator() {
  const [isHealthy, setIsHealthy] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    // Initial check
    checkServerHealth().then(setIsHealthy);
    
    // Subscribe to health changes
    const unsubscribe = onHealthChange((healthy) => {
      setIsHealthy(healthy);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleRetry = async () => {
    setIsChecking(true);
    const healthy = await checkServerHealth();
    setIsHealthy(healthy);
    setIsChecking(false);
  };

  if (isHealthy) {
    return null; // Don't show anything when server is healthy
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Backend Server Not Running</p>
              <p className="text-sm text-red-100">
                The application cannot connect to the backend server. Please start the server.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRetry}
              disabled={isChecking}
              className="px-4 py-2 bg-white text-red-600 rounded-md font-medium hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isChecking ? 'Checking...' : 'Retry'}
            </button>
            <div className="text-sm">
              <p className="font-medium">Quick Start:</p>
              <p className="text-red-100">
                <code className="bg-red-700 px-2 py-1 rounded">cd server && npm run dev</code>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
