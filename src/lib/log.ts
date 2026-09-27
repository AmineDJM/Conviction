/** Structured JSON logging (no dependency). */
type Fields = Record<string, unknown>;

function emit(level: string, base: Fields, fields: Fields | string, msg?: string) {
  const rec = typeof fields === "string" ? { ...base, msg: fields } : { ...base, ...fields, msg };
  const line = JSON.stringify({ t: new Date().toISOString(), level, ...rec });
  if (process.env.NODE_ENV === "test") return;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  info(f: Fields | string, msg?: string): void;
  warn(f: Fields | string, msg?: string): void;
  error(f: Fields | string, msg?: string): void;
  child(f: Fields): Logger;
}

function make(base: Fields): Logger {
  return {
    info: (f, m) => emit("info", base, f, m),
    warn: (f, m) => emit("warn", base, f, m),
    error: (f, m) => emit("error", base, f, m),
    child: (f) => make({ ...base, ...f }),
  };
}

export const logger = make({ app: "conviction" });
