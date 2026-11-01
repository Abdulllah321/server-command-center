import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  Save, 
  Loader2, 
  Download, 
  Check, 
  AlertTriangle, 
  Copy,
  WrapText,
  FileCode
} from 'lucide-react';
import { readRemoteFileContent, writeRemoteFileContent, downloadRemoteFile } from '@/lib/tauri-client';
import { toast } from 'sonner';

interface FileEditorModalProps {
  serverId: string;
  filePath: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

export const FileEditorModal: React.FC<FileEditorModalProps> = ({
  serverId,
  filePath,
  onClose,
  onSaved,
}) => {
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isBinary, setIsBinary] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [createBackup, setCreateBackup] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!filePath || !serverId) return;

    let isMounted = true;
    const fetchContent = async () => {
      try {
        setIsLoading(true);
        const res = await readRemoteFileContent(serverId, filePath);
        if (!isMounted) return;

        setContent(res.content);
        setInitialContent(res.content);
        setIsBinary(res.is_binary);
        setIsTruncated(res.is_truncated);
        setFileSize(res.size);
      } catch (err: any) {
        if (!isMounted) return;
        toast.error(`Failed to read file: ${err?.message || err}`);
        onClose();
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchContent();
    return () => {
      isMounted = false;
    };
  }, [serverId, filePath]);

  const handleSave = async () => {
    if (!filePath || isBinary) return;

    try {
      setIsSaving(true);
      await writeRemoteFileContent(serverId, filePath, content, createBackup);
      setInitialContent(content);
      toast.success(createBackup ? 'File saved with .bak backup' : 'File saved successfully');
      onSaved?.();
    } catch (err: any) {
      toast.error(`Failed to save file: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = async () => {
    if (!filePath) return;
    try {
      const res = await downloadRemoteFile(serverId, filePath);
      const link = document.createElement('a');
      link.href = `data:application/octet-stream;base64,${res.base64_content}`;
      link.download = res.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Downloaded ${res.filename}`);
    } catch (err: any) {
      toast.error(`Download failed: ${err?.message || err}`);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Keyboard shortcut Ctrl+S / Cmd+S
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Tab key inserts 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newContent);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  const isDirty = content !== initialContent;
  const fileName = filePath ? filePath.split('/').pop() || filePath : '';
  const lines = content.split('\n').length;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Dialog open={!!filePath} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 bg-card border-border text-foreground shadow-2xl">
        {/* Header */}
        <DialogHeader className="p-4 border-b border-border bg-muted/40 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <FileCode className="w-5 h-5 text-primary shrink-0" />
            <div className="overflow-hidden">
              <DialogTitle className="text-sm font-semibold flex items-center gap-2 truncate text-foreground">
                <span>{fileName}</span>
                {isDirty && (
                  <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                    Unsaved Changes
                  </Badge>
                )}
                {isBinary && (
                  <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30">
                    Binary
                  </Badge>
                )}
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{filePath}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline">
              {formatSize(fileSize)} • {lines} lines
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWordWrap(!wordWrap)}
              className={`h-7 px-2 text-xs gap-1 border border-border ${wordWrap ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}
              title="Toggle Word Wrap"
            >
              <WrapText className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Wrap</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-2 text-xs gap-1 border border-border text-muted-foreground hover:text-foreground"
              title="Copy Content"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{copied ? 'Copied' : 'Copy'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="h-7 px-2 text-xs gap-1 border-border text-foreground hover:bg-accent"
              title="Download to PC"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Download</span>
            </Button>
          </div>
        </DialogHeader>

        {/* Truncated notice if file exceeds preview size */}
        {isTruncated && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Large file: Showing the first 2 MB preview. Editing is disabled to avoid file truncation.</span>
            </div>
            <Button size="sm" variant="ghost" onClick={handleDownload} className="h-6 text-xs text-amber-600 dark:text-amber-300 hover:bg-amber-500/20">
              Download Full File
            </Button>
          </div>
        )}

        {/* Editor Body */}
        <div className="flex-1 min-h-0 relative bg-background flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs">Reading file from remote server...</p>
            </div>
          ) : isBinary ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground p-6">
              <FileText className="w-12 h-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Binary File Detected</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  This file contains binary or compiled data that cannot be edited in the text editor.
                </p>
              </div>
              <Button size="sm" onClick={handleDownload} className="gap-2 bg-primary text-primary-foreground">
                <Download className="w-4 h-4" /> Download Binary File
              </Button>
            </div>
          ) : (
            <div className="flex-1 flex relative overflow-hidden font-mono text-xs">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isTruncated}
                spellCheck={false}
                className={`w-full h-full p-4 bg-background text-foreground resize-none outline-none font-mono text-xs leading-relaxed selection:bg-primary/30 ${
                  wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'
                }`}
                placeholder="Empty file..."
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="p-3 border-t border-border bg-muted/40 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={createBackup}
                onChange={(e) => setCreateBackup(e.target.checked)}
                className="rounded border-input text-primary focus:ring-0"
              />
              <span>Create backup (.bak) on save</span>
            </label>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">• Ctrl+S to save</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs text-muted-foreground hover:text-foreground">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !isDirty || isBinary || isTruncated}
              className="h-8 text-xs bg-primary text-primary-foreground hover:opacity-90 gap-1.5 shadow-sm"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

