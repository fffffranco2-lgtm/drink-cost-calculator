export const PRINT_MODE_STORAGE_KEY = "orders_print_mode";
export const QZ_PRINTER_STORAGE_KEY = "orders_qz_printer_name";
export const AUTO_PRINT_STORAGE_KEY = "orders_auto_print_enabled";

export type PrintMode = "qz" | "browser";
export type QzConnectionState = "connected" | "disconnected";

export type QzPrintConfigOptions = {
  encoding?: string;
  copies?: number;
};

export type QzPrintData = {
  type: "raw";
  format: "plain" | "command";
  flavor?: "plain";
  data: string;
};

export type QzApi = {
  security?: {
    setCertificatePromise: (
      promiseFactory: (resolve: (value: string) => void, reject: (reason?: unknown) => void) => void
    ) => void;
    setSignaturePromise: (signer: (toSign: string) => Promise<string>) => void;
    setSignatureAlgorithm?: (algorithm: string) => void;
  };
  websocket: {
    isActive: () => boolean;
    connect: (options?: { retries?: number; delay?: number }) => Promise<void>;
  };
  printers: {
    getDefault?: () => Promise<string>;
    find: (query?: string) => Promise<string | string[]>;
  };
  configs: {
    create: (printer: string, options?: QzPrintConfigOptions) => unknown;
  };
  print: (config: unknown, data: QzPrintData[]) => Promise<void>;
};

declare global {
  interface Window {
    qz?: QzApi;
  }
}

export {};
