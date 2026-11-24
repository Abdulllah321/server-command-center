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
  Bookmark,
  Scissors,
  Copy,
  Clipboard,
  FileArchive,
  Layers,
  X,
  CheckSquare,
  CopyCheck,
  FolderArchive
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
  uploadRemoteFileChunk,
  cancelRemoteFileUpload,
  createRemoteDirectory, 
  createRemoteFile, 
  renameRemotePath, 
  deleteRemotePaths,
  requestConfirmation,
  moveRemotePaths,
  copyRemotePaths,
  duplicateRemotePath,
  compressRemotePaths,
  extractRemoteArchive
} from '@/lib/tauri-client';
import { FileIcon } from './FileIcon';
import { FileEditorModal } from './FileEditorModal';
import { ChmodModal } from './ChmodModal';
import { toast } from 'sonner';
import type { RemoteFileEntry, RemoteDirectoryListing } from '@/types';

interface FileManagerProps {
  serverId: string;
}

interface ClipboardState {
  action: 'cut' | 'copy';
  paths: string[];
  sourceDir: string;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  entry?: RemoteFileEntry | null; // null represents empty area
}

const isArchive = (filename: string): boolean => {
  return /\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|gz)$/i.test(filename);
};

export const FileManager: React.FC<FileManagerProps> = ({ serverId }) => {
  const [currentPath, setCurrentPath] = useState('~');
  const [pathInput, setPathInput] = useState('~');
  const [listing, setListing] = useState<RemoteDirectoryListing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // Selection & Clipboard state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, entry: null });

  // In-app Drag and Drop state
  const [draggedItemPaths, setDraggedItemPaths] = useState<string[]>([]);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

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

  // Compress Modal
  const [isCompressOpen, setIsCompressOpen] = useState(false);
  const [compressTargetPaths, setCompressTargetPaths] = useState<string[]>([]);
  const [compressName, setCompressName] = useState('');
  const [compressType, setCompressType] = useState<'zip' | 'tar.gz'>('zip');
  const [isCompressing, setIsCompressing] = useState(false);

  // Uploading state
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    uploadId: string;
    filename: string;
    totalSize: number;
    uploadedBytes: number;
    currentChunk: number;
    totalChunks: number;
    percent: number;
    speedMBps: number;
    timeRemainingSec?: number;
  } | null>(null);
  const cancelUploadRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Fetch directory listing
  const fetchDirectory = useCallback(async (targetPath?: string) => {
    try {
      setIsLoading(true);
      const path = targetPath ?? currentPath;
      const data = await listRemoteFiles(serverId, path);
      setListing(data);
      setCurrentPath(data.current_path);
      setPathInput(data.current_path);
      setSelectedPaths(new Set());
    } catch (err: any) {
      toast.error(`Failed to browse directory: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  }, [serverId, currentPath]);

  useEffect(() => {
    fetchDirectory('~');
  }, [serverId]);

  // Close context menu on outside click
  useEffect(() => {
    const handleGlobalClick = () => {
      if (contextMenu.visible) {
        setContextMenu({ visible: false, x: 0, y: 0, entry: null });
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [contextMenu.visible]);

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

  // Upload handler supporting large files (1 GB+) via chunked binary stream
  const handleFileUpload = async (file: File, targetDir?: string) => {
    if (!file) return;

    const readSliceAsBase64 = (slice: Blob): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const commaIdx = res.indexOf(',');
          resolve(commaIdx !== -1 ? res.substring(commaIdx + 1) : res);
        };
        reader.onerror = () => reject(reader.error || new Error('Slice read error'));
        reader.readAsDataURL(slice);
      });
    };

    const destDir = targetDir || currentPath;
    const CHUNK_SIZE = 1024 * 1024; // 1 MB chunk size
    const totalSize = file.size;
    const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
    const uploadId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let isCancelled = false;
    cancelUploadRef.current = () => {
      isCancelled = true;
    };

    setIsUploading(true);
    const startTime = Date.now();

    setUploadProgress({
      uploadId,
      filename: file.name,
      totalSize,
      uploadedBytes: 0,
      currentChunk: 0,
      totalChunks,
      percent: 0,
      speedMBps: 0,
    });

    try {
      toast.info(`Starting upload of ${file.name} (${formatSize(totalSize)})...`);

      for (let i = 0; i < totalChunks; i++) {
        if (isCancelled) {
          await cancelRemoteFileUpload(serverId, destDir, file.name, uploadId).catch(() => {});
          toast.warning(`Upload of ${file.name} was cancelled`);
          setUploadProgress(null);
          setIsUploading(false);
          cancelUploadRef.current = null;
          return;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);
        const slice = file.slice(start, end);
        const base64Chunk = await readSliceAsBase64(slice);

        await uploadRemoteFileChunk({
          serverId,
          remoteDir: destDir,
          filename: file.name,
          uploadId,
          chunkIndex: i,
          totalChunks,
          totalSize,
          base64Chunk,
        });

        const currentUploaded = end;
        const now = Date.now();
        const elapsedSec = (now - startTime) / 1000;
        let speedMBps = 0;
        if (elapsedSec > 0) {
          speedMBps = parseFloat(((currentUploaded / (1024 * 1024)) / elapsedSec).toFixed(2));
        }
        const percent = Math.min(100, Math.round((currentUploaded / Math.max(1, totalSize)) * 100));
        const remainingBytes = totalSize - currentUploaded;
        const timeRemainingSec = speedMBps > 0 ? Math.round((remainingBytes / (1024 * 1024)) / speedMBps) : undefined;

        setUploadProgress({
          uploadId,
          filename: file.name,
          totalSize,
          uploadedBytes: currentUploaded,
          currentChunk: i + 1,
          totalChunks,
          percent,
          speedMBps,
          timeRemainingSec,
        });
      }

      toast.success(`Uploaded ${file.name} (${formatSize(totalSize)}) successfully`);
      fetchDirectory();
    } catch (err: any) {
      if (!isCancelled) {
        await cancelRemoteFileUpload(serverId, destDir, file.name, uploadId).catch(() => {});
        toast.error(`Upload failed: ${err?.message || err}`);
      }
    } finally {
      setUploadProgress(null);
      setIsUploading(false);
      cancelUploadRef.current = null;
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  // Duplicate handler
  const handleDuplicate = async (entry: RemoteFileEntry) => {
    try {
      toast.info(`Duplicating ${entry.name}...`);
      const newPath = await duplicateRemotePath(serverId, entry.path);
      const name = newPath.split('/').pop() || newPath;
      toast.success(`Created duplicate: ${name}`);
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Duplicate failed: ${err?.message || err}`);
    }
  };

  // Cut & Copy handlers
  const handleCut = (paths: string[]) => {
    if (paths.length === 0) return;
    setClipboard({ action: 'cut', paths, sourceDir: currentPath });
    toast.info(`Cut ${paths.length} item${paths.length > 1 ? 's' : ''}. Navigate and Paste.`);
  };

  const handleCopy = (paths: string[]) => {
    if (paths.length === 0) return;
    setClipboard({ action: 'copy', paths, sourceDir: currentPath });
    toast.info(`Copied ${paths.length} item${paths.length > 1 ? 's' : ''}. Navigate and Paste.`);
  };

  // Paste handler
  const handlePaste = async (targetDir?: string) => {
    if (!clipboard || clipboard.paths.length === 0) return;
    const destinationDir = targetDir || currentPath;
    try {
      if (clipboard.action === 'cut') {
        toast.info(`Moving ${clipboard.paths.length} item(s) to ${destinationDir}...`);
        await moveRemotePaths(serverId, clipboard.paths, destinationDir);
        toast.success(`Moved ${clipboard.paths.length} item(s) successfully`);
        setClipboard(null);
      } else {
        toast.info(`Copying ${clipboard.paths.length} item(s) to ${destinationDir}...`);
        await copyRemotePaths(serverId, clipboard.paths, destinationDir);
        toast.success(`Copied ${clipboard.paths.length} item(s) successfully`);
      }
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Paste failed: ${err?.message || err}`);
    }
  };

  // Compress handler
  const openCompressModal = (paths: string[]) => {
    if (paths.length === 0) return;
    setCompressTargetPaths(paths);
    const firstName = paths[0].split('/').pop() || 'archive';
    const baseClean = firstName.replace(/\.[^/.]+$/, '');
    setCompressName(paths.length === 1 ? `${baseClean}.zip` : 'archive.zip');
    setCompressType('zip');
    setIsCompressOpen(true);
  };

  const handleExecuteCompress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compressName.trim() || compressTargetPaths.length === 0) return;
    try {
      setIsCompressing(true);
      const destPath = `${currentPath.trimEnd()}/${compressName.trim()}`;
      toast.info(`Compressing ${compressTargetPaths.length} item(s)...`);
      await compressRemotePaths(serverId, compressTargetPaths, destPath, compressType);
      toast.success(`Created archive ${compressName}`);
      setIsCompressOpen(false);
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Compression failed: ${err?.message || err}`);
    } finally {
      setIsCompressing(false);
    }
  };

  // Extract handler
  const handleExtract = async (archivePath: string, destinationDir: string) => {
    try {
      toast.info(`Extracting archive...`);
      await extractRemoteArchive(serverId, archivePath, destinationDir);
      toast.success('Extracted archive successfully');
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Extraction failed: ${err?.message || err}`);
    }
  };

  // Copy remote path to local clipboard
  const handleCopyPathToClipboard = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(`Copied path to clipboard: ${path}`);
    } catch {
      toast.info(path);
    }
  };

  // Drag and drop internal file move onto directory
  const handleDropOnDirectory = async (targetFolder: RemoteFileEntry) => {
    setDropTargetDir(null);
    if (!draggedItemPaths || draggedItemPaths.length === 0) return;
    if (draggedItemPaths.includes(targetFolder.path)) {
      toast.warning('Cannot move a folder into itself');
      return;
    }
    try {
      toast.info(`Moving ${draggedItemPaths.length} item(s) into ${targetFolder.name}...`);
      await moveRemotePaths(serverId, draggedItemPaths, targetFolder.path);
      toast.success(`Moved into ${targetFolder.name}`);
      setDraggedItemPaths([]);
      setSelectedPaths(new Set());
      fetchDirectory();
    } catch (err: any) {
      toast.error(`Move failed: ${err?.message || err}`);
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

  // Selection handlers
  const handleRowClick = (entry: RemoteFileEntry, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
    } else if (e.shiftKey && selectedPaths.size > 0) {
      const entries = filteredEntries;
      const lastSelected = Array.from(selectedPaths).pop();
      const lastIdx = entries.findIndex(item => item.path === lastSelected);
      const currIdx = entries.findIndex(item => item.path === entry.path);
      if (lastIdx !== -1 && currIdx !== -1) {
        const [start, end] = [Math.min(lastIdx, currIdx), Math.max(lastIdx, currIdx)];
        const range = new Set(selectedPaths);
        for (let i = start; i <= end; i++) {
          range.add(entries[i].path);
        }
        setSelectedPaths(range);
      }
    } else {
      setSelectedPaths(new Set([entry.path]));
    }
  };

  const handleSelectAll = () => {
    if (selectedPaths.size === filteredEntries.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filteredEntries.map(e => e.path)));
    }
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        if (contextMenu.visible) setContextMenu({ visible: false, x: 0, y: 0, entry: null });
        if (clipboard) setClipboard(null);
        setSelectedPaths(new Set());
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedPaths.size > 0) {
          e.preventDefault();
          handleCopy(Array.from(selectedPaths));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (selectedPaths.size > 0) {
          e.preventDefault();
          handleCut(Array.from(selectedPaths));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboard) {
          e.preventDefault();
          handlePaste();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (selectedPaths.size === 1) {
          e.preventDefault();
          const entry = filteredEntries.find(i => selectedPaths.has(i.path));
          if (entry) handleDuplicate(entry);
        }
      } else if (e.key === 'F2') {
        if (selectedPaths.size === 1) {
          e.preventDefault();
          const entry = filteredEntries.find(i => selectedPaths.has(i.path));
          if (entry) {
            setRenamingEntry(entry);
            setRenameTargetName(entry.name);
          }
        }
      } else if (e.key === 'Delete') {
        if (selectedPaths.size === 1) {
          e.preventDefault();
          const entry = filteredEntries.find(i => selectedPaths.has(i.path));
          if (entry) setDeletingEntry(entry);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu.visible, clipboard, selectedPaths, filteredEntries]);

  const breadcrumbs = getBreadcrumbs();

  return (
    <div 
      className="flex flex-col flex-1 min-h-0 bg-card/60 border border-border/80 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm relative"
      onDragOver={(e) => { 
        // Only trigger overlay if dragging files from outside OS
        if (e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault(); 
          setIsDraggingOver(true); 
        }
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => {
        setIsDraggingOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          handleFileUpload(e.dataTransfer.files[0]);
        }
      }}
    >
      {/* Hidden file input for uploads */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Drag Over External Files Overlay */}
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

          {/* Quick Selection Actions when items are selected */}
          {selectedPaths.size > 0 && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border/60 animate-in fade-in duration-150">
              <Badge variant="secondary" className="text-[11px] font-medium h-7 px-2">
                {selectedPaths.size} selected
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCut(Array.from(selectedPaths))}
                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                title="Cut selected (Ctrl+X)"
              >
                <Scissors className="w-3.5 h-3.5" /> Cut
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(Array.from(selectedPaths))}
                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                title="Copy selected (Ctrl+C)"
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </Button>
              {selectedPaths.size === 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const entry = filteredEntries.find(i => selectedPaths.has(i.path));
                    if (entry) handleDuplicate(entry);
                  }}
                  className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  title="Duplicate selected (Ctrl+D)"
                >
                  <Layers className="w-3.5 h-3.5" /> Duplicate
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openCompressModal(Array.from(selectedPaths))}
                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                title="Compress selected to archive"
              >
                <FileArchive className="w-3.5 h-3.5" /> Compress
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedPaths(new Set())}
                className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                title="Clear selection (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
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

      {/* Floating Clipboard Indicator Bar */}
      {clipboard && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-primary/10 border-b border-primary/30 text-xs shrink-0 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center gap-2 text-foreground font-medium">
            <Clipboard className="w-4 h-4 text-primary animate-pulse" />
            <span>
              {clipboard.action === 'cut' ? 'Cut' : 'Copied'}{' '}
              <strong className="text-primary">{clipboard.paths.length} item(s)</strong>
              {' '}(ready to paste into <span className="font-mono text-muted-foreground">{currentPath}</span>)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => handlePaste()}
              className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:opacity-90 font-semibold gap-1.5 shadow-xs"
            >
              <Clipboard className="w-3 h-3" /> Paste Here
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setClipboard(null)}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Cancel Clipboard (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Active Chunked Upload Progress Banner */}
      {uploadProgress && (
        <div className="mx-3.5 mt-3 p-3.5 rounded-xl border border-primary/30 bg-primary/5 backdrop-blur-md shadow-md animate-in fade-in slide-in-from-top-2 duration-200 shrink-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <UploadCloud className="w-4 h-4 animate-bounce" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-foreground truncate max-w-xs">{uploadProgress.filename}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 border-primary/40 text-primary font-mono">
                    {uploadProgress.percent}%
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mt-0.5 flex items-center gap-2">
                  <span>{formatSize(uploadProgress.uploadedBytes)} of {formatSize(uploadProgress.totalSize)}</span>
                  <span>•</span>
                  <span>{uploadProgress.speedMBps} MB/s</span>
                  {uploadProgress.timeRemainingSec !== undefined && (
                    <>
                      <span>•</span>
                      <span>~{uploadProgress.timeRemainingSec}s remaining</span>
                    </>
                  )}
                  <span>•</span>
                  <span>Chunk {uploadProgress.currentChunk}/{uploadProgress.totalChunks}</span>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (cancelUploadRef.current) {
                  cancelUploadRef.current();
                }
              }}
              className="h-7 px-2.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 gap-1"
            >
              <AlertTriangle className="w-3.5 h-3.5" /> Cancel
            </Button>
          </div>

          <div className="w-full bg-muted/60 h-2 rounded-full overflow-hidden border border-border/40">
            <div 
              className="bg-primary h-full rounded-full transition-all duration-150 ease-out shadow-xs"
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* File Explorer Table Area */}
      <div 
        ref={tableContainerRef}
        className="flex-1 min-h-0 overflow-y-auto relative"
        onContextMenu={(e) => {
          // Open context menu for empty space if target wasn't a row
          const target = e.target as HTMLElement;
          if (!target.closest('tr[data-file-row]')) {
            e.preventDefault();
            setContextMenu({
              visible: true,
              x: e.clientX,
              y: e.clientY,
              entry: null,
            });
          }
        }}
      >
        {isLoading && !listing ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-xs">Fetching remote filesystem...</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
            <Folder className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-xs font-medium text-foreground">
              {searchFilter ? `No files matching "${searchFilter}"` : 'This directory is empty'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Drop files here or right-click to create files and folders.
            </p>
          </div>
        ) : (
          <table className="w-full text-xs text-left border-collapse table-fixed select-none">
            <colgroup>
              <col /> {/* Name column fills available space */}
              <col style={{ width: '90px' }} /> {/* Size */}
              <col className="hidden md:table-column" style={{ width: '130px' }} /> {/* Permissions */}
              <col className="hidden lg:table-column" style={{ width: '110px' }} /> {/* Owner:Group */}
              <col className="hidden sm:table-column" style={{ width: '140px' }} /> {/* Modified */}
              <col style={{ width: '100px' }} /> {/* Actions */}
            </colgroup>
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
                  className="py-2.5 px-3 cursor-pointer hover:text-foreground transition-colors select-none text-right"
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
                <th className="py-2.5 px-3 font-mono text-center hidden md:table-cell">Permissions</th>
                <th className="py-2.5 px-3 font-mono text-left hidden lg:table-cell">Owner:Group</th>
                <th 
                  className="py-2.5 px-3 cursor-pointer hover:text-foreground transition-colors select-none hidden sm:table-cell"
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
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredEntries.map((entry) => {
                const isSelected = selectedPaths.has(entry.path);
                const isCut = clipboard?.action === 'cut' && clipboard.paths.includes(entry.path);
                const isDropTarget = dropTargetDir === entry.path;

                return (
                  <tr
                    key={entry.path}
                    data-file-row="true"
                    draggable={true}
                    onDragStart={(e) => {
                      const toDrag = selectedPaths.has(entry.path) ? Array.from(selectedPaths) : [entry.path];
                      setDraggedItemPaths(toDrag);
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'sftp_path', paths: toDrag }));
                    }}
                    onDragOver={(e) => {
                      if (entry.is_dir) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropTargetDir(entry.path);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetDir === entry.path) setDropTargetDir(null);
                    }}
                    onDrop={(e) => {
                      if (entry.is_dir) {
                        e.preventDefault();
                        e.stopPropagation();
                        // Check if dropping external files
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          handleFileUpload(e.dataTransfer.files[0], entry.path);
                          setDropTargetDir(null);
                        } else {
                          handleDropOnDirectory(entry);
                        }
                      }
                    }}
                    onClick={(e) => handleRowClick(entry, e)}
                    onDoubleClick={() => {
                      if (entry.is_dir) {
                        handleNavigate(entry.path);
                      } else {
                        setEditingFilePath(entry.path);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedPaths.has(entry.path)) {
                        setSelectedPaths(new Set([entry.path]));
                      }
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        entry,
                      });
                    }}
                    className={cn(
                      "transition-colors group cursor-pointer",
                      isSelected ? "bg-primary/15 hover:bg-primary/20" : "hover:bg-muted/40",
                      isCut && "opacity-45 border-dashed border-primary/60 bg-muted/30",
                      isDropTarget && "bg-primary/25 border-2 border-primary ring-2 ring-primary/40"
                    )}
                  >
                    {/* Name + Icon */}
                    <td className="py-2 px-4 font-medium overflow-hidden">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileIcon entry={entry} className="w-4 h-4 shrink-0" />
                        <span 
                          className={cn(
                            "truncate",
                            entry.is_dir ? 'text-foreground font-semibold hover:underline' : 'text-foreground/90'
                          )}
                          title={entry.name}
                        >
                          {entry.name}
                        </span>
                        {entry.is_symlink && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted text-muted-foreground border-border shrink-0">
                            symlink
                          </Badge>
                        )}
                        {isArchive(entry.name) && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-500/10 text-amber-400 border-amber-500/30 shrink-0">
                            archive
                          </Badge>
                        )}
                      </div>
                    </td>

                    {/* Size */}
                    <td className="py-2 px-3 font-mono text-right text-muted-foreground truncate">
                      {formatSize(entry.size)}
                    </td>

                    {/* Permissions */}
                    <td className="py-2 px-3 font-mono text-center text-muted-foreground hidden md:table-cell truncate">
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
                    <td className="py-2 px-3 text-muted-foreground font-mono text-[11px] hidden sm:table-cell truncate">
                      {formatDate(entry.modified)}
                    </td>

                    {/* Quick Action Buttons */}
                    <td className="py-2 px-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
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

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          title={entry.is_dir ? "Download as .tar.gz archive" : "Download File"}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                              <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-popover border-border text-xs w-44">
                            <DropdownMenuItem onClick={() => handleCut([entry.path])}>
                              <Scissors className="w-3.5 h-3.5 mr-2" /> Cut (Ctrl+X)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopy([entry.path])}>
                              <Copy className="w-3.5 h-3.5 mr-2" /> Copy (Ctrl+C)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(entry)}>
                              <Layers className="w-3.5 h-3.5 mr-2" /> Duplicate (Ctrl+D)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openCompressModal([entry.path])}>
                              <FileArchive className="w-3.5 h-3.5 mr-2" /> Compress
                            </DropdownMenuItem>
                            {isArchive(entry.name) && (
                              <>
                                <DropdownMenuItem onClick={() => handleExtract(entry.path, currentPath)}>
                                  <FolderArchive className="w-3.5 h-3.5 mr-2 text-amber-400" /> Extract Here
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  const folderName = entry.name.replace(/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|gz)$/i, '');
                                  handleExtract(entry.path, `${currentPath.trimEnd()}/${folderName}`);
                                }}>
                                  <FolderArchive className="w-3.5 h-3.5 mr-2 text-amber-400" /> Extract to Folder
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => { setRenamingEntry(entry); setRenameTargetName(entry.name); }}>
                              <Edit2 className="w-3.5 h-3.5 mr-2" /> Rename (F2)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setChmodEntry(entry)}>
                              <ShieldCheck className="w-3.5 h-3.5 mr-2" /> Permissions (chmod)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyPathToClipboard(entry.path)}>
                              <CopyCheck className="w-3.5 h-3.5 mr-2" /> Copy Path
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload(entry)}>
                              <Download className="w-3.5 h-3.5 mr-2" /> Download
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => setDeletingEntry(entry)}
                              className="text-rose-500 focus:text-rose-400 focus:bg-rose-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete (Del)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Desktop-Class Right-Click Context Menu */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(contextMenu.x, window.innerWidth - 240),
            top: Math.min(contextMenu.y, window.innerHeight - 380),
            zIndex: 9999,
          }}
          className="w-56 rounded-xl border border-border/80 bg-popover/95 backdrop-blur-md p-1.5 shadow-2xl text-xs text-foreground animate-in fade-in zoom-in-95 duration-100 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entry ? (
            /* Context Menu for File or Folder Row */
            <>
              <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border/60 truncate flex items-center gap-1.5 mb-1">
                <FileIcon entry={contextMenu.entry} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{contextMenu.entry.name}</span>
              </div>

              {contextMenu.entry.is_dir ? (
                <button
                  type="button"
                  onClick={() => {
                    handleNavigate(contextMenu.entry!.path);
                    setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer font-medium"
                >
                  <span className="flex items-center gap-2"><Folder className="w-3.5 h-3.5 text-primary" /> Open Folder</span>
                  <span className="text-[10px] text-muted-foreground">Enter</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingFilePath(contextMenu.entry!.path);
                    setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer font-medium"
                >
                  <span className="flex items-center gap-2"><Edit2 className="w-3.5 h-3.5 text-primary" /> View / Edit</span>
                  <span className="text-[10px] text-muted-foreground">Enter</span>
                </button>
              )}

              <div className="h-px bg-border/60 my-1" />

              <button
                type="button"
                onClick={() => {
                  const paths = selectedPaths.has(contextMenu.entry!.path) ? Array.from(selectedPaths) : [contextMenu.entry!.path];
                  handleCut(paths);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><Scissors className="w-3.5 h-3.5 text-sky-400" /> Cut</span>
                <span className="text-[10px] text-muted-foreground">Ctrl+X</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const paths = selectedPaths.has(contextMenu.entry!.path) ? Array.from(selectedPaths) : [contextMenu.entry!.path];
                  handleCopy(paths);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><Copy className="w-3.5 h-3.5 text-indigo-400" /> Copy</span>
                <span className="text-[10px] text-muted-foreground">Ctrl+C</span>
              </button>

              {contextMenu.entry.is_dir && clipboard && (
                <button
                  type="button"
                  onClick={() => {
                    handlePaste(contextMenu.entry!.path);
                    setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer font-semibold text-primary"
                >
                  <span className="flex items-center gap-2"><Clipboard className="w-3.5 h-3.5" /> Paste into this folder</span>
                  <span className="text-[10px] text-muted-foreground">Ctrl+V</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  handleDuplicate(contextMenu.entry!);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-emerald-400" /> Duplicate</span>
                <span className="text-[10px] text-muted-foreground">Ctrl+D</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const paths = selectedPaths.has(contextMenu.entry!.path) ? Array.from(selectedPaths) : [contextMenu.entry!.path];
                  openCompressModal(paths);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><FileArchive className="w-3.5 h-3.5 text-amber-400" /> Compress...</span>
              </button>

              {isArchive(contextMenu.entry.name) && (
                <>
                  <div className="h-px bg-border/60 my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      handleExtract(contextMenu.entry!.path, currentPath);
                      setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer text-amber-400"
                  >
                    <FolderArchive className="w-3.5 h-3.5" /> Extract Here
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const folderName = contextMenu.entry!.name.replace(/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|gz)$/i, '');
                      handleExtract(contextMenu.entry!.path, `${currentPath.trimEnd()}/${folderName}`);
                      setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer text-amber-400"
                  >
                    <FolderArchive className="w-3.5 h-3.5" /> Extract to {contextMenu.entry.name.replace(/\.[^/.]+$/, '')}/
                  </button>
                </>
              )}

              <div className="h-px bg-border/60 my-1" />

              <button
                type="button"
                onClick={() => {
                  setRenamingEntry(contextMenu.entry!);
                  setRenameTargetName(contextMenu.entry!.name);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><Edit2 className="w-3.5 h-3.5 text-muted-foreground" /> Rename</span>
                <span className="text-[10px] text-muted-foreground">F2</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setChmodEntry(contextMenu.entry!);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" /> Permissions (chmod)
              </button>

              <button
                type="button"
                onClick={() => {
                  handleCopyPathToClipboard(contextMenu.entry!.path);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
              >
                <CopyCheck className="w-3.5 h-3.5 text-muted-foreground" /> Copy Full Path
              </button>

              <button
                type="button"
                onClick={() => {
                  handleDownload(contextMenu.entry!);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-muted-foreground" /> Download
              </button>

              <div className="h-px bg-border/60 my-1" />

              <button
                type="button"
                onClick={() => {
                  setDeletingEntry(contextMenu.entry!);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-rose-500/15 text-rose-500 flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Delete</span>
                <span className="text-[10px] text-rose-400">Del</span>
              </button>
            </>
          ) : (
            /* Context Menu for Empty Space */
            <>
              <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border/60 mb-1">
                Folder Actions ({currentPath})
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsNewFolderOpen(true);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-primary" /> New Folder
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsNewFileOpen(true);
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
              >
                <FilePlus className="w-3.5 h-3.5 text-primary" /> New File
              </button>

              {clipboard && (
                <button
                  type="button"
                  onClick={() => {
                    handlePaste();
                    setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer font-semibold text-primary"
                >
                  <span className="flex items-center gap-2"><Clipboard className="w-3.5 h-3.5" /> Paste Here</span>
                  <span className="text-[10px] text-muted-foreground">Ctrl+V</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  fileInputRef.current?.click();
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5 text-sky-400" /> Upload File...
              </button>

              <div className="h-px bg-border/60 my-1" />

              <button
                type="button"
                onClick={() => {
                  fetchDirectory();
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><RotateCw className="w-3.5 h-3.5" /> Refresh</span>
                <span className="text-[10px] text-muted-foreground">F5</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  handleSelectAll();
                  setContextMenu({ visible: false, x: 0, y: 0, entry: null });
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2"><CheckSquare className="w-3.5 h-3.5" /> Select All</span>
                <span className="text-[10px] text-muted-foreground">Ctrl+A</span>
              </button>
            </>
          )}
        </div>
      )}

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

      {/* Compress Modal */}
      <Dialog open={isCompressOpen} onOpenChange={setIsCompressOpen}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <FileArchive className="w-4 h-4 text-amber-400" /> Compress to Archive
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Compress {compressTargetPaths.length} item(s) into an archive file.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleExecuteCompress} className="space-y-4 pt-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Archive Name</label>
              <Input
                value={compressName}
                onChange={(e) => setCompressName(e.target.value)}
                placeholder="archive.zip"
                autoFocus
                className="h-8 text-xs bg-background border-input font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Format</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCompressType('zip');
                    if (compressName.endsWith('.tar.gz')) {
                      setCompressName(compressName.replace(/\.tar\.gz$/, '.zip'));
                    }
                  }}
                  className={cn(
                    "h-8 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 cursor-pointer",
                    compressType === 'zip'
                      ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  .zip (Universal)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCompressType('tar.gz');
                    if (compressName.endsWith('.zip')) {
                      setCompressName(compressName.replace(/\.zip$/, '.tar.gz'));
                    }
                  }}
                  className={cn(
                    "h-8 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 cursor-pointer",
                    compressType === 'tar.gz'
                      ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  .tar.gz (Linux Native)
                </button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsCompressOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isCompressing || !compressName.trim()} className="text-xs bg-primary text-primary-foreground gap-1.5">
                {isCompressing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Archive
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
