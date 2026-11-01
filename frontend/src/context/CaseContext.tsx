import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Case } from "@/types/case";
import { getCases } from "@/services/cases";

interface CaseContextType {
  cases: Case[];
  currentCase: Case | null;
  selectedCaseId: string;
  setSelectedCaseId: (caseId: string) => void;
  isLoading: boolean;
  error: string | null;
  refreshCases: () => Promise<void>;
}

const CaseContext = createContext<CaseContextType | undefined>(undefined);

export function CaseProvider({ children }: { children: React.ReactNode }) {
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseIdState] = useState<string>(() => {
    return localStorage.getItem("forensiclens_selected_case_id") || "CASE-001";
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const setSelectedCaseId = useCallback((caseId: string) => {
    setSelectedCaseIdState(caseId);
    try {
      localStorage.setItem("forensiclens_selected_case_id", caseId);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, []);

  const refreshCases = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await getCases();
      setCases(list);
      // Auto-select first case if current selected is not in the list
      if (list.length > 0) {
        setSelectedCaseIdState((prev) => {
          if (!list.some((c) => c.caseId === prev)) {
            const firstId = list[0].caseId;
            try {
              localStorage.setItem("forensiclens_selected_case_id", firstId);
            } catch {
              // Ignore
            }
            return firstId;
          }
          return prev;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load forensic cases";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCases();
  }, [refreshCases]);

  const currentCase = cases.find((c) => c.caseId === selectedCaseId) || cases[0] || null;

  return (
    <CaseContext.Provider
      value={{
        cases,
        currentCase,
        selectedCaseId,
        setSelectedCaseId,
        isLoading,
        error,
        refreshCases,
      }}
    >
      {children}
    </CaseContext.Provider>
  );
}

export function useCase(): CaseContextType {
  const context = useContext(CaseContext);
  if (!context) {
    throw new Error("useCase must be used within a CaseProvider");
  }
  return context;
}
