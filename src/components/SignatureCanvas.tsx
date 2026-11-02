import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenTool } from 'lucide-react';

interface SignatureCanvasProps {
  label?: string;
  required?: boolean;
  value: string;
  onChange: (pngDataUrl: string) => void;
}

export const SignatureCanvas: React.FC<SignatureCanvasProps> = ({
  label = 'Canvas Tanda Tangan Penerima',
  required = false,
  value,
  onChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const [hasStroke, setHasStroke] = useState<boolean>(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 420;
    const height = 160;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.scale(ratio, ratio);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
  }, []);

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasStroke) setHasStroke(true);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width || 420, 160);
    setHasStroke(false);
    onChange('');
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <PenTool className="h-3.5 w-3.5 text-slate-500" />
          <span>
            {label} {required && <span className="text-red-600">*</span>}
          </span>
        </label>
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <Eraser className="h-3.5 w-3.5" />
          Bersihkan TTD
        </button>
      </div>

      <div className="relative mt-1.5 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xs">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="block h-40 w-full cursor-crosshair touch-none"
        />
        {!hasStroke && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-slate-400">
            Tanda tangani di area ini menggunakan jari atau stylus
          </div>
        )}
      </div>
    </div>
  );
};
