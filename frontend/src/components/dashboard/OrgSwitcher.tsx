"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useOrg } from "@/components/providers/OrgProvider";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Field } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function OrgSwitcher() {
  const t = useTranslations("dashboard.org");
  const tc = useTranslations("common");
  const { orgs, currentOrg, setCurrentOrgId } = useOrg();
  const [open, setOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const qc = useQueryClient();

  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const createMutation = useMutation({
    mutationFn: () => api.orgs.create(name),
    onSuccess: (org) => {
      qc.invalidateQueries({ queryKey: ["organizations"] });
      setCurrentOrgId(org.id);
      setCreateOpen(false);
      setName("");
    },
  });

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-start transition-colors hover:bg-muted"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {currentOrg?.name ?? t("personal")}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute z-30 mt-1.5 w-full origin-top overflow-hidden rounded-[var(--radius-sm)] border border-border bg-card p-1 shadow-lg"
          >
            {orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => {
                  setCurrentOrgId(org.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-start text-sm transition-colors hover:bg-muted"
              >
                <span className="truncate">{org.name}</span>
                {currentOrg?.id === org.id && <Check className="h-4 w-4 text-accent" />}
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm text-accent transition-colors hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              {t("create")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("createTitle")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t("name")} htmlFor="org-name">
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              {t("create")}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
