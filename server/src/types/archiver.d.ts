declare module 'archiver' {
  interface ArchiverInstance {
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    append(source: string | Buffer, data?: { name?: string }): ArchiverInstance;
    finalize(): void;
    on(event: string, callback: (...args: unknown[]) => void): ArchiverInstance;
  }
  function archiver(format: string, options?: Record<string, unknown>): ArchiverInstance;
  export default archiver;
}
