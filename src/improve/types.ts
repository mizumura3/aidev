export interface Finding {
  title: string;
  body: string;
  category: "todo" | "lint" | "outdated";
  filePath?: string;
}

export interface Detector {
  name: string;
  detect(cwd: string): Promise<Finding[]>;
}
