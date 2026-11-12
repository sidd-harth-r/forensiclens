import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared overlay behaviour: focus trap, Escape to close, focus restore,
 * body scroll lock. Only the top-most overlay reacts to keyboard events.
 */
const overlayStack: symbol[] = [];

function useOverlay(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLElement>) {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    const id = Symbol("overlay");
    overlayStack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const autoFocus = panel.querySelector<HTMLElement>("[data-autofocus]");
      (autoFocus ?? panel).focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (overlayStack[overlayStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (n) => n.offsetParent !== null || n === document.activeElement
        );
        if (nodes.length === 0) {
          e.preventDefault();
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      const idx = overlayStack.indexOf(id);
      if (idx >= 0) overlayStack.splice(idx, 1);
      if (overlayStack.length === 0) document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, panelRef]);
}

interface OverlayBaseProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Content rendered in the header above the title (badges, ids) */
  eyebrow?: React.ReactNode;
  /** Actions rendered on the right side of the header */
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Prevent closing via backdrop click (e.g. while a mutation runs) */
  dismissible?: boolean;
}

interface DialogProps extends OverlayBaseProps {
  size?: "sm" | "md" | "lg" | "xl";
}

const dialogSizes = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

function OverlayHeader({
  titleId,
  descId,
  title,
  description,
  eyebrow,
  headerActions,
  onClose,
  dismissible,
}: {
  titleId: string;
  descId: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  headerActions?: React.ReactNode;
  onClose: () => void;
  dismissible: boolean;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3.5">
      <div className="min-w-0 flex-1 space-y-1">
        {eyebrow && <div className="flex flex-wrap items-center gap-1.5">{eyebrow}</div>}
        <h2 id={titleId} className="break-words text-base font-semibold leading-snug text-text-primary">
          {title}
        </h2>
        {description && (
          <p id={descId} className="text-xs text-text-muted">
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {headerActions}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close"
          disabled={!dismissible}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  eyebrow,
  headerActions,
  footer,
  children,
  className,
  bodyClassName,
  size = "md",
  dismissible = true,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();
  const safeClose = React.useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);
  useOverlay(open, safeClose, panelRef);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-overlay flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={safeClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[90vh] w-full animate-scale-in flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-overlay focus:outline-none",
          dialogSizes[size],
          className
        )}
      >
        <OverlayHeader
          titleId={titleId}
          descId={descId}
          title={title}
          description={description}
          eyebrow={eyebrow}
          headerActions={headerActions}
          onClose={safeClose}
          dismissible={dismissible}
        />
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}

interface DrawerProps extends OverlayBaseProps {
  width?: "md" | "lg" | "xl";
  /** Tabs or toolbar rendered directly under the header */
  subheader?: React.ReactNode;
}

const drawerWidths = {
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

/**
 * Right-hand detail inspector. Keeps the list it was opened from visible
 * on wide screens, which preserves investigation context.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  eyebrow,
  headerActions,
  subheader,
  footer,
  children,
  className,
  bodyClassName,
  width = "lg",
  dismissible = true,
}: DrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();
  const safeClose = React.useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);
  useOverlay(open, safeClose, panelRef);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-overlay flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-black/50" onClick={safeClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex h-full w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-overlay focus:outline-none",
          drawerWidths[width],
          className
        )}
      >
        <OverlayHeader
          titleId={titleId}
          descId={descId}
          title={title}
          description={description}
          eyebrow={eyebrow}
          headerActions={headerActions}
          onClose={safeClose}
          dismissible={dismissible}
        />
        {subheader && <div className="shrink-0 border-b border-border">{subheader}</div>}
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-subtle px-5 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  loading?: boolean;
  confirmIcon?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  confirmIcon,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="md"
      dismissible={!loading}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "destructive" : "primary"}
            size="sm"
            onClick={onConfirm}
            loading={loading}
            data-autofocus
          >
            {!loading && confirmIcon}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
