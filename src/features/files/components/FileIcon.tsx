import React from 'react';
import {
  Folder,
  FileText,
  FileCode,
  FileJson,
  Database,
  Terminal,
  Settings,
  Binary,
  Image as ImageIcon,
  Archive,
  File
} from 'lucide-react';
import type { RemoteFileEntry } from '@/types';

interface FileIconProps {
  entry: RemoteFileEntry;
  className?: string;
}

export const FileIcon: React.FC<FileIconProps> = ({ entry, className = 'w-4 h-4' }) => {
  if (entry.is_dir) {
    return <Folder className={`${className} text-amber-500 fill-amber-500/20`} />;
  }

  const ext = entry.extension.toLowerCase();
  const name = entry.name.toLowerCase();

  // Shell scripts & DevOps executables
  if (['sh', 'bash', 'zsh', 'fish', 'ksh'].includes(ext) || name === '.bashrc' || name === '.profile') {
    return <Terminal className={`${className} text-emerald-400`} />;
  }

  // Configurations & Environment
  if (['env', 'conf', 'nginx', 'ini', 'cfg', 'cnf', 'properties'].includes(ext) || name.startsWith('.env')) {
    return <Settings className={`${className} text-rose-400`} />;
  }

  // Data / Config formats
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) {
    return <FileJson className={`${className} text-purple-400`} />;
  }

  // Database / SQL
  if (['sql', 'sqlite', 'db', 'dump'].includes(ext)) {
    return <Database className={`${className} text-indigo-400`} />;
  }

  // Code files
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'php', 'java', 'c', 'cpp', 'h'].includes(ext)) {
    return <FileCode className={`${className} text-sky-400`} />;
  }

  // Web & Markup
  if (['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'md', 'markdown', 'txt'].includes(ext)) {
    return <FileText className={`${className} text-cyan-400`} />;
  }

  // Compressed Archives
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) {
    return <Archive className={`${className} text-orange-400`} />;
  }

  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
    return <ImageIcon className={`${className} text-pink-400`} />;
  }

  // Binaries & Libraries
  if (['bin', 'exe', 'so', 'dylib', 'dll', 'app'].includes(ext)) {
    return <Binary className={`${className} text-red-400`} />;
  }

  return <File className={`${className} text-zinc-400`} />;
};

