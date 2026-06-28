"use client";

import { useTranslations } from "next-intl";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Select } from "@/components/ui/Input";

export function ProjectSwitcher() {
  const t = useTranslations("dashboard.issues");
  const { projects, currentProject, setCurrentProjectId } = useProjects();

  if (projects.length === 0) return null;

  return (
    <Select
      aria-label={t("selectProject")}
      value={currentProject?.id ?? ""}
      onChange={(e) => setCurrentProjectId(e.target.value)}
      className="w-auto min-w-44"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}
