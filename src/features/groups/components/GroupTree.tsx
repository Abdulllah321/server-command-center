import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Server } from 'lucide-react';
import { toast } from 'sonner';
import { showIpcError } from '@/lib/error-handler';
import type { ServerGroupTree } from '@/lib/tauri-client';
import { useGroups, useAddServerToGroup } from '../api';
import { Badge } from '@/components/ui/badge';
import { listServers } from '@/lib/tauri-client';
import { useQuery } from '@tanstack/react-query';

interface GroupNodeProps {
  group: ServerGroupTree;
  level: number;
}

const GroupNode = ({ group, level }: GroupNodeProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const navigate = useNavigate();
  const addServerMutation = useAddServerToGroup();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'server' && data.id) {
        await addServerMutation.mutateAsync({ groupId: group.id, serverId: data.id });
        toast.success(`Server added to ${group.name}`);
      }
    } catch (err: any) {
      showIpcError(err, { action: `Add Server to ${group.name}` });
    }
  };

  return (
    <div className="flex flex-col">
      <div 
        className={`flex items-center group py-1.5 px-2 rounded-md transition-colors cursor-pointer text-sm
          ${isDragOver ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'}
        `}
        style={{ paddingLeft: `${(level * 12) + 8}px` }}
        onClick={() => navigate(`/group/${group.id}`)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <button 
          className="p-0.5 hover:bg-muted rounded mr-1 opacity-70 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
        >
          {(group.children.length > 0 || group.server_ids.length > 0) ? (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <div className="w-3.5 h-3.5" /> // spacer
          )}
        </button>
        {isExpanded ? <FolderOpen className="w-4 h-4 mr-2 text-primary/70" /> : <Folder className="w-4 h-4 mr-2 text-muted-foreground" />}
        <span className="truncate flex-1">{group.name}</span>
        {group.server_ids.length > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-[20px] justify-center ml-2">
            {group.server_ids.length}
          </Badge>
        )}
      </div>

      {isExpanded && (
        <div className="flex flex-col">
          {group.children.map(child => (
            <GroupNode key={child.id} group={child} level={level + 1} />
          ))}
          <ServerMembers groupId={group.id} serverIds={group.server_ids} level={level + 1} />
        </div>
      )}
    </div>
  );
};

const ServerMembers = ({ groupId, serverIds, level }: { groupId: string, serverIds: string[], level: number }) => {
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const navigate = useNavigate();

  if (!servers || serverIds.length === 0) return null;

  return (
    <>
      {serverIds.map(sid => {
        const server = servers.find(s => s.id === sid);
        if (!server) return null;
        
        return (
          <div 
            key={`${groupId}-${sid}`}
            className="flex items-center py-1.5 px-2 rounded-md transition-colors cursor-pointer text-sm hover:bg-accent text-muted-foreground"
            style={{ paddingLeft: `${(level * 12) + 24}px` }}
            onClick={() => navigate(`/server/${sid}`)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/json', JSON.stringify({ type: 'server', id: sid }));
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
          >
            <Server className="w-3.5 h-3.5 mr-2 opacity-70" />
            <span className="truncate">{server.name}</span>
          </div>
        );
      })}
    </>
  );
};

export const GroupTree = () => {
  const { data: groups, isLoading } = useGroups();

  if (isLoading) {
    return <div className="px-4 py-2 text-xs text-muted-foreground animate-pulse">Loading groups...</div>;
  }

  if (!groups || groups.length === 0) {
    return <div className="px-4 py-2 text-xs text-muted-foreground">No groups found.</div>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {groups.map(group => (
        <GroupNode key={group.id} group={group} level={0} />
      ))}
    </div>
  );
};
