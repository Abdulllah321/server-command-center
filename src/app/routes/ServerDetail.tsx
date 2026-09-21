import React from 'react';
import { useParams } from 'react-router-dom';

export const ServerDetail = () => {
  const { id } = useParams();

  return (
    <div className="flex-1 p-8">
      <h1 className="text-3xl font-bold tracking-tight mb-4">Server Detail</h1>
      <p className="text-muted-foreground">Details for server: {id} — coming in Phase 1</p>
    </div>
  );
};
