"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";

/** Nothing about the origin changes mid-session, so there's nothing to watch. */
function subscribeToNothing() {
  return () => {};
}

function safeAbsoluteUrl(path: string) {
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

/**
 * The organizer's "Copy link" control.
 *
 * Starts out showing the path, then swaps in the full URL once mounted —
 * `window.location.origin` isn't available while the server renders, and
 * guessing it would produce a link that's wrong wherever this is deployed.
 *
 * `navigator.clipboard` needs a secure context, so in an http preview or a
 * sandboxed frame the write is refused. Rather than fail silently, the field
 * gets selected so a manual copy is one keystroke away.
 */
export function CopyLinkButton({ slug }: { slug: string }) {
  const path = `/events/${slug}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");

  // `window.location.origin` doesn't exist while the server renders. This is
  // the React 19 answer to "a value only the client has": the server snapshot
  // is the path, the client snapshot is the full URL, and React swaps them
  // after hydration without a mismatch.
  const url = useSyncExternalStore(
    subscribeToNothing,
    () => safeAbsoluteUrl(path),
    () => path,
  );

  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 5000);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setStatus("manual");
    }
  }

  return (
    <div className="rounded-2xl border border-navy-100 bg-cream-100 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm font-semibold text-navy-900">
          Share this event
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={copy}
          aria-describedby="copy-link-status"
          leftIcon={
            status === "copied" ? (
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M20 6 9 17l-5-5"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : undefined
          }
        >
          {status === "copied" ? "Copied" : "Copy link"}
        </Button>
      </div>

      <input
        ref={inputRef}
        readOnly
        value={url}
        aria-label="Signup link"
        onFocus={(event) => event.currentTarget.select()}
        className="mt-2.5 min-h-tap w-full rounded-xl border-2 border-navy-100 bg-surface px-3 text-sm text-navy-700 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20"
      />

      <p
        id="copy-link-status"
        role="status"
        aria-live="polite"
        className="mt-1.5 text-xs text-navy-600"
      >
        {status === "copied" && (
          <span className="font-semibold text-mint-700">
            Link copied. Send it to your volunteers.
          </span>
        )}
        {status === "manual" && (
          <span className="font-semibold text-coral-700">
            This browser blocked the clipboard. The link is selected — press
            {" "}
            <kbd className="rounded bg-navy-900/10 px-1">Ctrl</kbd>/
            <kbd className="rounded bg-navy-900/10 px-1">⌘</kbd> + C to copy it.
          </span>
        )}
        {status === "idle" && "Volunteers can open this link without an account."}
      </p>
    </div>
  );
}
