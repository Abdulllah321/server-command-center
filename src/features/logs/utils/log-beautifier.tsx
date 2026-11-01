import React from 'react';
import { AnsiUp } from 'ansi_up';

const ansiUp = new AnsiUp();
ansiUp.use_classes = false;

// Regex to strip ANSI sequences for pure text analysis (handles raw \x1b, unicode \u001b, \uFFFD, and text escapes)
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /(?:\x1B|\u001b|\uFFFD|\\u001b|\\x1b)(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

// Convert raw ANSI text (including potential escaped variants) to safe HTML
export function ansiToHtml(raw: string): string {
  if (!raw) return '';
  // Normalize escaped \u001b, \x1b, or unicode replacement characters before ANSI brackets
  const normalized = raw
    .replace(/\\u001b\[/gi, '\x1B[')
    .replace(/\\x1b\[/gi, '\x1B[')
    .replace(/\uFFFD\[/g, '\x1B[');
  return ansiUp.ansi_to_html(normalized);
}

// Token highlighter for message body (emails, keys=values, timings, statuses, UUIDs)
export function renderHighlightedTokens(text: string, searchQuery?: string): React.ReactNode {
  if (!text) return null;

  // Split tokens by spaces, pipes, and delimiters while preserving them
  const tokens = text.split(/(\s+|\|)/);

  return tokens.map((token, i) => {
    if (!token || token === ' ' || token === '|') {
      if (token === '|') {
        return <span key={i} className="text-zinc-600 px-1 font-mono">|</span>;
      }
      return token;
    }

    // 1. Check if token matches search query
    if (searchQuery && token.toLowerCase().includes(searchQuery.toLowerCase())) {
      const q = searchQuery.toLowerCase();
      const parts = token.split(new RegExp(`(${searchQuery})`, 'gi'));
      return (
        <span key={i}>
          {parts.map((p, pi) => 
            p.toLowerCase() === q ? (
              <mark key={pi} className="bg-amber-400/40 text-amber-100 px-0.5 rounded font-bold">
                {p}
              </mark>
            ) : (
              p
            )
          )}
        </span>
      );
    }

    // 2. Key-Value with Timing (e.g. total=357ms, duration=12ms, time=1.2s)
    const timingMatch = token.match(/^([a-zA-Z_]\w*)=(\d+(?:\.\d+)?m?s)$/);
    if (timingMatch) {
      return (
        <span key={i} className="inline-flex items-center px-1.5 py-0.2 rounded bg-blue-500/15 border border-blue-500/20 text-blue-300 font-mono text-[11px]">
          <span className="text-zinc-400">{timingMatch[1]}=</span>
          <span className="font-semibold text-blue-300">{timingMatch[2]}</span>
        </span>
      );
    }

    // 3. Key-Value general (e.g. userId=46aac6b2-8f5b..., role=admin)
    const kvMatch = token.match(/^([a-zA-Z_]\w*)=([^\s|]+)$/);
    if (kvMatch) {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(kvMatch[2]);
      return (
        <span key={i} className="font-mono text-xs">
          <span className="text-zinc-400">{kvMatch[1]}=</span>
          <span className={isUUID ? "text-purple-300 font-semibold" : "text-emerald-300 font-medium"}>
            {kvMatch[2]}
          </span>
        </span>
      );
    }

    // 4. Email address
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(token)) {
      return (
        <span key={i} className="text-cyan-300 underline underline-offset-2 decoration-cyan-500/40 font-mono">
          {token}
        </span>
      );
    }

    // 5. Success / OK / Done / Failed status prefixes
    if (token.toLowerCase().startsWith('success:')) {
      return (
        <span key={i} className="text-emerald-400 font-semibold">
          {token}
        </span>
      );
    }
    if (token.toLowerCase().startsWith('failed:') || token.toLowerCase().startsWith('error:')) {
      return (
        <span key={i} className="text-rose-400 font-semibold">
          {token}
        </span>
      );
    }

    // Default token
    return <span key={i}>{token}</span>;
  });
}

interface LogLineProps {
  raw: string;
  index: number;
  searchQuery?: string;
  wrapLines?: boolean;
  showLineNumbers?: boolean;
}

export const BeautifiedLogLine: React.FC<LogLineProps> = ({
  raw,
  index,
  searchQuery,
  wrapLines = true,
  showLineNumbers = true,
}) => {
  const clean = stripAnsi(raw).trimEnd();

  // Pattern A: PM2 Log File Header
  // e.g. /root/.pm2/logs/backend-out.log last 15 lines:
  const pm2HeaderMatch = clean.match(/^(\/[^\s]+?\.log)\s+(last\s+\d+\s+lines:?.*)$/i);
  if (pm2HeaderMatch) {
    return (
      <div className="my-2 py-1 px-3 rounded-lg bg-zinc-900 border border-white/10 text-xs font-mono text-zinc-400 flex items-center justify-between shadow-inner">
        <span className="flex items-center gap-1.5 text-zinc-300 font-semibold">
          <span className="text-primary">📄</span> {pm2HeaderMatch[1]}
        </span>
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider">{pm2HeaderMatch[2]}</span>
      </div>
    );
  }

  // Pattern B: NestJS Formatted Log
  // e.g. [Nest] 404131  - 10/30/2026, 7:29:09 AM      LOG [AuthService] [LOGIN] Success: admin@inpl.com ...
  const nestMatch = clean.match(/^\[Nest\]\s+(\d+)\s+-\s+(.*?)\s+(LOG|ERROR|WARN|DEBUG|VERBOSE)\s+\[([^\]]+)\](?:\s+\[([^\]]+)\])?\s*(.*)$/i);
  if (nestMatch) {
    const [, pid, timestamp, level, context, subContext, message] = nestMatch;
    const lvlUpper = level.toUpperCase();

    const levelBadgeClass = 
      lvlUpper === 'LOG' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
      lvlUpper === 'WARN' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
      lvlUpper === 'ERROR' ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' :
      'bg-purple-500/15 text-purple-400 border-purple-500/30';

    return (
      <div className={`group flex items-start gap-2.5 py-1 px-2.5 -mx-2 rounded hover:bg-white/[0.04] transition-colors font-mono text-xs ${
        wrapLines ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap'
      }`}>
        {showLineNumbers && (
          <span className="text-[11px] text-zinc-600 select-none font-mono w-10 text-right shrink-0 pt-0.5">
            {index + 1}
          </span>
        )}

        {/* Framework & PID badge */}
        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-300 border border-white/5 shrink-0 pt-0.5">
          Nest <span className="text-zinc-500 font-normal">#{pid}</span>
        </span>

        {/* Timestamp */}
        <span className="text-zinc-500 text-[11px] font-mono shrink-0 pt-0.5">
          {timestamp.trim()}
        </span>

        {/* Level */}
        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border shrink-0 tracking-wide pt-0.5 ${levelBadgeClass}`}>
          {lvlUpper}
        </span>

        {/* Context badge e.g. [AuthService] */}
        {context && (
          <span className="px-1.5 py-0.2 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20 shrink-0 font-mono">
            [{context}]
          </span>
        )}

        {/* Subcontext badge e.g. [LOGIN] */}
        {subContext && (
          <span className="px-1.5 py-0.2 rounded text-[11px] font-semibold bg-teal-500/10 text-teal-300 border border-teal-500/20 shrink-0 font-mono">
            [{subContext}]
          </span>
        )}

        {/* Message body with token highlighting */}
        <span className="text-zinc-200 flex-1 leading-relaxed">
          {renderHighlightedTokens(message, searchQuery)}
        </span>
      </div>
    );
  }

  // Pattern C: HTTP Request Line (e.g. GET /api/phpinfo.php or POST /api/auth 200 45ms)
  const httpMatch = clean.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+([^\s]+)(?:\s+(\d{3}))?(?:\s+(.*))?$/i);
  if (httpMatch) {
    const [, method, path, statusCode, meta] = httpMatch;
    const mUpper = method.toUpperCase();

    const methodColor = 
      mUpper === 'GET' ? 'bg-sky-500/20 text-sky-400 border-sky-500/30' :
      mUpper === 'POST' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
      mUpper === 'PUT' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
      mUpper === 'DELETE' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
      'bg-purple-500/20 text-purple-400 border-purple-500/30';

    const statusColor = statusCode 
      ? parseInt(statusCode, 10) >= 500 ? 'text-rose-400 bg-rose-500/15 border-rose-500/30'
      : parseInt(statusCode, 10) >= 400 ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
      : 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
      : '';

    return (
      <div className={`group flex items-center gap-2.5 py-1 px-2.5 -mx-2 rounded hover:bg-white/[0.04] transition-colors font-mono text-xs ${
        wrapLines ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap'
      }`}>
        {showLineNumbers && (
          <span className="text-[11px] text-zinc-600 select-none font-mono w-10 text-right shrink-0">
            {index + 1}
          </span>
        )}

        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase shrink-0 font-mono tracking-wider ${methodColor}`}>
          {mUpper}
        </span>

        <span className="font-semibold text-zinc-200 font-mono text-xs">
          {path}
        </span>

        {statusCode && (
          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border font-mono ${statusColor}`}>
            {statusCode}
          </span>
        )}

        {meta && (
          <span className="text-zinc-400 text-xs">
            {renderHighlightedTokens(meta, searchQuery)}
          </span>
        )}
      </div>
    );
  }

  // Pattern D: Stack Trace line
  // e.g. at Object.handleRequest (/var/www/...:30:5) OR at /var/www/...:9:23
  const stackMatchWithFunc = clean.match(/^\s*at\s+([^(\s]+[^(]*)\s*\(([^)]+)\)/);
  const stackMatchDirect = !stackMatchWithFunc ? clean.match(/^\s*at\s+(\/[^\s]+:\d+:\d+)/) : null;

  if (stackMatchWithFunc || stackMatchDirect) {
    const funcName = stackMatchWithFunc ? stackMatchWithFunc[1].trim() : 'anonymous';
    const location = stackMatchWithFunc ? stackMatchWithFunc[2].trim() : stackMatchDirect![1].trim();
    return (
      <div className={`group flex items-start gap-2.5 py-0.5 px-2.5 -mx-2 rounded hover:bg-rose-500/[0.04] border-l-2 border-rose-500/30 pl-3 transition-colors font-mono text-xs ${
        wrapLines ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap'
      }`}>
        {showLineNumbers && (
          <span className="text-[11px] text-zinc-600 select-none font-mono w-10 text-right shrink-0">
            {index + 1}
          </span>
        )}
        <span className="text-rose-400/80 font-mono shrink-0 select-none">at</span>
        <span className="text-purple-300 font-medium font-mono">{funcName}</span>
        <span className="text-zinc-500 font-mono">({location})</span>
      </div>
    );
  }

  // Pattern E: Standard Fallback (Render full ANSI colors using ansi_up)
  const htmlContent = ansiToHtml(raw);

  return (
    <div className={`group flex items-start gap-2.5 py-0.5 px-2.5 -mx-2 rounded hover:bg-white/[0.03] transition-colors font-mono text-xs ${
      wrapLines ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap'
    }`}>
      {showLineNumbers && (
        <span className="text-[11px] text-zinc-600 select-none font-mono w-10 text-right shrink-0 pt-0.5">
          {index + 1}
        </span>
      )}

      {htmlContent ? (
        <span 
          className="text-zinc-300 flex-1 leading-relaxed selection:bg-primary/30"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      ) : (
        <span className="text-zinc-300 flex-1 leading-relaxed">
          {renderHighlightedTokens(clean, searchQuery)}
        </span>
      )}
    </div>
  );
};

