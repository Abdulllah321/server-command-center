import { useState, useEffect, useMemo, type MouseEvent } from 'react';
import { 
  type Command, 
  listCommands, 
  createCommand, 
  deleteCommand, 
  resetDefaultCommands,
  runServerCommand, 
  requestConfirmation,
  type CommandOutput 
} from '@/lib/tauri-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  Settings2, 
  Trash2, 
  ShieldAlert, 
  Play, 
  RotateCcw, 
  Copy, 
  Check, 
  Terminal, 
  Loader2, 
  Sparkles,
  Command as CommandIcon
} from 'lucide-react';
import {
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter, 
  DialogTrigger
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { showIpcError } from '@/lib/error-handler';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ansiToHtml } from '@/features/logs/utils/log-beautifier';

interface QuickActionsGridProps {
  serverId: string;
}

export const QuickActionsGrid = ({ serverId }: QuickActionsGridProps) => {
  const [commands, setCommands] = useState<Command[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [commandStr, setCommandStr] = useState('');
  const [category, setCategory] = useState('Custom');
  const [icon, setIcon] = useState('⚡');
  const [isDestructive, setIsDestructive] = useState(false);

  // Exec State
  const [executingCmdId, setExecutingCmdId] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<{ cmdName: string; cmdText: string; output: CommandOutput } | null>(null);
  const [copiedOutput, setCopiedOutput] = useState(false);

  // Confirmation State for destructive actions
  const [pendingDestructiveCmd, setPendingDestructiveCmd] = useState<Command | null>(null);

  const loadCommands = async () => {
    try {
      let cmds = await listCommands(serverId);
      // Auto-provision default commands if table has 0 actions
      if (cmds.length === 0) {
        try {
          await resetDefaultCommands();
          cmds = await listCommands(serverId);
        } catch (seedErr) {
          console.warn('Auto-seed default commands error:', seedErr);
        }
      }
      setCommands(cmds);
    } catch (e: any) {
      showIpcError(e, { action: 'Load Quick Actions' });
    }
  };

  useEffect(() => {
    loadCommands();
  }, [serverId]);

  const handleResetDefaults = async () => {
    setIsResetting(true);
    try {
      await resetDefaultCommands();
      await loadCommands();
      toast.success('Default quick actions library restored!');
    } catch (e) {
      showIpcError(e, { action: 'Restore Default Actions' });
    } finally {
      setIsResetting(false);
    }
  };

  const handleCreateCommand = async () => {
    if (!name.trim() || !commandStr.trim()) {
      toast.error('Please enter action name and command text');
      return;
    }
    try {
      await createCommand({
        server_id: serverId,
        name: name.trim(),
        command: commandStr.trim(),
        category: category.trim() || 'Custom',
        icon: icon.trim() || '⚡',
        is_destructive: isDestructive,
      });
      setIsFormOpen(false);
      setName('');
      setCommandStr('');
      setCategory('Custom');
      setIcon('⚡');
      setIsDestructive(false);
      await loadCommands();
      toast.success('Quick action created');
    } catch (e) {
      showIpcError(e, { action: 'Create Quick Action' });
    }
  };

  const handleDelete = async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteCommand(id);
      await loadCommands();
      toast.success('Action removed from grid');
    } catch (err) {
      showIpcError(err, { action: 'Delete Quick Action' });
    }
  };

  const executeAction = async (cmd: Command, confirmationToken?: string) => {
    try {
      setExecutingCmdId(cmd.id);
      const output = await runServerCommand(serverId, cmd.command, cmd.name, confirmationToken);
      setExecResult({ cmdName: cmd.name, cmdText: cmd.command, output });
    } catch (e: any) {
      showIpcError(e, { action: `Execute '${cmd.name}'` });
    } finally {
      setExecutingCmdId(null);
    }
  };

  const handleActionClick = async (cmd: Command) => {
    if (isEditMode || executingCmdId) return;

    if (cmd.is_destructive) {
      setPendingDestructiveCmd(cmd);
      return;
    }

    await executeAction(cmd);
  };

  const handleConfirmDestructive = async () => {
    if (!pendingDestructiveCmd) return;
    const cmd = pendingDestructiveCmd;
    setPendingDestructiveCmd(null);

    try {
      const token = await requestConfirmation(`Run destructive command: ${cmd.name}`, [cmd.command]);
      await executeAction(cmd, token);
    } catch (err: any) {
      showIpcError(err, { action: 'Confirm Action' });
    }
  };

  const handleCopyOutput = () => {
    if (!execResult) return;
    navigator.clipboard.writeText(execResult.output.output || '');
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 2000);
    toast.success('Command output copied');
  };

  // Categories list
  const categories = useMemo(() => {
    const cats = new Set<string>();
    commands.forEach(c => {
      if (c.category) cats.add(c.category);
    });
    return ['All', ...Array.from(cats)];
  }, [commands]);

  const filteredCommands = useMemo(() => {
    if (selectedCategory === 'All') return commands;
    return commands.filter(c => c.category === selectedCategory);
  }, [commands, selectedCategory]);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-2">
        <div className="flex items-center gap-2.5">
          <h3 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
            <span>Quick Actions</span>
            <Badge variant="outline" className="text-[11px] font-mono text-zinc-400 bg-zinc-900 border-white/10">
              {commands.length} actions
            </Badge>
          </h3>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-zinc-400 hover:text-foreground"
            onClick={handleResetDefaults}
            disabled={isResetting}
            title="Reload standard built-in quick actions"
          >
            {isResetting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
            Restore Defaults
          </Button>

          <Button 
            variant={isEditMode ? "secondary" : "outline"} 
            size="sm" 
            className="h-8 text-xs border-white/10"
            onClick={() => setIsEditMode(!isEditMode)}
          >
            <Settings2 className="w-3.5 h-3.5 mr-1.5" />
            {isEditMode ? "Done Editing" : "Edit Grid"}
          </Button>
          
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs bg-primary/90 hover:bg-primary font-medium text-primary-foreground shadow-sm">
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Custom Action
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 shadow-2xl max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <CommandIcon className="w-4 h-4 text-primary" />
                  Add Quick Action
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Create a convenient command shortcut for this server.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="grid grid-cols-[3fr_1fr] gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Action Name</Label>
                    <Input 
                      value={name} 
                      onChange={e => setName(e.target.value)} 
                      placeholder="e.g. Restart Redis" 
                      className="h-8 text-xs bg-zinc-900 border-white/10" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Icon Emoji</Label>
                    <Input 
                      value={icon} 
                      onChange={e => setIcon(e.target.value)} 
                      placeholder="⚡" 
                      className="h-8 text-xs bg-zinc-900 border-white/10 text-center" 
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Input 
                    value={category} 
                    onChange={e => setCategory(e.target.value)} 
                    placeholder="Web Server, PM2, Diagnostics, Maintenance" 
                    className="h-8 text-xs bg-zinc-900 border-white/10" 
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Command Text (Shell)</Label>
                  <Input 
                    value={commandStr} 
                    onChange={e => setCommandStr(e.target.value)} 
                    placeholder="sudo systemctl restart redis" 
                    className="h-8 text-xs font-mono bg-zinc-900 border-white/10" 
                  />
                </div>

                <div className="flex items-center justify-between border border-white/10 rounded-xl p-3 bg-zinc-900/50">
                  <div className="space-y-0.5">
                    <Label className="text-xs text-rose-400 font-semibold flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" /> Destructive Action
                    </Label>
                    <p className="text-[11px] text-muted-foreground">Requires master confirmation before executing.</p>
                  </div>
                  <Switch checked={isDestructive} onCheckedChange={setIsDestructive} />
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" size="sm" onClick={() => setIsFormOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCreateCommand}>Save Action</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Category Filter Pills */}
      {categories.length > 2 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                selectedCategory === cat 
                  ? 'bg-primary/15 text-primary border border-primary/30 shadow-sm' 
                  : 'bg-zinc-900/60 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-white/5'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Grid of Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredCommands.map((cmd) => {
          const isBusy = executingCmdId === cmd.id;
          return (
            <div 
              key={cmd.id} 
              className={`group relative p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between gap-3 shadow-md select-none ${
                isBusy ? 'opacity-80 scale-[0.99] border-primary/40' : ''
              } ${
                cmd.is_destructive
                  ? 'bg-rose-950/10 border-rose-500/20 hover:border-rose-500/40 hover:bg-rose-950/20'
                  : 'bg-zinc-950/70 border-white/10 hover:border-white/20 hover:bg-zinc-900/80'
              }`}
              onClick={() => handleActionClick(cmd)}
            >
              {/* Top row: Icon + Category + Danger Badge */}
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg shadow-inner group-hover:scale-105 transition-transform shrink-0">
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  ) : (
                    cmd.icon || '⚡'
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {cmd.category && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-white/10 bg-black/40 text-zinc-400">
                      {cmd.category}
                    </span>
                  )}
                  {cmd.is_destructive && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/15 text-rose-400 font-semibold flex items-center gap-0.5">
                      <ShieldAlert className="w-2.5 h-2.5" /> DANGER
                    </span>
                  )}
                </div>
              </div>

              {/* Title & Command snippet */}
              <div className="min-w-0">
                <h4 className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                  {cmd.name}
                </h4>
                <p className="text-[11px] font-mono text-zinc-500 truncate mt-0.5" title={cmd.command}>
                  {cmd.command}
                </p>
              </div>

              {/* Bottom footer: Click to run / Delete in edit mode */}
              <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[10px] text-zinc-500 font-mono">
                <span className="group-hover:text-zinc-300 transition-colors flex items-center gap-1">
                  <Play className="w-2.5 h-2.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  {isBusy ? 'Running command...' : 'Click to run'}
                </span>

                {isEditMode && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 text-zinc-400 hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => handleDelete(e, cmd.id)}
                    title="Delete action"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {filteredCommands.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-zinc-950/40 rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-3">
            <Sparkles className="w-8 h-8 text-zinc-600" />
            <p className="text-xs">No actions found in this category.</p>
            <Button size="sm" variant="outline" className="h-7 text-xs border-white/10" onClick={handleResetDefaults}>
              <RotateCcw className="w-3 h-3 mr-1.5" /> Load Defaults
            </Button>
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Destructive Commands */}
      <AlertDialog open={!!pendingDestructiveCmd} onOpenChange={(open) => !open && setPendingDestructiveCmd(null)}>
        <AlertDialogContent className="bg-card border-rose-500/20 shadow-2xl max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2.5 text-rose-400 mb-1">
              <div className="p-2 rounded-lg bg-rose-500/15">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <AlertDialogTitle className="text-base text-rose-300">
                Confirm Destructive Action
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-xs text-muted-foreground space-y-2">
              <p>
                You are about to execute <strong className="text-foreground">{pendingDestructiveCmd?.name}</strong> on the remote server:
              </p>
              <div className="p-2.5 rounded-lg bg-black/50 font-mono text-xs text-rose-300 border border-rose-500/20 break-all">
                {pendingDestructiveCmd?.command}
              </div>
              <p className="text-[11px] text-zinc-400">
                This action requires confirmation and will be permanently recorded in your audit activity log.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDestructive}
              className="h-8 text-xs bg-rose-600 hover:bg-rose-500 text-white font-medium shadow-sm"
            >
              Proceed & Execute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Execution Result Dialog */}
      <Dialog open={!!execResult} onOpenChange={() => setExecResult(null)}>
        <DialogContent className="max-w-3xl bg-[#0a0d14] border-white/10 shadow-2xl p-0 overflow-hidden font-mono text-xs">
          {/* Header */}
          <div className="p-4 px-6 border-b border-white/10 flex items-center justify-between bg-zinc-950/80">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span>{execResult?.cmdName}</span>
                  <Badge 
                    variant="outline" 
                    className={`text-[10px] ${
                      execResult?.output.exit_code === 0 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {execResult?.output.exit_code === 0 ? 'Exit 0 • Success' : `Exit ${execResult?.output.exit_code ?? 'Err'} • Failed`}
                  </Badge>
                </DialogTitle>
                <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                  Duration: {execResult?.output.duration_ms}ms • Command: <span className="text-zinc-400">{execResult?.cmdText}</span>
                </div>
              </div>
            </div>

            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs border-white/10 gap-1.5"
              onClick={handleCopyOutput}
            >
              {copiedOutput ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedOutput ? 'Copied' : 'Copy Output'}
            </Button>
          </div>

          {/* Terminal Body */}
          <div className="p-5 bg-black/80 max-h-[60vh] overflow-y-auto selection:bg-primary/30">
            {execResult?.output.output ? (
              <div 
                className="whitespace-pre-wrap leading-relaxed text-zinc-300 text-xs"
                dangerouslySetInnerHTML={{ __html: ansiToHtml(execResult.output.output) || execResult.output.output }}
              />
            ) : (
              <div className="italic text-zinc-600 text-center py-8">
                (Command executed silently with no standard output)
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 px-6 border-t border-white/10 flex items-center justify-between bg-zinc-950/80 text-[11px] text-zinc-500">
            <span>Executed on remote SSH channel</span>
            <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setExecResult(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
