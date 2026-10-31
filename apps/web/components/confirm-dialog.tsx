"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  trigger,
  title,
  children,
  onConfirm,
}: {
  trigger: string;
  title: string;
  children: React.ReactNode;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl">
            <h2 className="font-semibold">{title}</h2>
            <div className="mt-2 text-sm text-muted-foreground">{children}</div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  await onConfirm();
                  setOpen(false);
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
