"use client";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/Button";

type Theme = "light" | "dark";

function apply(t: Theme) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.setItem("mc-theme", t);
  } catch {
    /* storage bloqueado: o tema vale só nesta visita */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }, []);
  return {
    theme,
    toggle: () => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      apply(next);
      setTheme(next);
    },
  };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return <IconButton icon={theme === "dark" ? "light_mode" : "dark_mode"} label={theme === "dark" ? "Mudar para o tema claro" : "Mudar para o tema escuro"} onClick={toggle} />;
}
