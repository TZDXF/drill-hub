export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  statusCode = 422,
  fields?: Record<string, string>,
): asserts condition {
  if (!condition) throw new AppError(statusCode, code, message, fields);
}
