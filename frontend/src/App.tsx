import { RouterProvider } from "react-router-dom";
import { router } from "@/routes";
import { ThemeProvider } from "@/context/ThemeContext";
import { CaseProvider } from "@/context/CaseContext";

export function App() {
  return (
    <ThemeProvider>
      <CaseProvider>
        <RouterProvider router={router} />
      </CaseProvider>
    </ThemeProvider>
  );
}

export default App;

