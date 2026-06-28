"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { api, unwrapList } from "@/lib/api";
import type { Project } from "@/lib/types";
import { useOrg } from "./OrgProvider";

const STORAGE_KEY = "errora.project";

type ProjectContextValue = {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProjectId: (id: string) => void;
  isLoading: boolean;
  refetch: () => void;
};

const ProjectContext = React.createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { currentOrg } = useOrg();
  const [currentProjectId, setCurrentProjectIdState] = React.useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["projects", currentOrg?.id],
    queryFn: async () => unwrapList(await api.projects.list(currentOrg!.id)),
    enabled: !!currentOrg?.id,
  });

  const projects = React.useMemo(() => data ?? [], [data]);

  React.useEffect(() => {
    if (projects.length === 0) {
      setCurrentProjectIdState(null);
      return;
    }
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const valid = stored && projects.some((p) => p.id === stored) ? stored : null;
    setCurrentProjectIdState(valid ?? projects[0].id);
  }, [projects]);

  const setCurrentProjectId = React.useCallback((id: string) => {
    setCurrentProjectIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? projects[0] ?? null;

  const value = React.useMemo<ProjectContextValue>(
    () => ({
      projects,
      currentProject,
      setCurrentProjectId,
      isLoading,
      refetch,
    }),
    [projects, currentProject, setCurrentProjectId, isLoading, refetch]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects(): ProjectContextValue {
  const ctx = React.useContext(ProjectContext);
  if (!ctx) throw new Error("useProjects must be used within a ProjectProvider");
  return ctx;
}
