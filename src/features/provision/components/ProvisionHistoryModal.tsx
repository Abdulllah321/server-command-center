import React, { useState, useEffect } from 'react';
import { 
  History, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Copy, 
  ChevronRight, 
  ChevronDown,
  Terminal,
  Loader2
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getProvisionHistory } from '@/lib/tauri-client';
import type { ProvisionRecord } from '@/types';

interface ProvisionHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId?: string;
}

export const ProvisionHistoryModal: React.FC<ProvisionHistoryModalProps> = ({
  open,
  onOpenChange,
  serverId,
}) => {
  const [records, setRecords] = useState<ProvisionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open, serverId]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const res = await getProvisionHistory(serverId);
      setRecords(res);
      if (res.length > 0 && !expandedId) {
        setExpandedId(res[0].id);
      }
    } catch (err: any) {
      toast.error('Failed to load provisioning history');
    } finally {
      setLoading(false);
    }
  };

  const copyLogs = (logs: string) => {
    navigator.clipboard.writeText(logs);
    toast.success('Logs copied to clipboard');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-card border-border shadow-2xl">
        <DialogHeader className="p-5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <History className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Server Provisioning History
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Audit logs and terminal outputs from past server bootstrap sequences.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs">Loading provisioning history...</span>
            </div>
          ) : records.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-border rounded-2xl bg-muted/20">
              <Terminal className="w-8 h-8 text-muted-foreground/60 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No provisioning history found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Servers provisioned via the Setup Wizard will have their complete execution logs archived here.
              </p>
            </div>
          ) : (
            records.map(record => {
              const isExpanded = expandedId === record.id;
              const isSuccess = record.status === 'success';
              const isAborted = record.status === 'aborted';

              return (
                <div
                  key={record.id}
                  className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs transition-all"
                >
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : record.id)}
                    className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isSuccess ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : isAborted ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-destructive shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground">
                            {record.server_name || 'Host Instance'}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase font-mono px-1.5 py-0 ${
                              isSuccess
                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                : isAborted
                                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                : 'bg-destructive/10 text-destructive border-destructive/20'
                            }`}
                          >
                            {record.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                          <Clock className="w-3 h-3" />
                          <span>Started: {record.started_at}</span>
                          {record.completed_at && (
                            <span>• Finished: {record.completed_at}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyLogs(record.logs);
                        }}
                        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="w-3 h-3 mr-1" />
                        Copy
                      </Button>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-3.5 bg-[#0a0d12] border-t border-border/60">
                      <div className="rounded-xl bg-[#0e1218] p-3 max-h-[300px] overflow-y-auto font-mono text-[11px] text-emerald-400/90 whitespace-pre-wrap select-text leading-relaxed">
                        {record.logs || '(No execution output recorded)'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
