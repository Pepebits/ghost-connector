export interface PostIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestedAction?: string;
}
