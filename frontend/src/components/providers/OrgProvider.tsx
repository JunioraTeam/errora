"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, unwrapList } from "@/lib/api";
import type { Organization } from "@/lib/types";

const STORAGE_KEY = "errora.org";

type OrgContextValue = {
  orgs: Organization[];
  currentOrg: Organization | null;
  setCurrentOrgId: (id: string) => void;
  isLoading: boolean;
  refetch: () => void;
};

const OrgContext = React.createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const [currentOrgId, setCurrentOrgIdState] = React.useState<string | null>(
    null,
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => unwrapList(await api.orgs.list()),
  });

  const orgs = React.useMemo(() => data ?? [], [data]);

  // Restore persisted selection / default to the first org.
  React.useEffect(() => {
    if (orgs.length === 0) return;
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
    const valid = stored && orgs.some((o) => o.id === stored) ? stored : null;
    setCurrentOrgIdState(valid ?? orgs[0].id);
  }, [orgs]);

  const setCurrentOrgId = React.useCallback((id: string) => {
    setCurrentOrgIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const currentOrg =
    orgs.find((o) => o.id === currentOrgId) ?? orgs[0] ?? null;

  const value = React.useMemo<OrgContextValue>(
    () => ({
      orgs,
      currentOrg,
      setCurrentOrgId,
      isLoading,
      refetch,
    }),
    [orgs, currentOrg, setCurrentOrgId, isLoading, refetch],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = React.useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within an OrgProvider");
  return ctx;
}
