"use client";

import { ConfirmDialog } from "./confirm-dialog";

export function PublishConfirmDialog({
  videoName,
  privacy,
  onConfirm,
}: {
  videoName: string;
  privacy: "public" | "unlisted" | "scheduled";
  onConfirm: (
    privacy: "public" | "unlisted" | "scheduled",
  ) => void | Promise<void>;
}) {
  return (
    <ConfirmDialog
      trigger={`Make ${privacy}`}
      title="Confirm visibility"
      onConfirm={() => onConfirm(privacy)}
    >
      Make <strong>{videoName}</strong> {privacy}?
    </ConfirmDialog>
  );
}
