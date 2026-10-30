import React from 'react';

interface SparklineProps {
  data: number[]; // Array of values from 0 to 100
  width?: number;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 100,
  height = 30,
  strokeColor = '#3b82f6',
  fillColor = 'rgba(59, 130, 246, 0.2)',
  className = ''
}) => {
  if (!data || data.length === 0) {
    return <div className={`w-full h-full min-h-[30px] flex items-center justify-center text-xs text-muted-foreground ${className}`}>No data</div>;
  }

  // Normalize data to fit exactly in the width and height
  // X values will be spaced evenly across `width`
  // Y values are mapped such that 100% = 0 (top of SVG), 0% = height (bottom)

  // Calculate points
  const points = data.map((val, i) => {
    // If we have fewer than maxPoints, we still want to draw them starting from the left
    // or starting from the right. A typical sparkline pushes old data to the left.
    // Let's assume the array is ordered [oldest, ..., newest]
    // We map X across the entire width, based on maxPoints so it "fills" up over time
    const x = (i / (Math.max(data.length - 1, 1))) * width; 
    
    // Invert Y axis: a high percentage means a low Y coordinate (closer to top)
    const y = height - (Math.min(Math.max(val, 0), 100) / 100) * height;
    
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(' L ')}`;
  
  // For the filled area, close the path at the bottom corners
  const fillPathD = `M ${points[0].split(',')[0]},${height} L ${points.join(' L ')} L ${points[points.length - 1].split(',')[0]},${height} Z`;

  return (
    <svg 
      className={`block overflow-visible ${className}`} 
      viewBox={`0 0 ${width} ${height}`} 
      preserveAspectRatio="none"
      width="100%" 
      height="100%"
    >
      <path
        d={fillPathD}
        fill={fillColor}
        stroke="none"
      />
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
