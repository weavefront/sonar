/** Minimal inline icon set — no icon library, no extra bytes. */

import type { CSSProperties } from 'react';

type Props = { className?: string; style?: CSSProperties };

const base = (className = '', style?: CSSProperties) => ({
  className,
  style,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const FolderIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const FileIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const DriveIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M3 12h18M6 8h.01M6 16h.01" />
    <rect x="3" y="4" width="18" height="16" rx="2" />
  </svg>
);

export const LockIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

export const ChevronRight = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const SearchIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const CloseIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const DownloadIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

export const LinkIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </svg>
);

export const CopyIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);

export const CheckIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M5 12.5 10 17 19 7" />
  </svg>
);

export const RefreshIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

export const ArrowUpIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M12 19V5m0 0-6 6m6-6 6 6" />
  </svg>
);

export const UploadIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M12 21V9m0 0-4 4m4-4 4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const PlusIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const FolderPlusIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v4M10 13h4" />
  </svg>
);

export const EditIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const MoveIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M5 9V5a2 2 0 0 1 2-2h4M19 9V5a2 2 0 0 0-2-2h-4M5 15v4a2 2 0 0 0 2 2h4M19 15v4a2 2 0 0 1-2 2h-4" />
  </svg>
);

export const EyeIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4-.8" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

export const MoreIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const SpinnerIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)} className={`${className ?? ''} animate-spin`}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
  </svg>
);

export const AlertIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

export const ExpandIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
  </svg>
);

export const ListViewIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

export const IconViewIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

export const DenseViewIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M4 5h16M4 9h16M4 13h16M4 17h16" />
  </svg>
);

export const SunIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ className, style }: Props) => (
  <svg {...base(className, style)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
  </svg>
);
