import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  amplitude: number; // 0 to 1 (or higher)
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, amplitude }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  
  // Smooth the amplitude for visual pleasantness
  const smoothedAmplitude = useRef(0);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Smooth transition
    smoothedAmplitude.current += (amplitude - smoothedAmplitude.current) * 0.2;
    
    // Base radius + amplitude effect
    const baseRadius = 50;
    const maxRadius = 100;
    const radius = baseRadius + (smoothedAmplitude.current * (maxRadius - baseRadius));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    if (isActive) {
        // Outer glow
        const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius, centerX, centerY, radius * 1.5);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.8)'); // Indigo 500
        gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.4)'); // Purple 500
        gradient.addColorStop(1, 'rgba(168, 85, 247, 0)');

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 1.2, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Core circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, Math.max(baseRadius, radius), 0, 2 * Math.PI);
        ctx.fillStyle = '#6366f1';
        ctx.fill();
        
        // Inner ripple lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, Math.max(baseRadius * 0.5, radius * 0.6), 0, 2 * Math.PI);
        ctx.stroke();

    } else {
        // Idle State
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#334155'; // Slate 700
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    requestRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(draw);
    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isActive, amplitude]);

  return (
    <canvas 
        ref={canvasRef} 
        width={300} 
        height={300} 
        className="w-64 h-64 md:w-80 md:h-80 mx-auto"
    />
  );
};

export default AudioVisualizer;