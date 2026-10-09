export interface OpenedFile {
  name: string;
  kind: "project" | "image";
  data: string;
  token?: string;
}
export interface DesktopBridge {
  openFile(kind: "document" | "image"): Promise<OpenedFile | null>;
  adoptProject(token: string): Promise<void>;
  saveProject(
    name: string,
    content: string,
    saveAs: boolean,
  ): Promise<{ name: string; path: string } | null>;
  exportImage(
    name: string,
    data: string,
    format: "png" | "jpeg",
  ): Promise<{ path: string } | null>;
  readClipboard(): Promise<string | null>;
  setDirty(value: boolean): void;
  setTitle(value: string): void;
  resetProjectPath(): void;
  confirmClose(): void;
  getInfo(): Promise<{ version: string; channel: string }>;
  onAction(callback: (action: string) => void): () => void;
}
declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
