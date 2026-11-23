import { theme as antdTheme, ConfigProvider } from "antd";
import { createContext, type PropsWithChildren, useContext, useMemo, useState } from "react";
import { theme } from "../theme";

export type ColorMode = "light" | "dark";

const STORAGE_KEY = "socialhub.colorMode";

type ColorModeContextValue = {
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
};

const ColorModeContext = createContext<ColorModeContextValue>({
  mode: "light",
  setMode: () => undefined,
});

function readSavedMode(): ColorMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Light is the default; the choice is remembered per browser. */
export function ColorModeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ColorMode>(readSavedMode);

  const value = useMemo<ColorModeContextValue>(
    () => ({
      mode,
      setMode: (next) => {
        setModeState(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // The choice still applies for this session if storage is unavailable.
        }
      },
    }),
    [mode],
  );

  return (
    <ColorModeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          ...theme,
          algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        }}
      >
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
}

export const useColorMode = () => useContext(ColorModeContext);
