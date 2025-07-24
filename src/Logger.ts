export interface ILogger {
  logv(txt: string): void;
  log(txt: string): void;
  info(txt: string): void;
  warn(txt: string): void;
  error(txt: string): void;
  createSub(subPrefix: string): ILogger;
  get prefix();
}

export class SLogger {
  private mPrefix: string;
  public get prefix() {
    return this.mPrefix;
  }

  constructor(prefix: string) {
    this.mPrefix = prefix;
  }

  public createSub(subPrefix: string): ILogger {
    const sub = new SLogger(this.mPrefix + "|" + subPrefix);
    sub.setLogLevel(this.mVerbose);
    return sub;
  }

  private mVerbose: boolean = false;
  public setLogLevel(verbose: boolean) {
    this.mVerbose = verbose;
  }

  private logPrefix(): string {
    return "(" + new Date().toISOString() + ")" + this.mPrefix;
  }
  public logv(txt: string) {
    if (this.mVerbose) console.info(this.logPrefix() + "| " + txt);
  }
  public log(txt: string) {
    console.log(this.logPrefix() + "| " + txt);
  }
  public info(txt: string) {
    console.log(this.logPrefix() + "| " + txt);
  }
  public warn(txt: string) {
    console.warn(this.logPrefix() + "| " + txt);
  }
  public error(txt: string) {
    console.error(this.logPrefix() + "| " + txt);
  }
}
