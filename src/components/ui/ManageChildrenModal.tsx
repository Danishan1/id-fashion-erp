"use client";

import { Modal } from "@/components/ui/Modal";
import { ChildrenList, type ChildrenListProps } from "@/components/ui/ChildrenList";

interface ManageChildrenModalProps<T extends { id: string; isActive?: boolean }> extends ChildrenListProps<T> {
  open: boolean;
  onClose: () => void;
  /** Full title including parent context, e.g. "Locations — WIP Store (WH03)". */
  title: string;
}

/**
 * Generic "manage a parent's children" modal — List (Actions ⋮) → this →
 * Add/Edit-child modal, per the ERP-wide CRUD standard. A thin wrapper: all
 * the real list/add/edit/deactivate logic lives in ChildrenList — this just
 * adds the outer Modal chrome for callers that want Locations management as
 * its own separate action from a list row (e.g. a future module that isn't
 * Warehouse, which now embeds ChildrenList directly inside its own Create/
 * Edit modal instead — see WarehousesListClient.tsx).
 */
export function ManageChildrenModal<T extends { id: string; isActive?: boolean }>({
  open,
  onClose,
  title,
  ...listProps
}: ManageChildrenModalProps<T>) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-2xl">
      <div className="space-y-3">
        <ChildrenList {...listProps} />
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
