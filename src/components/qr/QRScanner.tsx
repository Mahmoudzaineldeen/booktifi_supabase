import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, CameraOff, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (error: string) => void;
  onClose: () => void;
  title?: string;
  showManualInput?: boolean;
  onManualInput?: (value: string) => void;
}

export function QRScanner({
  onScanSuccess,
  onScanError,
  onClose,
  title = 'Scan QR Code',
  showManualInput = true,
  onManualInput,
}: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraPermission, setCameraPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [manualInput, setManualInput] = useState('');
  const videoElementId = 'qr-scanner-video';

  useEffect(() => {
    startScanning();
    return () => {
      stopScanning();
    };
  }, []);

  const startScanning = async () => {
    try {
      setError(null);
      setIsScanning(true);

      const html5QrCode = new Html5Qrcode(videoElementId);
      scannerRef.current = html5QrCode;

      // Try to get camera permissions first
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices.length === 0) {
          throw new Error('No cameras found');
        }

        // Use back camera if available, otherwise use first camera
        const backCamera = devices.find(device => 
          device.label.toLowerCase().includes('back') || 
          device.label.toLowerCase().includes('rear') ||
          device.label.toLowerCase().includes('environment')
        );
        const cameraId = backCamera?.id || devices[0].id;

        await html5QrCode.start(
          cameraId,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            // Success callback
            onScanSuccess(decodedText);
            stopScanning();
          },
          (errorMessage) => {
            // Error callback - ignore most errors (they're just "no QR found" messages)
            if (errorMessage && !errorMessage.includes('No QR code found')) {
              console.log('QR scan error:', errorMessage);
            }
          }
        );

        setCameraPermission('granted');
      } catch (err: any) {
        console.error('Camera access error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraPermission('denied');
          setError('Camera permission denied. Please allow camera access to scan QR codes.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('No camera found. Please connect a camera or use manual input.');
        } else {
          setError(err.message || 'Failed to start camera');
        }
        setIsScanning(false);
        if (onScanError) {
          onScanError(err.message || 'Failed to start camera');
        }
      }
    } catch (err: any) {
      console.error('QR scanner initialization error:', err);
      setError(err.message || 'Failed to initialize QR scanner');
      setIsScanning(false);
      if (onScanError) {
        onScanError(err.message || 'Failed to initialize QR scanner');
      }
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current = null;
          setIsScanning(false);
        })
        .catch((err) => {
          console.error('Error stopping scanner:', err);
          scannerRef.current = null;
          setIsScanning(false);
        });
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim() && onManualInput) {
      onManualInput(manualInput.trim());
      setManualInput('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={() => {
              stopScanning();
              onClose();
            }}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scanner Area */}
        <div className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800">{error}</p>
                {cameraPermission === 'denied' && (
                  <p className="text-xs text-red-600 mt-1">
                    Please enable camera permissions in your browser settings and try again.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Video Element */}
          <div className="relative bg-black rounded-lg overflow-hidden mb-4" style={{ minHeight: '300px' }}>
            <div id={videoElementId} className="w-full h-full" />
            {!isScanning && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="text-center text-white">
                  <CameraOff className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Camera not active</p>
                </div>
              </div>
            )}
            {isScanning && (
              <div className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center gap-1">
                <Camera className="w-3 h-3" />
                Scanning...
              </div>
            )}
          </div>

          {/* Manual Input (if enabled) */}
          {showManualInput && (
            <form onSubmit={handleManualSubmit} className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Or enter booking ID manually:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Enter booking ID"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  type="submit"
                  disabled={!manualInput.trim()}
                  size="sm"
                >
                  Submit
                </Button>
              </div>
            </form>
          )}

          {/* Instructions */}
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-800">
              {isScanning
                ? 'Point your camera at the QR code on the ticket'
                : 'Click "Start Camera" to begin scanning'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t">
          {!isScanning && !error && (
            <Button
              onClick={startScanning}
              fullWidth
              variant="primary"
            >
              <Camera className="w-4 h-4 mr-2" />
              Start Camera
            </Button>
          )}
          <Button
            onClick={() => {
              stopScanning();
              onClose();
            }}
            fullWidth
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
