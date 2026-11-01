import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Folder, 
  FolderPlus, 
  FilePlus, 
  UploadCloud, 
  RotateCw, 
  CornerLeftUp, 
  Search, 
  Download, 
  Trash2, 
  Edit2, 
  ShieldCheck, 
  ChevronRight,
  HardDrive,
  Home,
  Globe,
  Settings,
  ScrollText,
  Loader2,
  ArrowUpDown,
  MoreVertical,
  AlertTriangle,
  Bookmark
} from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  listRemoteFiles, 
  downloadRemoteFile, 
  uploadRemoteFile, 
  createRemoteDirectory, 
  createRemoteFile, 
  renameRemotePath, 
  deleteRemotePaths,
  requestConfirmation
} from '@/lib/tauri-client';
import { FileIcon } from './FileIcon';
import { FileEditorModal } from './FileEditorModal';
import { ChmodModal } from './ChmodModal';
import { toast } from 'sonner';
import type { RemoteFileEntry, RemoteDirectoryListing } from '@/types';

interface FileManagerProps {
  serverId: string;
}

export const FileManager: React.FC<FileManagerProps> = ({ serverId }) => {
  const [currentPath, setCurrentPath] = useState('~');
  const [pathInput, setPathInput] = useState('~');
  const [listing, setListing] = useState<RemoteDirectoryListing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // Modals state
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [chmodEntry, setChmodEntry] = useState<RemoteFileEntry | null>(null);

  // New Folder Modal
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // New File Modal
  const [isNewFileOpen, setIsNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  // Rename Modal
  const [renamingEntry, setRenamingEntry] = useState<RemoteFileEntry | null>(null);
  const [renameTargetName, setRenameTargetName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Delete Modal
  const [deletingEntry, setDeletingEntry] = useState<RemoteFileEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Uploading state
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch directory listing
  const fetchDirectory = useCallback(async (targetPath?: string) => {
    try {
      setIsLoading(true);
      const path = targetPath ?? currentPath;
      const data = await listRemoteFiles(serverId, path);
      setListing(data);
      setCurrentPath(data.current_path);
      setPathInput(data.current_path);
    } catch (err: any) {
      toast.error(`Failed to browse directory: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  }, [serverId, currentPath]);

  useEffect(() => {
    fetchDirectory('~');
  }, [serverId]);

  const handleNavigate = (path: string) => {
    setSearchFilter('');
    fetchDirectory(path);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pathInput.trim()) {
      handleNavigate(pathInput.trim());
    }
  };

  const handleUpOneLevel = () => {
    if (listing?.parent_path) {
      handleNavigate(listing.parent_path);
    }
  };

  // Upload handler (Base64 zero server memory)
  const handleFileUpload = async (file: File) => {
    try {
      setIsUploading(true);
      toast.info(`Uploading ${file.name}...`);
      
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const rawResult = reader.result as string;
          const base64Content = rawResult.split(',')[1] || rawResult;
          await uploadRemoteFile(serverId, currentPath, file.name, base64Content);
          toast.success(`Uploaded ${file.name} successfully`);
          fetchDirectory();
        } catch (uploadErr: any) {
          toast.error(`Upload error: ${uploadErr?.message || uploadErr}`);
        } finally {
          setIsUploading(false);
        }
      };
      reader.onerror = () => {
        toast.error('Failed to read local file');
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast.error(`Upload failed: ${err?.message || err}`);
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Download handler
  const handleDownload = async (entry: RemoteFileEntry) => {
    try {
      toast.info(`Preparing ${entry.name}...`);
      const res = await downloadRemoteFile(serverId, entry.path);
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

  // Create Folder handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      setIsCreatingFolder(true);
      const newPath = `${currentPath.trimEnd()}/${newFolderName.trim()}`;
      await createRemoteDirectory(serverId, newPath);
      toast.success(`Directory created: ${newFolderName}`);
      setIsNewFolderOpen(false);
      setNewFolderName('');
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Failed to create directory: ${err?.message || err}`);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Create File handler
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    try {
      setIsCreatingFile(true);
      const newPath = `${currentPath.trimEnd()}/${newFileName.trim()}`;
      await createRemoteFile(serverId, newPath);
      toast.success(`File created: ${newFileName}`);
      setIsNewFileOpen(false);
      setNewFileName('');
      fetchDirectory();
      // Immediately open in editor
      setEditingFilePath(newPath);
    } catch (err: any) {
      toast.error(`Failed to create file: ${err?.message || err}`);
    } finally {
      setIsCreatingFile(false);
    }
  };

  // Rename handler
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingEntry || !renameTargetName.trim()) return;
    try {
      setIsRenaming(true);
      const parent = currentPath;
      const newPath = `${parent.trimEnd()}/${renameTargetName.trim()}`;
      await renameRemotePath(serverId, renamingEntry.path, newPath);
      toast.success(`Renamed to ${renameTargetName}`);
      setRenamingEntry(null);
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Failed to rename: ${err?.message || err}`);
    } finally {
      setIsRenaming(false);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!deletingEntry) return;
    try {
      setIsDeleting(true);
      const token = await requestConfirmation(`Delete ${deletingEntry.is_dir ? 'directory' : 'file'} "${deletingEntry.name}"`, [serverId]);
      await deleteRemotePaths(serverId, [deletingEntry.path], deletingEntry.is_dir, token);
      toast.success(`Deleted ${deletingEntry.name}`);
      setDeletingEntry(null);
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Failed to delete: ${err?.message || err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Format helpers
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '—';
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Breadcrumbs generator
  const getBreadcrumbs = () => {
    if (!listing?.current_path) return [];
    const parts = listing.current_path.split('/').filter(Boolean);
    const crumbs = [{ label: '/', path: '/' }];
    let acc = '';
    for (const p of parts) {
      acc += `/${p}`;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  };

  // Filtered & Sorted entries
  const filteredEntries = (listing?.entries || []).filter((e) => {
    if (!searchFilter) return true;
    return e.name.toLowerCase().includes(searchFilter.toLowerCase());
  }).sort((a, b) => {
    // Folders first
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;

    let res = 0;
    if (sortBy === 'name') {
      res = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    } else if (sortBy === 'size') {
      res = a.size - b.size;
    } else if (sortBy === 'modified') {
      res = a.modified - b.modified;
    }
    return sortAsc ? res : -res;
  });

  const breadcrumbs = getBreadcrumbs();

  return (
    <div 
      className="flex flex-col flex-1 min-h-0 bg-card/60 border border-border/80 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      {/* Hidden file input for uploads */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Drag Over Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-primary/20 backdrop-blur-xs z-50 flex flex-col items-center justify-center border-2 border-dashed border-primary rounded-2xl pointer-events-none">
          <UploadCloud className="w-12 h-12 text-primary animate-bounce" />
          <p className="text-sm font-semibold text-foreground mt-2">Drop file to upload to current directory</p>
          <p className="text-xs text-muted-foreground font-mono">{currentPath}</p>
        </div>
      )}

      {/* Top Location Bookmarks Bar */}
      <div className="flex items-center gap-1.5 px-3 sm:px-4 py-2 border-b border-border/60 bg-muted/30 overflow-x-auto shrink-0 text-xs">
        <span className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mr-1 shrink-0 flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5 text-primary" /> Bookmarks:
        </span>
        {[
          { label: 'Home (~)', path: '~', icon: Home, iconColor: 'text-sky-400' },
          { label: '/var/www', path: '/var/www', icon: Globe, iconColor: 'text-emerald-400' },
          { label: '/etc/nginx', path: '/etc/nginx', icon: Settings, iconColor: 'text-cyan-400' },
          { label: '/var/log', path: '/var/log', icon: ScrollText, iconColor: 'text-amber-400' },
          { label: '/tmp', path: '/tmp', icon: Folder, iconColor: 'text-orange-400' },
          { label: 'Root (/)', path: '/', icon: HardDrive, iconColor: 'text-primary' },
        ].map((bm) => {
          const Icon = bm.icon;
          const isSelected = currentPath === bm.path || (bm.path === '~' && (currentPath === '/root' || currentPath.startsWith('/home/')));
          return (
            <button
              key={bm.path}
              type="button"
              onClick={() => handleNavigate(bm.path)}
              className={cn(
                "h-7 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all select-none shrink-0 border cursor-pointer",
                isSelected
                  ? "bg-primary/15 text-primary border-primary/30 shadow-xs font-semibold"
                  : "bg-background/80 text-muted-foreground hover:text-foreground hover:bg-muted/80 border-border/60"
              )}
            >
              <Icon className={cn("w-3.5 h-3.5", bm.iconColor)} />
              <span>{bm.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Navigation & Breadcrumbs Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 border-b border-border/60 bg-muted/20 shrink-0">
        {/* Navigation Buttons + Breadcrumbs */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleUpOneLevel}
            disabled={!listing?.parent_path || isLoading}
            className="h-8 px-2 text-xs border-border text-foreground hover:bg-muted shrink-0"
            title="Up One Level"
          >
            <CornerLeftUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchDirectory()}
            disabled={isLoading}
            className="h-8 px-2 text-xs border-border text-foreground hover:bg-muted shrink-0"
            title="Refresh Directory"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          {/* Interactive Breadcrumbs */}
          <div className="flex items-center bg-background border border-input rounded-lg px-2.5 h-8 flex-1 min-w-0 overflow-x-auto">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mx-0.5" />}
                <button
                  type="button"
                  onClick={() => handleNavigate(crumb.path)}
                  className={`text-xs font-mono hover:text-primary transition-colors truncate shrink-0 ${
                    idx === breadcrumbs.length - 1 ? 'font-bold text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Path Direct Input Form */}
        <form onSubmit={handlePathSubmit} className="flex items-center gap-1.5 shrink-0">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="Type path and Enter..."
            className="h-8 text-xs font-mono bg-background border-input w-48 sm:w-64"
          />
          <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs font-medium px-3">
            Go
          </Button>
        </form>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 border-b border-border/60 bg-card/40 shrink-0 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => setIsNewFolderOpen(true)}
            className="h-8 text-xs bg-primary text-primary-foreground hover:opacity-90 gap-1.5 shadow-sm font-medium"
          >
            <FolderPlus className="w-3.5 h-3.5" /> New Folder
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsNewFileOpen(true)}
            className="h-8 text-xs border-border text-foreground hover:bg-muted gap-1.5 font-medium"
          >
            <FilePlus className="w-3.5 h-3.5 text-primary" /> New File
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="h-8 text-xs border-border text-foreground hover:bg-muted gap-1.5 font-medium"
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5 text-sky-400" />}
            Upload File
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search Filter */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter current folder..."
              className="h-8 text-xs pl-8 bg-background border-input w-44"
            />
          </div>

          {/* Directory Summary */}
          {listing && (
            <Badge variant="outline" className="text-[11px] font-mono text-muted-foreground border-border bg-muted/40 h-8 px-2.5">
              {listing.total_dirs} dirs, {listing.total_files} files • {formatSize(listing.total_size)}
            </Badge>
          )}
        </div>
      </div>

      {/* File Explorer Table */}
      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {isLoading && !listing ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-xs">Fetching remote filesystem (Zero server RAM)...</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
            <Folder className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-xs font-medium text-foreground">
              {searchFilter ? `No files matching "${searchFilter}"` : 'This directory is empty'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Drop files here or click "New File" / "Upload File" above.
            </p>
          </div>
        ) : (
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold text-muted-foreground sticky top-0 z-10 backdrop-blur-md">
                <th 
                  className="py-2.5 px-4 cursor-pointer hover:text-foreground transition-colors select-none"
                  onClick={() => {
                    if (sortBy === 'name') setSortAsc(!sortAsc);
                    else { setSortBy('name'); setSortAsc(true); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Name</span>
                    {sortBy === 'name' && <ArrowUpDown className="w-3 h-3 text-primary" />}
                  </div>
                </th>
                <th 
                  className="py-2.5 px-3 cursor-pointer hover:text-foreground transition-colors select-none w-24 text-right"
                  onClick={() => {
                    if (sortBy === 'size') setSortAsc(!sortAsc);
                    else { setSortBy('size'); setSortAsc(false); }
                  }}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Size</span>
                    {sortBy === 'size' && <ArrowUpDown className="w-3 h-3 text-primary" />}
                  </div>
                </th>
                <th className="py-2.5 px-3 w-28 font-mono text-center hidden md:table-cell">Permissions</th>
                <th className="py-2.5 px-3 w-24 hidden lg:table-cell">Owner</th>
                <th 
                  className="py-2.5 px-3 cursor-pointer hover:text-foreground transition-colors select-none w-36 hidden sm:table-cell"
                  onClick={() => {
                    if (sortBy === 'modified') setSortAsc(!sortAsc);
                    else { setSortBy('modified'); setSortAsc(false); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Modified</span>
                    {sortBy === 'modified' && <ArrowUpDown className="w-3 h-3 text-primary" />}
                  </div>
                </th>
                <th className="py-2.5 px-4 w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredEntries.map((entry) => (
                <tr
                  key={entry.path}
                  onDoubleClick={() => {
                    if (entry.is_dir) {
                      handleNavigate(entry.path);
                    } else {
                      setEditingFilePath(entry.path);
                    }
                  }}
                  className="hover:bg-muted/40 transition-colors group cursor-pointer"
                >
                  {/* Name + Icon */}
                  <td className="py-2 px-4 font-medium flex items-center gap-2.5">
                    <FileIcon entry={entry} className="w-4 h-4 shrink-0" />
                    <span 
                      className={`truncate max-w-xs sm:max-w-md ${
                        entry.is_dir ? 'text-foreground font-semibold hover:underline' : 'text-foreground/90'
                      }`}
                      title={entry.name}
                    >
                      {entry.name}
                    </span>
                    {entry.is_symlink && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted text-muted-foreground border-border">
                        symlink
                      </Badge>
                    )}
                  </td>

                  {/* Size */}
                  <td className="py-2 px-3 font-mono text-right text-muted-foreground">
                    {formatSize(entry.size)}
                  </td>

                  {/* Permissions */}
                  <td className="py-2 px-3 font-mono text-center text-muted-foreground hidden md:table-cell">
                    <span 
                      onClick={(e) => { e.stopPropagation(); setChmodEntry(entry); }}
                      className="hover:text-primary hover:underline cursor-pointer"
                      title="Click to edit permissions"
                    >
                      {entry.permissions} ({entry.mode})
                    </span>
                  </td>

                  {/* Owner / Group */}
                  <td className="py-2 px-3 text-muted-foreground truncate hidden lg:table-cell font-mono text-[11px]">
                    {entry.owner}:{entry.group}
                  </td>

                  {/* Modified Date */}
                  <td className="py-2 px-3 text-muted-foreground font-mono text-[11px] hidden sm:table-cell">
                    {formatDate(entry.modified)}
                  </td>

                  {/* Quick Action Buttons */}
                  <td className="py-2 px-4 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                      {/* View/Edit text files */}
                      {!entry.is_dir && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); setEditingFilePath(entry.path); }}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          title="View / Edit File"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      {/* Download */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        title={entry.is_dir ? "Download as .tar.gz archive" : "Download File"}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>

                      {/* Dropdown Menu for More Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover border-border text-xs w-40">
                          <DropdownMenuItem onClick={() => { setRenamingEntry(entry); setRenameTargetName(entry.name); }}>
                            <Edit2 className="w-3.5 h-3.5 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setChmodEntry(entry)}>
                            <ShieldCheck className="w-3.5 h-3.5 mr-2" /> Permissions (chmod)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDownload(entry)}>
                            <Download className="w-3.5 h-3.5 mr-2" /> Download
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => setDeletingEntry(entry)}
                            className="text-rose-500 focus:text-rose-400 focus:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* File Editor Modal */}
      <FileEditorModal
        serverId={serverId}
        filePath={editingFilePath}
        onClose={() => setEditingFilePath(null)}
        onSaved={fetchDirectory}
      />

      {/* Permissions Chmod Modal */}
      <ChmodModal
        serverId={serverId}
        entry={chmodEntry}
        onClose={() => setChmodEntry(null)}
        onSuccess={fetchDirectory}
      />

      {/* Create New Folder Modal */}
      <Dialog open={isNewFolderOpen} onOpenChange={setIsNewFolderOpen}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-primary" /> Create New Directory
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Enter directory name under <span className="font-mono text-foreground">{currentPath}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateFolder} className="space-y-4 pt-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="folder-name"
              autoFocus
              className="h-8 text-xs bg-background border-input font-mono"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsNewFolderOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isCreatingFolder || !newFolderName.trim()} className="text-xs bg-primary text-primary-foreground gap-1.5">
                {isCreatingFolder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Folder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create New File Modal */}
      <Dialog open={isNewFileOpen} onOpenChange={setIsNewFileOpen}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <FilePlus className="w-4 h-4 text-primary" /> Create New File
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Enter file name under <span className="font-mono text-foreground">{currentPath}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateFile} className="space-y-4 pt-2">
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="e.g. script.sh, .env, config.json"
              autoFocus
              className="h-8 text-xs bg-background border-input font-mono"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsNewFileOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isCreatingFile || !newFileName.trim()} className="text-xs bg-primary text-primary-foreground gap-1.5">
                {isCreatingFile && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create & Edit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Item Modal */}
      <Dialog open={!!renamingEntry} onOpenChange={(open) => !open && setRenamingEntry(null)}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-primary" /> Rename Item
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Enter new name for <span className="font-mono text-foreground">{renamingEntry?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4 pt-2">
            <Input
              value={renameTargetName}
              onChange={(e) => setRenameTargetName(e.target.value)}
              autoFocus
              className="h-8 text-xs bg-background border-input font-mono"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingEntry(null)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isRenaming || !renameTargetName.trim()} className="text-xs bg-primary text-primary-foreground gap-1.5">
                {isRenaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Item Confirmation Modal */}
      <Dialog open={!!deletingEntry} onOpenChange={(open) => !open && setDeletingEntry(null)}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-rose-500 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500" /> Confirm Deletion
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete <span className="font-mono font-semibold text-foreground">{deletingEntry?.name}</span>?
              {deletingEntry?.is_dir && (
                <span className="block mt-1 text-rose-400 font-medium">
                  Warning: All files and subfolders inside this directory will be permanently removed.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeletingEntry(null)} className="text-xs">
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-xs bg-rose-600 hover:bg-rose-500 text-white gap-1.5"
            >
              {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

