import { useCallback, useState } from 'react';

/** Tiny string-record form state: `values[key]` + `setValue(key, v)`. */
export const useValues = (initial: Readonly<Record<string, string>>) => {
  const [values, setValues] = useState<Record<string, string>>({ ...initial });
  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);
  return { values, setValue };
};
