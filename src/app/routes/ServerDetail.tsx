import React from 'react';
import { useParams } from 'react-router-dom';
import { TerminalTabManager } from '@/features/terminal/components/TerminalTabManager';

export const ServerDetail = () => {
  const { id } = useParams();

  if (!id) return null;

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      <div className="flex-1 min-w-0">
        <TerminalTabManager serverId={id} />
      </div>
    </div>
  );
};
