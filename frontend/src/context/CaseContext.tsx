import React, { createContext, useContext, useEffect, useState } from "react";
import { Case } from "@/types/case";
import { getCases } from "@/services/cases";

interface CaseContextType {
  cases: Case[];
  currentCase: Case | null;
  selectedCaseId: string;
  setSelectedCaseId: (caseId: string) => void;
  isLoading: boolean;
}

const CaseContext = createContext<CaseContextType | undefined>(undefined);

export function CaseProvider({ children }: { children: React.ReactNode }) {
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("CASE-001");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    getCases().then((list) => {
      if (mounted) {
        setCases(list);
        setIsLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const currentCase = cases.find((c) => c.caseId === selectedCaseId) || cases[0] || null;

  return (
    <CaseContext.Provider
      value={{
        cases,
        currentCase,
        selectedCaseId,
        setSelectedCaseId,
        isLoading,
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

